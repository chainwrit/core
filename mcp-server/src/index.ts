#!/usr/bin/env node
// Chainwrit MCP server (stdio). Gives an agent a wallet it cannot misuse: it
// can ask to pay, and the on-chain mandate decides whether the payment happens.
import fs from "fs";
import os from "os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { z } from "zod";
import {
  explorerTx,
  fetchMandate,
  fromBaseUnits,
  pay,
  toBaseUnits,
} from "@chainwrit/sdk";

const expandHome = (p: string) => (p.startsWith("~") ? os.homedir() + p.slice(1) : p);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const deployments = process.env.DEPLOYMENTS_PATH
  ? JSON.parse(fs.readFileSync(expandHome(process.env.DEPLOYMENTS_PATH), "utf8"))
  : {};

const connection = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const agent = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(expandHome(required("AGENT_KEYPAIR_PATH")), "utf8"))),
);
const mandate = new PublicKey(process.env.MANDATE ?? deployments.mandate);
const decimals: number = deployments.decimals ?? 6;
const symbol: string = deployments.mintSymbol ?? "dUSDC";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fmt = (n: bigint) => `${fromBaseUnits(n, decimals)} ${symbol}`;

// Taken from deployments so the model sees names instead of bare addresses.
const knownNames: Record<string, string> = {};
if (deployments.merchantA) knownNames[deployments.merchantA] = "merchant A (data API)";

async function payMerchant(merchant: string, amount: number, memo?: string) {
  let merchantKey: PublicKey;
  try {
    merchantKey = new PublicKey(merchant);
  } catch {
    return { ok: false as const, report: `"${merchant}" is not a valid Solana address.` };
  }

  const r = await pay(
    connection,
    agent,
    mandate,
    { merchant: merchantKey, amount: toBaseUnits(amount, decimals), taskId: (memo ?? "").slice(0, 32) },
    { landOnChain: true },
  );

  if (r.ok) {
    return {
      ok: true as const,
      signature: r.signature,
      report: `Paid ${amount} ${symbol} to ${merchant}.\nSignature: ${r.signature}\nExplorer: ${explorerTx(r.signature)}`,
    };
  }
  return {
    ok: false as const,
    report:
      `The chain refused this payment. The Chainwrit program rejected it; no funds moved.\n` +
      `Reason: ${r.name} (${r.message}).` +
      (r.signature ? `\nFailed transaction: ${explorerTx(r.signature)}` : ""),
  };
}

const server = new McpServer({ name: "chainwrit", version: "0.1.0" });

server.tool(
  "get_mandate",
  "Show the spending mandate this agent operates under: allowed merchants, caps, what has been spent in the last 24 hours, expiry, and vault balance.",
  {},
  async () => {
    const m = await fetchMandate(connection, mandate);
    const now = Math.floor(Date.now() / 1000);
    const hours = (s: number) => `${Math.max(0, Math.round((s - now) / 360) / 10)}h`;
    return text(
      [
        `Mandate ${mandate.toBase58()} (devnet, token: ${symbol}, a test mint)`,
        `Owner: ${m.owner.toBase58()}`,
        `Agent: ${m.agent.toBase58()}`,
        `Allowed merchants:`,
        ...m.merchants.map((k) => `  - ${k.toBase58()}${knownNames[k.toBase58()] ? ` (${knownNames[k.toBase58()]})` : ""}`),
        `Per-payment cap: ${fmt(m.maxPerPayment)}`,
        `24h cap: ${fmt(m.dailyLimit)}; spent in current window: ${fmt(m.spentInWindow)}; remaining: ${fmt(m.remainingToday)}` +
          (m.spentInWindow > 0n ? `; resets in ${hours(m.windowResetsAt)}` : ""),
        `Expires: ${new Date(m.expiresAt * 1000).toISOString()}`,
        `Revoked: ${m.revoked ? "yes" : "no"}`,
        `Vault balance: ${fmt(m.vaultBalance)}`,
        `Lifetime: ${m.paymentCount} payments, ${fmt(m.totalSpent)}`,
      ].join("\n"),
    );
  },
);

server.tool(
  "pay_merchant",
  `Pay a merchant from the mandate vault. Amount is in ${symbol}. The on-chain program enforces the mandate and will reject payments outside it.`,
  {
    merchant: z.string().describe("Merchant wallet address (base58)"),
    amount: z.number().positive().describe(`Amount in ${symbol}, e.g. 0.5`),
    memo: z.string().optional().describe("Short task tag recorded with the payment (max 32 chars)"),
  },
  async ({ merchant, amount, memo }) => text((await payMerchant(merchant, amount, memo)).report),
);

/** Strip markup but keep every piece of text, hidden or not, like a naive scraper. */
function pageText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|section|article|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

server.tool(
  "fetch_page",
  "Fetch a web page and return its text content.",
  { url: z.string().url() },
  async ({ url }) => {
    const res = await fetch(url, { headers: { "user-agent": "chainwrit-agent/0.1" } });
    const body = await res.text();
    const type = res.headers.get("content-type") ?? "";
    return text(type.includes("html") ? pageText(body) : body);
  },
);

server.tool(
  "buy_data",
  "Buy data from a paid API that uses an x402-style flow: the API answers 402 with payment requirements, the agent pays through the mandate, then retries with the payment signature.",
  { url: z.string().url() },
  async ({ url }) => {
    const first = await fetch(url);
    if (first.status !== 402) return text(`No payment needed (HTTP ${first.status}):\n${await first.text()}`);

    const req = (await first.json()) as {
      amount: string;
      decimals?: number;
      recipient: string;
      mint: string;
      program: string;
      reference: string;
    };
    const amount = Number(req.amount) / 10 ** (req.decimals ?? decimals);

    const paid = await payMerchant(req.recipient, amount, req.reference);
    if (!paid.ok) return text(`The API asked for ${amount} ${symbol} to ${req.recipient}.\n${paid.report}`);

    const second = await fetch(url, { headers: { "X-PAYMENT": paid.signature } });
    const body = await second.text();
    return text(`${paid.report}\n\nAPI response (HTTP ${second.status}):\n${body}`);
  },
);

server.connect(new StdioServerTransport()).catch((err) => {
  console.error(err);
  process.exit(1);
});
