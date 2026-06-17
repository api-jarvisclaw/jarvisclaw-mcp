# JarvisClaw MCP Server

<!-- mcp-name: io.github.api-jarvisclaw/jarvisclaw -->

AI API Gateway with 80+ models, smart routing, and USDC micropayments via x402.

## Quick Start

### Option 1: Direct URL (Recommended)

For Claude Code, Cursor, or any MCP client with URL transport:

**Claude Code** (`~/.claude.json`):
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

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "jarvisclaw": {
      "url": "https://api.jarvisclaw.ai/mcp",
      "headers": {
        "Authorization": "Bearer sk-your-api-key"
      }
    }
  }
}
```

### Option 2: npm package (stdio bridge)

For clients that only support stdio transport:

```bash
npx @jarvisclaw/mcp-server
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
| x402 USDC | `PAYMENT-SIGNATURE: ...` | No account needed, wallet pays directly |

Discovery methods (`initialize`, `tools/list`, `resources/list`) are free — no auth needed. Only `tools/call` requires payment.

## Supported Models

GPT-5, GPT-4.1, Claude Sonnet/Opus, Gemini 2.5, DeepSeek V4, Qwen 3, and 80+ more.

## Links

- **Website**: https://jarvisclaw.ai
- **API Docs**: https://docs.jarvisclaw.ai
- **MCP Docs**: https://docs.jarvisclaw.ai/mcp
- **Dashboard**: https://api.jarvisclaw.ai

## License

MIT
