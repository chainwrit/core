import { AnchorProvider, BN, BorshCoder, EventParser, Program } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  SendOptions,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

import idl from "./idl/chainwrit.json";
import type { Chainwrit } from "./idl/chainwrit";
import { decodeError, errorFromCode } from "./errors";

export * from "./errors";
export type { Chainwrit };
export { BN };

export const PROGRAM_ID = new PublicKey(idl.address);
export const WINDOW_SECONDS = 86_400;

export function mandatePda(owner: PublicKey, agent: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mandate"), owner.toBuffer(), agent.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function vaultPda(mandate: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mandate.toBuffer()],
    PROGRAM_ID,
  )[0];
}

/** What Anchor needs to sign: a browser wallet adapter fits this shape. */
export interface WalletLike {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

// Anchor's own Wallet class is Node-only, so wrap a keypair by hand to keep
// this package usable in the browser.
export function keypairWallet(kp: Keypair): WalletLike {
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([kp]);
    else tx.partialSign(kp);
    return tx;
  };
  return {
    publicKey: kp.publicKey,
    signTransaction: async (tx) => sign(tx),
    signAllTransactions: async (txs) => txs.map(sign),
  };
}

/** Anchor needs a wallet even for read-only use; a throwaway key is fine. */
export function getProgram(connection: Connection, signer?: Keypair | WalletLike): Program<Chainwrit> {
  const wallet = signer instanceof Keypair || !signer ? keypairWallet(signer ?? Keypair.generate()) : signer;
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return new Program<Chainwrit>(idl as Chainwrit, provider);
}

export interface MandateView {
  address: PublicKey;
  owner: PublicKey;
  agent: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  merchants: PublicKey[];
  maxPerPayment: bigint;
  dailyLimit: bigint;
  /** Spend inside the current 24h window, zero if the window has elapsed. */
  spentInWindow: bigint;
  remainingToday: bigint;
  windowStart: number;
  /** When the current window rolls over and the daily cap resets. */
  windowResetsAt: number;
  expiresAt: number;
  revoked: boolean;
  totalSpent: bigint;
  paymentCount: bigint;
  vaultBalance: bigint;
}

type MandateAccount = Awaited<ReturnType<Program<Chainwrit>["account"]["mandate"]["fetch"]>>;

function toView(address: PublicKey, m: MandateAccount, vaultBalance: bigint, now: number): MandateView {
  const windowStart = m.windowStart.toNumber();
  const windowOpen = now - windowStart < WINDOW_SECONDS;
  const dailyLimit = BigInt(m.dailyLimit.toString());
  const spent = windowOpen ? BigInt(m.spentInWindow.toString()) : 0n;

  return {
    address,
    owner: m.owner,
    agent: m.agent,
    mint: m.mint,
    vault: m.vault,
    merchants: m.merchants,
    maxPerPayment: BigInt(m.maxPerPayment.toString()),
    dailyLimit,
    spentInWindow: spent,
    remainingToday: dailyLimit > spent ? dailyLimit - spent : 0n,
    windowStart,
    windowResetsAt: windowOpen ? windowStart + WINDOW_SECONDS : now,
    expiresAt: m.expiresAt.toNumber(),
    revoked: m.revoked,
    totalSpent: BigInt(m.totalSpent.toString()),
    paymentCount: BigInt(m.paymentCount.toString()),
    vaultBalance,
  };
}

export async function fetchMandate(
  connection: Connection,
  address: PublicKey,
  now = Math.floor(Date.now() / 1000),
): Promise<MandateView> {
  const program = getProgram(connection);
  const m = await program.account.mandate.fetch(address);
  const vault = await getAccount(connection, m.vault, "confirmed");
  return toView(address, m, vault.amount, now);
}

