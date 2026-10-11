# Chainwrit

**On-chain spending mandates for autonomous AI agents.**

An AI agent that can pay for things is only as trustworthy as the content it
reads. A prompt injection hidden in a web page can tell an agent to send money
to an attacker, and on-chain payments are final — there is no bank to reverse
them.

Chainwrit moves the spending rules off the agent and onto the chain. A human signs a
mandate. Funds sit in a vault owned by a program-derived address that has no
private key. The agent can only *request* a payment; the Solana program decides
whether it happens.

> The guarantee: even if the agent is manipulated, its host server is
> compromised and its signing key is stolen, an attacker cannot move funds
> outside the mandate.

---

## The problem

```
Private key = the money.          An agent that pays holds a key.
Agents can be tricked.            Hidden text in a web page is an instruction.
On-chain payments are final.      No chargeback, no reversal.
───────────────────────────────────────────────────────────────────
One poisoned web page can drain the wallet.
```

Existing defences put the rule in the wrong place:

| Defence | Where the rule lives | Why it fails |
| --- | --- | --- |
| "Don't overspend" in the prompt | Inside the model | Injection attacks exactly this |
| Checks in your server code | On your server | A compromised server skips them |
| Provider wallet caps | In one vendor's platform | You trust the vendor, and you're locked in |
| **Chainwrit** | **On-chain** | Holds even when agent, server and key are all compromised |

## How it works

```
   Human                                           Solana
     │                                               │
     │  1. sign mandate  ─────────────────────────▶  ├── Mandate PDA
     │     merchants, caps, expiry                   │   (the rules)
     │                                               │
     │  2. deposit USDC  ─────────────────────────▶  ├── Vault PDA
     │                                               │   (no private key)
   Agent                                             │
     │                                               │
     │  3. "pay merchant M, 0.05 USDC, task T" ───▶  ├── pay()
     │                                               │     ├─ revoked?
     │                                               │     ├─ expired?
     │                                               │     ├─ over per-payment cap?
     │                                               │     ├─ merchant on allowlist?
     │                                               │     └─ over daily limit?
     │                                               │
     │  4. ◀── paid, or rejected on-chain ───────────┘
```

### What the mandate enforces

| Rule | Example | What it stops |
| --- | --- | --- |
| Merchant allowlist | Only these 3 data APIs | Paying the attacker's address |
| Per-payment cap | Max 2 USDC per call | A single large theft |
| Rolling daily cap | Max 50 USDC per 24h | A slow drain of many small payments |
| Expiry | Valid until Friday | Stale, forgotten permissions |
| Revocation | Owner kills it instantly | An attack already in progress |
| Task tag | Every payment names its task | Unattributable spend |

Merchant scope is the rule that actually stops the demo attack. A cap alone
does not help: if the injection asks for 2 USDC and the cap is 2 USDC, the
payment goes through. The attacker's address was never on the list, so the
amount is irrelevant.

## Design

The policy engine is pure. Every rule lives in
[`programs/chainwrit/src/rules.rs`](programs/chainwrit/src/rules.rs) as logic with no
Solana account plumbing, so it can be read, reasoned about and unit-tested on
its own. The `pay` instruction is a thin wrapper: load state, call
`rules::evaluate`, move tokens only on `Ok`.

This matters because the security claim — a payment outside the mandate is
impossible — is only as good as the tests behind those functions.

```
programs/chainwrit/src/
├── lib.rs      instructions, accounts, events, errors
└── rules.rs    the policy engine + its unit tests
tests/
└── chainwrit.ts     integration tests against a local validator
```

### Accounts

- **Mandate PDA** — `["mandate", owner, agent]`. Holds the rules and the spend
  counters. One owner can run many agents, each with its own limits.
- **Vault PDA** — `["vault", mandate]`. An SPL token account whose authority is
  the mandate PDA. No keypair exists for it, so funds can only move through
  `pay` or `withdraw`.

## Running it

### The policy engine tests (no Solana toolchain needed)

```bash
cargo test -p chainwrit
```

19 tests covering every rule, both directions: what is allowed and what is
rejected, including window boundaries and overflow.

### The full integration tests

Needs the Solana CLI and Anchor 0.32.x.

```bash
# install, if you haven't
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.32.1 && avm use 0.32.1

# then
yarn install
anchor keys sync     # replaces the placeholder program id
anchor test
```

`anchor test` starts a local validator, deploys the program, and runs
`tests/chainwrit.ts`.

### Deploying to devnet

```bash
solana config set --url devnet
solana airdrop 2
anchor build
anchor deploy --provider.cluster devnet
```

## Status

Early. Working on it for the Solana hackathon.

- [x] Mandate program: create, deposit, pay, revoke, withdraw
- [x] Policy engine with unit tests
- [x] Integration test suite
- [ ] x402 payment integration
- [ ] MCP server so any agent can use it as a tool
- [ ] Indexer and dashboard
- [ ] Prompt-injection demo

## Prior art

Chainwrit is not the first attempt to bound what an agent can spend, and the
differences are worth being clear about.

- [Solana Subscriptions & Allowances](https://docs.chainstack.com/docs/solana-agent-allowances-x402)
  gives an agent a capped, revocable on-chain budget. Closest in trust model.
  Chainwrit adds merchant scope, per-payment caps and task attribution.
- **Coinbase Agentic Wallets** and **Crossmint** enforce caps inside their own
  platforms. Chainwrit is provider-neutral and enforced by the chain, so the
  guarantee survives the vendor.
- **Policy gates** that check [AP2](https://ap2-protocol.org/) mandates in
  server code enforce off-chain, so a compromised server defeats them.

## Licence

Apache-2.0
