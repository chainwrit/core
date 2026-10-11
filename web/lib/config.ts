import "server-only";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const PRICE_BASE_UNITS = 250_000n; // 0.25 dUSDC
export const DECIMALS = 6;
export const SYMBOL = "dUSDC";

export function config() {
  return {
    rpcUrl: process.env.RPC_URL ?? "https://api.devnet.solana.com",
    programId: new PublicKey(env("PROGRAM_ID")),
    mint: new PublicKey(env("MINT")),
    mandate: new PublicKey(env("MANDATE")),
    merchantA: new PublicKey(env("MERCHANT_A")),
    attacker: new PublicKey(env("ATTACKER")),
    // Mandates whose payments the merchant accepts as proof, e.g. the web demo
    // agent plus an agent running in an MCP client.
    acceptedMandates: (process.env.ACCEPTED_MANDATES ?? env("MANDATE"))
      .split(",")
      .map((s) => new PublicKey(s.trim())),
  };
}

let conn: Connection | null = null;
export function connection(): Connection {
  conn ??= new Connection(config().rpcUrl, "confirmed");
  return conn;
}

export function agentKeypair(): Keypair {
  return Keypair.fromSecretKey(bs58.decode(env("AGENT_SECRET_KEY")));
}
