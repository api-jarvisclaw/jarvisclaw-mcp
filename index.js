#!/usr/bin/env node

/**
 * JarvisClaw MCP Server (stdio bridge)
 *
 * This package bridges stdio transport to the remote JarvisClaw MCP server.
 * For clients that support URL transport (Claude Code, Cursor), connect directly:
 *
 *   "url": "https://api.jarvisclaw.ai/mcp"
 *
 * This stdio wrapper is provided for compatibility with clients that only
 * support local stdio-based MCP servers.
 */

const { spawn } = require('child_process');

const REMOTE_URL = 'https://api.jarvisclaw.ai/mcp';

// Use mcp-remote to bridge stdio ↔ Streamable HTTP
const child = spawn('npx', ['-y', 'mcp-remote@latest', REMOTE_URL], {
  stdio: ['pipe', 'pipe', 'inherit'],
  shell: process.platform === 'win32',
});

process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);

child.on('error', (err) => {
  console.error(`JarvisClaw MCP: Failed to start bridge — ${err.message}`);
  console.error(`Tip: Connect directly via URL transport instead:`);
  console.error(`  "url": "${REMOTE_URL}"`);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

// Forward signals
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
