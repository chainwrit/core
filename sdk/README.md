# @chainwrit/sdk

TypeScript client for the [Chainwrit](https://github.com/chainwrit/core) Solana program: spending limits for AI agents, enforced on-chain.

```bash
npm install @chainwrit/sdk
```

```ts
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchMandate, pay, toBaseUnits, explorerTx } from "@chainwrit/sdk";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const mandate = new PublicKey("…");

const state = await fetchMandate(connection, mandate);
console.log(state.remainingToday, state.merchants);

const result = await pay(connection, agentKeypair, mandate, {
  merchant: new PublicKey("…"),
  amount: toBaseUnits(0.25),
  taskId: "report-123",
});
if (!result.ok) console.log(`${result.name}: ${result.message}`); // e.g. MerchantNotAllowed
```

Exports PDA helpers (`mandatePda`, `vaultPda`), instruction wrappers (`createMandate`, `deposit`, `pay`, `revoke`, `withdraw`), `fetchMandate`, program error decoding and the program IDL. The program is deployed on devnet only and has not been audited.

Apache-2.0
