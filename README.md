# JarvisClaw MCP Server

<!-- mcp-name: io.github.api-jarvisclaw/jarvisclaw -->

AI API Gateway with 80+ models, smart routing, and USDC micropayments via x402.

## Quick Start

### Option 1: Direct URL (Recommended)

For Claude Code, Cursor, or any MCP client with URL transport:

**With API Key (pre-paid account):**

```json
{
  "mcpServers": {
    "jarvisclaw": {
      "type": "url",
      "url": "https://api.jarvisclaw.ai/mcp",
      "headers": {
        "Authorization": "Bearer sk-your-api-key"
      }
    }
  }
}
```

**With x402 USDC (no account needed — wallet pays per call):**

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

> x402 payment is handled automatically by agents with USDC wallets (Base or Solana). No API key or account required — just connect and pay per request.

### Option 2: npm package (stdio bridge)

For clients that only support stdio transport:

```bash
npx jarvisclaw-mcp
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_models` | List all available AI models |
| `chat` | Call any model (OpenAI-compatible format) |
| `search_apis` | Search user-published APIs in the marketplace |
| `get_api_detail` | Get API endpoint details |
| `discover_agents` | Find other registered agents |

## Authentication

| Method | Header | Use case |
|--------|--------|----------|
| API Key | `Authorization: Bearer sk-...` | Pre-paid account |
| x402 USDC | `PAYMENT-SIGNATURE: ...` | No account needed, wallet pays directly on Base or Solana |

Discovery methods (`initialize`, `tools/list`, `resources/list`) are free — no auth needed. Only `tools/call` requires payment.

### x402 Payment Flow

```
Agent connects to MCP → calls tools/call → server returns 402 with payment terms
→ Agent signs USDC payment → retries with PAYMENT-SIGNATURE header → success
```

No sign-up. No API key. Any agent with a USDC wallet on Base or Solana can use JarvisClaw instantly.

## Supported Models

GPT-5, GPT-4.1, Claude Sonnet/Opus, Gemini 2.5, DeepSeek V4, Qwen 3, and 80+ more.

## Links

- **Website**: https://jarvisclaw.ai
- **API Docs**: https://docs.jarvisclaw.ai
- **MCP Docs**: https://docs.jarvisclaw.ai/mcp
- **Dashboard**: https://api.jarvisclaw.ai
- **x402scan**: https://www.x402scan.com/server/e26bd614-0441-4af5-83db-53ab301e85d6

## License

MIT
