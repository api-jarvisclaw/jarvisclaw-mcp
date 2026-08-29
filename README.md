# JarvisClaw MCP Server

<!-- mcp-name: io.github.api-jarvisclaw/jarvisclaw -->

**283 AI models and 2,720 pay-per-call APIs through one MCP server.** Settles in USDC on
Base or Solana over [x402](https://x402.org) — no account, no API key, no subscription.

Three ways to reach a service:

- **Models** — 283 of them (GPT-5, Claude Opus 5, Gemini 3, DeepSeek) behind one
  OpenAI-compatible `chat` tool, or `auto` to let the router pick.
- **API marketplace** — 2,720 individually priced endpoints across 40 categories
  (search, blockchain, code, DNS, image, document, OCR, email, geo, TTS…), of which 411
  are curated. Search it, read the price, then call it.
- **AIP intents** — 13 intent types. Say what you need (`web_search`,
  `image_generation`, `translation`…) and AIP resolves it to a provider, so the caller
  never has to know the URL layout.

Counts move as the catalogue changes; `list_models`, `search_apis` and
`aip_list_intents` are the live answer.

## Quick start

### Local wallet signing (recommended for x402)

Run this package. It presents itself to your client as a normal stdio MCP server,
forwards every request to the gateway, and when a call needs paying it signs the x402
payment **on your machine** and retries. Your private key is never transmitted — only
the signed payment payload is.

```bash
JARVISCLAW_WALLET_KEY=0xyourkey npx jarvisclaw-mcp
```

Claude Desktop / Cursor, Base wallet:

```json
{
  "mcpServers": {
    "jarvisclaw": {
      "command": "npx",
      "args": ["-y", "jarvisclaw-mcp"],
      "env": {
        "JARVISCLAW_WALLET_KEY": "0xYOUR_BASE_PRIVATE_KEY",
        "JARVISCLAW_CHAIN": "base"
      }
    }
  }
}
```

Solana wallet:

```json
{
  "mcpServers": {
    "jarvisclaw": {
      "command": "npx",
      "args": ["-y", "jarvisclaw-mcp"],
      "env": {
        "JARVISCLAW_WALLET_KEY": "YOUR_SOLANA_BS58_SECRET_KEY",
        "JARVISCLAW_CHAIN": "solana"
      }
    }
  }
}
```

### Direct URL (no local process)

For Claude Code, Cursor, or any client with Streamable HTTP transport. One less hop,
but there is no wallet in this path: free tools work, and paid tools need a pre-paid
API key, because nothing here can sign a payment.

```json
{
  "mcpServers": {
    "jarvisclaw": {
      "type": "url",
      "url": "https://api.jarvisclaw.ai/mcp",
      "headers": { "Authorization": "Bearer sk-your-api-key" }
    }
  }
}
```

Without the header the same URL still lists the catalogue for free; paid tools answer
with an x402 quote that you would have to sign yourself.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `JARVISCLAW_WALLET_KEY` | for paid tools | — | Base private key (`0x…` hex) or Solana secret key (base58). Used only for local signing. |
| `JARVISCLAW_CHAIN` | no | `base` | `base` or `solana`. Which option to sign when the server offers both. |
| `JARVISCLAW_MCP_URL` | no | `https://api.jarvisclaw.ai/mcp` | Remote MCP endpoint. |
| `JARVISCLAW_SOLANA_RPC` | no | public mainnet RPC | Custom Solana RPC (recommended — the public one is rate-limited). |
| `JARVISCLAW_API_KEY` | no | — | Optional API key sent as `Authorization: Bearer`. Free tools need no credential. |

## Tools

| Tool | What it does | Billed |
|------|--------------|:------:|
| `list_models` | Every model available, with the IDs to pass to `chat` | free |
| `search_apis` | Search the 2,720-endpoint marketplace; each hit carries its path and price | free |
| `aip_list_intents` | Browse the intent types AIP can route | free |
| `aip_estimate_cost` | Price an intent before committing to it | free |
| `chat` | Any model, OpenAI-compatible | paid |
| `get_api_detail` | Full spec for a marketplace API: pricing, method, exact request | paid |
| `discover_agents` | Find other agents registered on the gateway | paid |
| `aip_resolve` | Rank providers for an intent, priced, before you spend | paid |
| `aip_execute_with_budget` | Run a task end to end under a spending cap you set | paid |

Free tools answer without credentials, so you can list the catalogue before deciding to
pay for anything. Protocol methods (`initialize`, `tools/list`, `resources/list`) are
free too.

## Paying

| Method | Header | When |
|--------|--------|------|
| x402 USDC | `PAYMENT-SIGNATURE` | No account. Wallet settles on Base or Solana. |
| API key | `Authorization: Bearer sk-…` | Pre-paid account. |

A paid tool called without either does not fail — it answers with an x402 quote:

```
tools/call → 402 with payment terms (amount, asset, payTo, network)
          → this proxy signs a USDC authorization locally
          → retry with PAYMENT-SIGNATURE → result
```

With `JARVISCLAW_WALLET_KEY` set, all three steps happen inside this process and your
client just sees the result. Without it, the quote is passed through to your client
unanswered.

Both chains are live, which most x402 sellers cannot say: settle wherever the agent
already holds USDC rather than bridging to reach one gateway. Every paid response
carries an EIP-712 signed settlement receipt that a third party can verify offline —
recompute the hashes, recover the signer, check the tx on-chain — without trusting us.

## Security

- The wallet key is read from the environment and used only to sign payment
  authorizations locally. It is never sent to the gateway or anywhere else.
- A safety cap rejects any single payment above 100 USDC, on both chains.
- The USDC contract address, mint, chain IDs and decimals are pinned as protocol
  constants, not configuration — a server cannot talk this proxy into signing a
  transfer of some other asset.

### Dependency advisories

`npm audit` reports 3 moderate advisories reachable through `@solana/web3.js`
(itself, plus `jayson` and `uuid`). 1.98.4 is the latest release and is inside the
flagged range, so there is no version to move to; npm's suggested "fix" is a
downgrade to 0.0.3, which is not a real option. Tracked, not resolved.

This applies to Base-only users too: `@solana/web3.js` is a static import in the
entry module, so it loads whatever `JARVISCLAW_CHAIN` is set to (measured: 6 module
resolutions on the Base path). Only the signer *object* is constructed lazily.

## Building from source

```bash
npm install
npm run build     # tsc → dist/
npm test          # bun test — x402 signer unit tests
```

## Links

- **Website** — https://jarvisclaw.ai
- **API docs** — https://docs.jarvisclaw.ai
- **Python SDK (AIP)** — https://pypi.org/project/agent-intent-protocol/
- **x402 discovery** — https://api.jarvisclaw.ai/.well-known/x402
- **A2A agent card** — https://api.jarvisclaw.ai/.well-known/agent-card.json
- **x402scan** — https://www.x402scan.com/server/e26bd614-0441-4af5-83db-53ab301e85d6

## License

MIT
