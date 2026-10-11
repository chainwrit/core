import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  SendOptions,
  Transaction,
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

/** Anchor needs a wallet even for read-only use; a throwaway key is fine. */
export function getProgram(connection: Connection, signer?: Keypair): Program<Chainwrit> {
  const wallet = new Wallet(signer ?? Keypair.generate());
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

export async function fetchMandate(
  connection: Connection,
  address: PublicKey,
  now = Math.floor(Date.now() / 1000),
): Promise<MandateView> {
  const program = getProgram(connection);
  const m = await program.account.mandate.fetch(address);
  const vault = await getAccount(connection, m.vault, "confirmed");

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
    vaultBalance: vault.amount,
  };
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
