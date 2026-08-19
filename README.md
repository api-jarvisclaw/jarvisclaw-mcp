# JarvisClaw MCP Server

<!-- mcp-name: io.github.api-jarvisclaw/jarvisclaw -->

**320 AI models and 2,720 pay-per-call APIs through one MCP server.** Settles in USDC on
Base or Solana over [x402](https://x402.org) — no account, no API key, no subscription.

Three ways to reach a service:

- **Models** — 320 of them (GPT-5, Claude Opus 5, Gemini 3, DeepSeek) behind one
  OpenAI-compatible `chat` tool, or `auto` to let the router pick.
- **API marketplace** — 2,720 individually priced endpoints across 18 categories
  (search, blockchain, code, DNS, image, document, OCR, email, geo, TTS…). Search it,
  read the price, then call it.
- **AIP intents** — 21 intent types. Say what you need (`web_search`,
  `image_generation`, `translation`…) and AIP resolves it to a provider, so the caller
  never has to know the URL layout.

## Quick start

### Direct URL (recommended)

For Claude Code, Cursor, or any client with Streamable HTTP transport — one less hop
than the stdio bridge below.

**With x402 USDC** (no account; the wallet pays per call):

```json
{
  "mcpServers": {
    "jarvisclaw": {
      "type": "url",
      "url": "https://api.jarvisclaw.ai/mcp"
    }
  }
}
```

**With an API key** (pre-paid account):

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

### npm package (stdio bridge)

For clients that only speak stdio. This package is a thin bridge to the same URL, so
prefer the direct form above when your client supports it.

```bash
npx jarvisclaw-mcp
```

## Tools

| Tool | What it does | Billed |
|------|--------------|:------:|
| `list_models` | Every model available, with the IDs to pass to `chat` | free |
| `search_apis` | Search the 2,720-endpoint marketplace; each hit carries its path and price | free |
| `aip_list_intents` | Browse the 21 intent types AIP can route | free |
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
          → agent signs a USDC authorization
          → retry with PAYMENT-SIGNATURE → result
```

Both chains are live, which most x402 sellers cannot say: settle wherever the agent
already holds USDC rather than bridging to reach one gateway. Every paid response
carries an EIP-712 signed settlement receipt that a third party can verify offline —
recompute the hashes, recover the signer, check the tx on-chain — without trusting us.

## Links

- **Website** — https://jarvisclaw.ai
- **API docs** — https://docs.jarvisclaw.ai
- **Python SDK (AIP)** — https://pypi.org/project/agent-intent-protocol/
- **x402 discovery** — https://api.jarvisclaw.ai/.well-known/x402
- **A2A agent card** — https://api.jarvisclaw.ai/.well-known/agent-card.json
- **x402scan** — https://www.x402scan.com/server/e26bd614-0441-4af5-83db-53ab301e85d6

## License

MIT
