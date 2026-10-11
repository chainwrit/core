import fs from "fs";
import os from "os";
import path from "path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

export const ROOT = path.resolve(__dirname, "..");
// One file per mandate, so a demo can run against a fresh daily cap.
export const DEPLOYMENTS = path.resolve(ROOT, process.env.DEPLOYMENTS_FILE ?? "deployments/devnet.json");

// Keypairs live outside the repo so they can never be committed.
export const KEYS_DIR = process.env.KEYS_DIR ?? path.resolve(ROOT, "..", "keys");

export function connection(): Connection {
  return new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
}

export function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

export function loadKeypair(file: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(expandHome(file), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Load a keypair from KEYS_DIR, creating it on first use. */
export function loadOrCreateKey(name: string): Keypair {
  const file = path.join(KEYS_DIR, `${name}.json`);
  if (fs.existsSync(file)) return loadKeypair(file);
  const kp = Keypair.generate();
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

export interface Deployments {
  cluster: "devnet";
  program: string;
  mint: string;
  mintSymbol: string;
  decimals: number;
  owner: string;
  agent: string;
  mandate: string;
  vault: string;
  merchantA: string;
  attacker: string;
  proof?: Record<string, string>;
}

export function readDeployments(): Deployments {
  return JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf8"));
}

export function writeDeployments(d: Deployments) {
  fs.mkdirSync(path.dirname(DEPLOYMENTS), { recursive: true });
  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(d, null, 2) + "\n");
}

export const pk = (s: string) => new PublicKey(s);