/** Every mandate created by `owner`, newest expiry first. */
export async function listMandatesByOwner(
  connection: Connection,
  owner: PublicKey,
  now = Math.floor(Date.now() / 1000),
): Promise<MandateView[]> {
  const program = getProgram(connection);
  // The owner pubkey sits right after the 8-byte account discriminator.
  const rows = await program.account.mandate.all([{ memcmp: { offset: 8, bytes: owner.toBase58() } }]);
  if (!rows.length) return [];
  const vaults = await connection.getMultipleAccountsInfo(rows.map((r) => r.account.vault), "confirmed");
  return rows
    .map((r, i) => {
      const info = vaults[i];
      const amount = info ? unpackAccount(r.account.vault, info).amount : 0n;
      return toView(r.publicKey, r.account, amount, now);
    })
    .sort((a, b) => b.expiresAt - a.expiresAt);
}

/**
 * Instruction builders for wallets that sign elsewhere (a browser extension, a
 * multisig). Each returns plain instructions to put in a transaction.
 */
export async function buildCreateMandate(
  connection: Connection,
  owner: PublicKey,
  args: {
    agent: PublicKey;
    mint: PublicKey;
    maxPerPayment: bigint | number;
    dailyLimit: bigint | number;
    expiresAt: number;
    merchants: PublicKey[];
    deposit?: bigint | number;
  },
): Promise<{ instructions: TransactionInstruction[]; mandate: PublicKey; vault: PublicKey }> {
  const program = getProgram(connection);
  const mandate = mandatePda(owner, args.agent);
  const vault = vaultPda(mandate);
  const instructions = [
    await program.methods
      .createMandate(
        new BN(args.maxPerPayment.toString()),
        new BN(args.dailyLimit.toString()),
        new BN(args.expiresAt),
        args.merchants,
      )
      .accountsPartial({ owner, agent: args.agent, mint: args.mint, mandate, vault })
      .instruction(),
  ];
  if (args.deposit && BigInt(args.deposit) > 0n) {
    instructions.push(
      await program.methods
        .deposit(new BN(args.deposit.toString()))
        .accountsPartial({
          owner,
          mandate,
          mint: args.mint,
          vault,
          ownerTokenAccount: getAssociatedTokenAddressSync(args.mint, owner),
        })
        .instruction(),
    );
  }
  return { instructions, mandate, vault };
}

export async function buildDeposit(
  connection: Connection,
  owner: PublicKey,
  mandate: PublicKey,
  amount: bigint | number,
): Promise<TransactionInstruction[]> {
  const program = getProgram(connection);
  const m = await program.account.mandate.fetch(mandate);
  return [
    await program.methods
      .deposit(new BN(amount.toString()))
      .accountsPartial({
        owner,
        mandate,
        mint: m.mint,
        vault: m.vault,
        ownerTokenAccount: getAssociatedTokenAddressSync(m.mint, owner),
      })
      .instruction(),
  ];
}

export async function buildWithdraw(
  connection: Connection,
  owner: PublicKey,
  mandate: PublicKey,
  amount: bigint | number,
): Promise<TransactionInstruction[]> {
  const program = getProgram(connection);
  const m = await program.account.mandate.fetch(mandate);
  const ownerTokenAccount = getAssociatedTokenAddressSync(m.mint, owner);
  return [
    // The owner may never have held this token; make sure the account exists.
    createAssociatedTokenAccountIdempotentInstruction(owner, ownerTokenAccount, owner, m.mint),
    await program.methods
      .withdraw(new BN(amount.toString()))
      .accountsPartial({ owner, mandate, mint: m.mint, vault: m.vault, ownerTokenAccount })
      .instruction(),
  ];
}

export async function buildRevoke(
  connection: Connection,
  owner: PublicKey,
  mandate: PublicKey,
): Promise<TransactionInstruction[]> {
  const program = getProgram(connection);
  return [await program.methods.revoke().accountsPartial({ owner, mandate }).instruction()];
}

