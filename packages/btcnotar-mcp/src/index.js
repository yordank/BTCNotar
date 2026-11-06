#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer();
await server.connect(new StdioServerTransport());
// stdout is the MCP channel: log only to stderr.
console.error("btcnotar MCP server running (stdio)");
