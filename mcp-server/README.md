# @chainwrit/mcp-server

An MCP server (stdio) that gives an AI agent a wallet it cannot misuse. The agent can ask to pay; a [Chainwrit](https://github.com/chainwrit/core) mandate on Solana decides whether the payment happens: allowlisted merchants only, a per-payment cap, a rolling 24-hour cap, an expiry, and instant revocation by the owner.

Runs on **devnet** with `dUSDC`, a test mint with no value. The program has not been audited.

## Setup

1. Create a mandate at https://chainwrit-app.vercel.app: connect a wallet, get test dUSDC from the faucet, then **New mandate → Generate** and download the agent key file.
2. Add the server to your MCP client. For Claude Desktop, edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "chainwrit": {
      "command": "npx",
      "args": ["-y", "@chainwrit/mcp-server"],
      "env": {
        "RPC_URL": "https://api.devnet.solana.com",
        "AGENT_KEYPAIR_PATH": "/absolute/path/to/agent-xxxxxx.json",
        "MANDATE": "<mandate address from the app>"
      }
    }
  }
}
```

3. Restart the client and ask it to "check my mandate".

Requires Node.js 22 (or 20.18+) on the machine running the client.

## Environment

| Variable | |
| --- | --- |
| `AGENT_KEYPAIR_PATH` | Agent key file (JSON array of 64 bytes). Required. |
| `MANDATE` | Mandate address. Required unless `DEPLOYMENTS_PATH` provides one. |
| `RPC_URL` | Solana RPC. Defaults to public devnet. |
| `DEPLOYMENTS_PATH` | Optional deployments JSON, used for the mandate address and merchant names. |

## Tools

| Tool | What it does |
| --- | --- |
| `get_mandate` | Owner, allowlist, caps, spend in the last 24h, remaining, expiry, revoked, vault balance |
| `pay_merchant { merchant, amount, memo? }` | Sends a payment. Returns the Explorer link, or the program's rejection decoded |
| `fetch_page { url }` | Page text including hidden elements, the way a naive scraper sees it |
| `buy_data { url }` | x402-style purchase: GET, 402 with requirements, pay, retry with `X-PAYMENT: <signature>` |

Try `buy_data` with `https://chainwrit.vercel.app/api/merchant/report` (the app's default merchant), and `fetch_page` with `https://chainwrit.vercel.app/gpu-prices`, which hides an instruction to pay an attacker.

## License

Apache-2.0
