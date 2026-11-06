# btcnotar-mcp

**MCP server for [btcnotar](https://www.npmjs.com/package/btcnotar): let AI agents prove that a text or a file existed at a certain time — on the Bitcoin blockchain.**

- **Free.** No key, no bitcoin, no account. The public server pays the fee.
- **Private.** Only the SHA-256 hash is sent. Files never leave your computer.
- **Trustless.** Proofs are checked against the Bitcoin blockchain itself.

Works with Claude Desktop, Claude Code, Cursor, VS Code and any other MCP client.

## Install

### Claude Desktop

Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "btcnotar": {
      "command": "npx",
      "args": ["-y", "btcnotar-mcp"]
    }
  }
}
```

Restart Claude Desktop.

### Claude Code

```bash
claude mcp add btcnotar -- npx -y btcnotar-mcp
```

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "btcnotar": { "command": "npx", "args": ["-y", "btcnotar-mcp"] }
  }
}
```

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "btcnotar": { "type": "stdio", "command": "npx", "args": ["-y", "btcnotar-mcp"] }
  }
}
```

Needs Node.js 18 or newer.

## What you can ask

> Notarize `C:\docs\contract.pdf` on Bitcoin.

> Is `contract.pdf` on the blockchain yet? If yes, save the proof next to it.

> Notarize all files in this folder.

> Check `contract.pdf.btcnotar.json` against `contract.pdf`.

## Tools

| Tool | What it does |
|---|---|
| `notarize` | Send a text, file or hash. Returns `pending` and the time it goes on Bitcoin (about 1 hour). |
| `notarize_many` | Many texts, files or hashes in one call (one Bitcoin transaction). |
| `check` | Is it on the blockchain? Verifies the proof on the chain. Returns block and date. |
| `save_proof` | Save the proof file `<file>.btcnotar.json`. Keep it with the document. |
| `verify_proof_file` | Verify a saved proof file (and optionally the document). No btcnotar server needed. |
| `hash` | SHA-256 of a text or file. Nothing is sent. |

Flow: `notarize` → wait about 1 hour → `check` → `save_proof`.

## Settings (optional)

| Variable | Default |
|---|---|
| `BTCNOTAR_SERVER` | free public server |
| `BTCNOTAR_NETWORK` | `mainnet` |
| `BTCNOTAR_MEMPOOL_API` | `https://mempool.space/api` |

Add them in the `env` part of the config:

```json
{ "command": "npx", "args": ["-y", "btcnotar-mcp"], "env": { "BTCNOTAR_NETWORK": "testnet" } }
```

## Support ⚡

Free to use — the server pays the Bitcoin fees. Like it? Send sats to **`trappedknight861@walletofsatoshi.com`**.

## License

MIT
