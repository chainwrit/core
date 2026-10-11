import "server-only";
import fs from "fs";
import path from "path";

export interface Deployments {
  program: string;
  mint: string;
  mandate: string;
  vault: string;
  merchantA: string;
  attacker: string;
  proof?: Record<string, string>;
}

// The repo's deployments/devnet.json is the source of truth; it holds public
// addresses only. Env vars win so a deployment can point at another mandate.
export function deployments(): Deployments {
  let file: Partial<Deployments> = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "deployments", "devnet.json"), "utf8"));
  } catch {}
  return {
    program: process.env.PROGRAM_ID ?? file.program ?? "",
    mint: process.env.MINT ?? file.mint ?? "",
    mandate: process.env.MANDATE ?? file.mandate ?? "",
    vault: file.vault ?? "",
    merchantA: process.env.MERCHANT_A ?? file.merchantA ?? "",
    attacker: process.env.ATTACKER ?? file.attacker ?? "",
    proof: file.proof ?? {},
  };
}

export const GITHUB_URL = "https://github.com/chainwrit/core";
export const explorer = (kind: "address" | "tx", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