export interface ActivityEntry {
  signature: string;
  time: number | null;
  kind: "create" | "deposit" | "pay" | "rejected" | "revoke" | "withdraw" | "other";
  amount?: bigint;
  /** Wallet that was paid, or that an agent tried to pay. */
  merchant?: string;
  taskId?: string;
  error?: { code: number | null; name: string; message: string };
}

/**
 * Recent activity on a mandate, including payments the program rejected.
 * Reads the transactions that touched the mandate account; no indexer needed
 * at demo scale.
 */
export async function fetchActivity(
  connection: Connection,
  mandate: PublicKey,
  limit = 25,
): Promise<ActivityEntry[]> {
  const sigs = await connection.getSignaturesForAddress(mandate, { limit }, "confirmed");
  if (!sigs.length) return [];
  const txs = await connection.getTransactions(
    sigs.map((s) => s.signature),
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
  );

  const coder = new BorshCoder(idl as Chainwrit);
  const parser = new EventParser(PROGRAM_ID, coder);
  const kinds: Record<string, ActivityEntry["kind"]> = {
    createMandate: "create",
    create_mandate: "create",
    deposit: "deposit",
    pay: "pay",
    revoke: "revoke",
    withdraw: "withdraw",
  };

  return txs.flatMap((tx, i) => {
    if (!tx?.meta) return [];
    const signature = sigs[i].signature;
    const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const events = parser.parseLogs(tx.meta.logMessages ?? []);
    const paidTo = [...events].find((ev) => ev.name === "paymentExecuted" || ev.name === "PaymentExecuted");

    // One transaction can carry several program instructions (create + deposit).
    return tx.transaction.message.compiledInstructions
      .filter((c) => keys[c.programIdIndex].equals(PROGRAM_ID))
      .map((ix) => {
        const decoded = coder.instruction.decode(Buffer.from(ix.data));
        const kind = (decoded && kinds[decoded.name]) || "other";
        const data = (decoded?.data ?? {}) as { amount?: BN; taskId?: string; task_id?: string };
        const entry: ActivityEntry = {
          signature,
          time: tx.blockTime ?? null,
          kind,
          amount: data.amount ? BigInt(data.amount.toString()) : undefined,
          taskId: data.taskId ?? data.task_id,
        };

        if (kind === "pay") {
          // Pay accounts: agent, mandate, mint, vault, merchant_token_account.
          const merchantIdx = ix.accountKeyIndexes[4];
          entry.merchant = paidTo
            ? (paidTo.data as any).merchant.toBase58()
            : [...(tx.meta!.postTokenBalances ?? []), ...(tx.meta!.preTokenBalances ?? [])].find(
                (b) => b.accountIndex === merchantIdx,
              )?.owner;
        }
        if (tx.meta!.err) {
          entry.error = decodeError(tx.meta!.err);
          if (kind === "pay") entry.kind = "rejected";
        }
        return entry;
      });
  });
}

export async function createMandate(
  connection: Connection,
  owner: Keypair,
  args: {
    agent: PublicKey;
    mint: PublicKey;
    maxPerPayment: bigint | number;
    dailyLimit: bigint | number;
    expiresAt: number;
    merchants: PublicKey[];
  },
): Promise<{ signature: string; mandate: PublicKey; vault: PublicKey }> {
  const program = getProgram(connection, owner);
  const mandate = mandatePda(owner.publicKey, args.agent);
  const vault = vaultPda(mandate);
  const signature = await program.methods
    .createMandate(
      new BN(args.maxPerPayment.toString()),
      new BN(args.dailyLimit.toString()),
      new BN(args.expiresAt),
      args.merchants,
    )
    .accountsPartial({ owner: owner.publicKey, agent: args.agent, mint: args.mint, mandate, vault })
    .rpc();
  return { signature, mandate, vault };
}

