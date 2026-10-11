/**
 * Integration tests for the Chainwrit program.
 *
 * These run against a local validator via `anchor test`. They cover the full
 * path — real SPL token accounts, real CPI transfers, real PDA signing — and
 * assert that every rule in the mandate rejects a payment that breaks it.
 *
 * The pure policy logic is additionally unit-tested in Rust:
 *   cargo test -p chainwrit
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { Chainwrit } from "../target/types/chainwrit";

const USDC_DECIMALS = 6;
const usdc = (n: number) => new BN(Math.round(n * 10 ** USDC_DECIMALS));

describe("chainwrit", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Chainwrit as Program<Chainwrit>;
  const connection = provider.connection;
  const owner = provider.wallet as anchor.Wallet;

  /** The agent's own key. It can sign payment requests and nothing else. */
  const agent = Keypair.generate();

  /** Two services the human approved. */
  const merchantA = Keypair.generate();
  const merchantB = Keypair.generate();

  /** The address a prompt injection tries to send money to. */
  const attacker = Keypair.generate();

  let mint: PublicKey;
  let ownerTokenAccount: PublicKey;
  let merchantAToken: PublicKey;
  let merchantBToken: PublicKey;
  let attackerToken: PublicKey;

  /** Derive the mandate PDA for a given agent. */
  const mandatePda = (agentKey: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("mandate"), owner.publicKey.toBuffer(), agentKey.toBuffer()],
      program.programId,
    )[0];

  const vaultPda = (mandate: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), mandate.toBuffer()],
      program.programId,
    )[0];

  /**
   * Create a funded mandate with a fresh agent, so each test is independent.
   * Returns everything a test needs to drive it.
   */
  async function setupMandate(opts?: {
    maxPerPayment?: BN;
    dailyLimit?: BN;
    expiresAt?: BN;
    merchants?: PublicKey[];
    deposit?: BN;
  }) {
    const testAgent = Keypair.generate();
    const mandate = mandatePda(testAgent.publicKey);
    const vault = vaultPda(mandate);

    const now = Math.floor(Date.now() / 1000);

    await program.methods
      .createMandate(
        opts?.maxPerPayment ?? usdc(2),
        opts?.dailyLimit ?? usdc(50),
        opts?.expiresAt ?? new BN(now + 7 * 86400),
        opts?.merchants ?? [merchantA.publicKey, merchantB.publicKey],
      )
      .accounts({
        owner: owner.publicKey,
        agent: testAgent.publicKey,
        mint,
        mandate,
        vault,
      })
      .rpc();

    await program.methods
      .deposit(opts?.deposit ?? usdc(100))
      .accounts({
        owner: owner.publicKey,
        mandate,
        mint,
        vault,
        ownerTokenAccount,
      })
      .rpc();

    return { testAgent, mandate, vault };
  }

  /** Attempt a payment as the agent. Resolves or throws with the program error. */
  async function pay(
    ctx: { testAgent: Keypair; mandate: PublicKey; vault: PublicKey },
    amount: BN,
    merchantToken: PublicKey,
    taskId = "task-001",
  ) {
    return program.methods
      .pay(amount, taskId)
      .accounts({
        agent: ctx.testAgent.publicKey,
        mandate: ctx.mandate,
        mint,
        vault: ctx.vault,
        merchantTokenAccount: merchantToken,
      })
      .signers([ctx.testAgent])
      .rpc();
  }

  /** Assert that a transaction fails with a specific Anchor error code. */
  async function expectError(promise: Promise<unknown>, code: string) {
    try {
      await promise;
      assert.fail(`expected the program to reject this with ${code}`);
    } catch (err: any) {
      const msg = err?.error?.errorCode?.code ?? err?.toString() ?? "";
      expect(msg).to.include(code);
    }
  }

  before(async () => {
    // Fund the agent and attacker so they can pay transaction fees.
    for (const kp of [agent, attacker]) {
      const sig = await connection.requestAirdrop(
        kp.publicKey,
        LAMPORTS_PER_SOL,
      );
      await connection.confirmTransaction(sig, "confirmed");
    }

    // A stand-in for USDC on the local validator.
    mint = await createMint(
      connection,
      owner.payer,
      owner.publicKey,
      null,
      USDC_DECIMALS,
    );

    ownerTokenAccount = await createAssociatedTokenAccount(
      connection,
      owner.payer,
      mint,
      owner.publicKey,
    );

    await mintTo(
      connection,
      owner.payer,
      mint,
      ownerTokenAccount,
      owner.publicKey,
      10_000 * 10 ** USDC_DECIMALS,
    );

    [merchantAToken, merchantBToken, attackerToken] = await Promise.all(
      [merchantA, merchantB, attacker].map((kp) =>
        createAssociatedTokenAccount(
          connection,
          owner.payer,
          mint,
          kp.publicKey,
        ),
      ),
    );
  });

  describe("create_mandate", () => {
    it("stores the human's limits on-chain", async () => {
      const { testAgent, mandate, vault } = await setupMandate();
      const state = await program.account.mandate.fetch(mandate);

      expect(state.owner.toBase58()).to.equal(owner.publicKey.toBase58());
      expect(state.agent.toBase58()).to.equal(testAgent.publicKey.toBase58());
      expect(state.maxPerPayment.toString()).to.equal(usdc(2).toString());
      expect(state.dailyLimit.toString()).to.equal(usdc(50).toString());
      expect(state.revoked).to.equal(false);
      expect(state.merchants.length).to.equal(2);

      // The vault is funded and owned by the mandate PDA, not by any keypair.
      const vaultAccount = await getAccount(connection, vault);
      expect(vaultAccount.amount.toString()).to.equal(usdc(100).toString());
      expect(vaultAccount.owner.toBase58()).to.equal(mandate.toBase58());
    });

    it("refuses a mandate with no merchants", async () => {
      const lonelyAgent = Keypair.generate();
      const mandate = mandatePda(lonelyAgent.publicKey);
      const now = Math.floor(Date.now() / 1000);

      await expectError(
        program.methods
          .createMandate(usdc(2), usdc(50), new BN(now + 86400), [])
          .accounts({
            owner: owner.publicKey,
            agent: lonelyAgent.publicKey,
            mint,
            mandate,
            vault: vaultPda(mandate),
          })
          .rpc(),
        "EmptyMerchantList",
      );
    });

    it("refuses an expiry in the past", async () => {
      const staleAgent = Keypair.generate();
      const mandate = mandatePda(staleAgent.publicKey);
      const past = Math.floor(Date.now() / 1000) - 60;

      await expectError(
        program.methods
          .createMandate(usdc(2), usdc(50), new BN(past), [merchantA.publicKey])
          .accounts({
            owner: owner.publicKey,
            agent: staleAgent.publicKey,
            mint,
            mandate,
            vault: vaultPda(mandate),
          })
          .rpc(),
        "ExpiryInPast",
      );
    });
  });

  describe("pay — the happy path", () => {
    it("pays an approved merchant and records the spend", async () => {
      const ctx = await setupMandate();

      await pay(ctx, usdc(1.5), merchantAToken, "research-run-01");

      const merchantBalance = await getAccount(connection, merchantAToken);
      expect(merchantBalance.amount.toString()).to.equal(usdc(1.5).toString());

      const state = await program.account.mandate.fetch(ctx.mandate);
      expect(state.spentInWindow.toString()).to.equal(usdc(1.5).toString());
      expect(state.totalSpent.toString()).to.equal(usdc(1.5).toString());
      expect(state.paymentCount.toString()).to.equal("1");
    });

    it("pays each approved merchant in the allowlist", async () => {
      const ctx = await setupMandate();

      await pay(ctx, usdc(1), merchantAToken);
      await pay(ctx, usdc(1), merchantBToken);

      const state = await program.account.mandate.fetch(ctx.mandate);
      expect(state.paymentCount.toString()).to.equal("2");
    });
  });

  describe("pay — merchant scope", () => {
    /**
     * The attack the product exists to stop. A poisoned web page tells the
     * agent to pay an address the human never approved. The agent, believing
     * it, signs a valid transaction. The chain refuses it.
     */
    it("rejects a payment to an address the human never approved", async () => {
      const ctx = await setupMandate();

      await expectError(
        pay(ctx, usdc(1), attackerToken, "injected-task"),
        "MerchantNotAllowed",
      );

      const attackerBalance = await getAccount(connection, attackerToken);
      expect(attackerBalance.amount.toString()).to.equal("0");
    });

    it("rejects even a tiny payment to an unapproved address", async () => {
      const ctx = await setupMandate();

      await expectError(pay(ctx, new BN(1), attackerToken), "MerchantNotAllowed");
    });

    it("leaves the mandate untouched after a rejected payment", async () => {
      const ctx = await setupMandate();
      const before = await program.account.mandate.fetch(ctx.mandate);

      await expectError(pay(ctx, usdc(1), attackerToken), "MerchantNotAllowed");

      const after = await program.account.mandate.fetch(ctx.mandate);
      expect(after.spentInWindow.toString()).to.equal(
        before.spentInWindow.toString(),
      );
      expect(after.paymentCount.toString()).to.equal(
        before.paymentCount.toString(),
      );
    });
  });

  describe("pay — spending caps", () => {
    it("rejects a payment above the per-payment cap", async () => {
      const ctx = await setupMandate();

      await expectError(
        pay(ctx, usdc(2.01), merchantAToken),
        "ExceedsPerPaymentLimit",
      );
    });

    it("allows a payment exactly at the cap", async () => {
      const ctx = await setupMandate();
      await pay(ctx, usdc(2), merchantAToken);

      const state = await program.account.mandate.fetch(ctx.mandate);
      expect(state.spentInWindow.toString()).to.equal(usdc(2).toString());
    });

    /** A slow drain: many small payments that individually pass the cap. */
    it("stops spending once the daily limit is reached", async () => {
      const ctx = await setupMandate({
        maxPerPayment: usdc(2),
        dailyLimit: usdc(6),
        deposit: usdc(100),
      });

      await pay(ctx, usdc(2), merchantAToken);
      await pay(ctx, usdc(2), merchantAToken);
      await pay(ctx, usdc(2), merchantAToken);

      await expectError(
        pay(ctx, new BN(1), merchantAToken),
        "ExceedsDailyLimit",
      );

      const state = await program.account.mandate.fetch(ctx.mandate);
      expect(state.spentInWindow.toString()).to.equal(usdc(6).toString());
    });
  });

  describe("pay — expiry and revocation", () => {
    it("rejects payments after the mandate expires", async () => {
      const now = Math.floor(Date.now() / 1000);
      const ctx = await setupMandate({ expiresAt: new BN(now + 2) });

      // Wait for the validator clock to pass the expiry.
      await new Promise((r) => setTimeout(r, 4000));

      await expectError(pay(ctx, usdc(1), merchantAToken), "MandateExpired");
    });

    it("stops all payments the moment the owner revokes", async () => {
      const ctx = await setupMandate();

      await pay(ctx, usdc(1), merchantAToken);

      await program.methods
        .revoke()
        .accounts({ owner: owner.publicKey, mandate: ctx.mandate })
        .rpc();

      await expectError(pay(ctx, usdc(1), merchantAToken), "MandateRevoked");
    });
  });

  describe("pay — authority", () => {
    it("rejects a payment signed by anyone but the named agent", async () => {
      const ctx = await setupMandate();
      const impostor = Keypair.generate();

      const sig = await connection.requestAirdrop(
        impostor.publicKey,
        LAMPORTS_PER_SOL,
      );
      await connection.confirmTransaction(sig, "confirmed");

      await expectError(
        program.methods
          .pay(usdc(1), "task-001")
          .accounts({
            agent: impostor.publicKey,
            mandate: ctx.mandate,
            mint,
            vault: ctx.vault,
            merchantTokenAccount: merchantAToken,
          })
          .signers([impostor])
          .rpc(),
        "NotMandateAgent",
      );
    });
  });

  describe("withdraw", () => {
    it("returns funds to the owner", async () => {
      const ctx = await setupMandate({ deposit: usdc(10) });
      const before = await getAccount(connection, ownerTokenAccount);

      await program.methods
        .withdraw(usdc(10))
        .accounts({
          owner: owner.publicKey,
          mandate: ctx.mandate,
          mint,
          vault: ctx.vault,
          ownerTokenAccount,
        })
        .rpc();

      const after = await getAccount(connection, ownerTokenAccount);
      expect(after.amount - before.amount).to.equal(
        BigInt(usdc(10).toString()),
      );
    });

    it("refuses to withdraw more than the vault holds", async () => {
      const ctx = await setupMandate({ deposit: usdc(5) });

      await expectError(
        program.methods
          .withdraw(usdc(6))
          .accounts({
            owner: owner.publicKey,
            mandate: ctx.mandate,
            mint,
            vault: ctx.vault,
            ownerTokenAccount,
          })
          .rpc(),
        "InsufficientVaultBalance",
      );
    });

    /** The agent can request payments. It can never pull funds out. */
    it("rejects a withdrawal attempted by the agent", async () => {
      const ctx = await setupMandate({ deposit: usdc(5) });

      const sig = await connection.requestAirdrop(
        ctx.testAgent.publicKey,
        LAMPORTS_PER_SOL,
      );
      await connection.confirmTransaction(sig, "confirmed");

      const agentToken = await createAssociatedTokenAccount(
        connection,
        owner.payer,
        mint,
        ctx.testAgent.publicKey,
      );

      await expectError(
        program.methods
          .withdraw(usdc(5))
          .accounts({
            owner: ctx.testAgent.publicKey,
            mandate: ctx.mandate,
            mint,
            vault: ctx.vault,
            ownerTokenAccount: agentToken,
          })
          .signers([ctx.testAgent])
          .rpc(),
        "NotMandateOwner",
      );
    });
  });
});