export async function deposit(
  connection: Connection,
  owner: Keypair,
  mandate: PublicKey,
  amount: bigint | number,
): Promise<string> {
  const program = getProgram(connection, owner);
  const m = await program.account.mandate.fetch(mandate);
  return program.methods
    .deposit(new BN(amount.toString()))
    .accountsPartial({
      owner: owner.publicKey,
      mandate,
      mint: m.mint,
      vault: m.vault,
      ownerTokenAccount: getAssociatedTokenAddressSync(m.mint, owner.publicKey),
    })
    .rpc();
}

export async function revoke(
  connection: Connection,
  owner: Keypair,
  mandate: PublicKey,
): Promise<string> {
  const program = getProgram(connection, owner);
  return program.methods.revoke().accountsPartial({ owner: owner.publicKey, mandate }).rpc();
}

export async function withdraw(
  connection: Connection,
  owner: Keypair,
  mandate: PublicKey,
  amount: bigint | number,
): Promise<string> {
  const program = getProgram(connection, owner);
  const m = await program.account.mandate.fetch(mandate);
  return program.methods
    .withdraw(new BN(amount.toString()))
    .accountsPartial({
      owner: owner.publicKey,
      mandate,
      mint: m.mint,
      vault: m.vault,
      ownerTokenAccount: getAssociatedTokenAddressSync(m.mint, owner.publicKey),
    })
    .rpc();
}

export type PayResult =
  | { ok: true; signature: string }
  | { ok: false; signature: string | null; code: number | null; name: string; message: string };

/**
 * Ask the program to pay `merchant` (a wallet address) from the mandate vault.
 *
 * With `landOnChain`, preflight is skipped so a rejected payment is still
 * recorded as a failed transaction. That costs a fee but gives an Explorer
 * link proving the chain itself refused it.
 */
export async function pay(
  connection: Connection,
  agent: Keypair,
  mandate: PublicKey,
  args: { merchant: PublicKey; amount: bigint | number; taskId?: string },
  opts: { landOnChain?: boolean; commitment?: Commitment } = {},
): Promise<PayResult> {
  const program = getProgram(connection, agent);
  const m = await program.account.mandate.fetch(mandate);
  const merchantTokenAccount = getAssociatedTokenAddressSync(m.mint, args.merchant, true);

  const ix = await program.methods
    .pay(new BN(args.amount.toString()), args.taskId ?? "")
    .accountsPartial({
      agent: agent.publicKey,
      mandate,
      mint: m.mint,
      vault: m.vault,
      merchantTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const commitment = opts.commitment ?? "confirmed";
  const latest = await connection.getLatestBlockhash(commitment);
  const tx = new Transaction({ feePayer: agent.publicKey, ...latest }).add(ix);
  tx.sign(agent);

  const sendOpts: SendOptions = { skipPreflight: !!opts.landOnChain, preflightCommitment: commitment };
  let signature: string | null = null;
  try {
    signature = await connection.sendRawTransaction(tx.serialize(), sendOpts);
    const res = await connection.confirmTransaction({ signature, ...latest }, commitment);
    if (res.value.err) return { ok: false, signature, ...decodeError(res.value.err) };
    return { ok: true, signature };
  } catch (err) {
    return { ok: false, signature, ...decodeError(err) };
  }
}

/** Check a confirmed transaction's outcome, e.g. when verifying an X-PAYMENT header. */
export async function decodeTransactionError(connection: Connection, signature: string) {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const custom = (tx?.meta?.err as any)?.InstructionError?.[1]?.Custom;
  return typeof custom === "number" ? errorFromCode(custom) : null;
}

export function explorerTx(signature: string, cluster = "devnet"): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

export function explorerAddress(address: PublicKey | string, cluster = "devnet"): string {
  return `https://explorer.solana.com/address/${address.toString()}?cluster=${cluster}`;
}

/** 1.5 -> 1_500_000 for a 6-decimal mint. */
export function toBaseUnits(amount: number, decimals = 6): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

export function fromBaseUnits(amount: bigint, decimals = 6): number {
  return Number(amount) / 10 ** decimals;
}
