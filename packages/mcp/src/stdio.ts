#!/usr/bin/env -S npx tsx
/**
 * Sourcebook MCP server over stdio, for MCP clients that launch a local process
 * (Claude Code, Claude Desktop, …). Talks to a running Sourcebook server.
 *   SOURCEBOOK_URL                  default http://127.0.0.1:4000 (include the base path, if any)
 *   SOURCEBOOK_TOKEN                your access token (Sourcebook → Settings → My agents); every tool call may
 *                                  name one of your agents (agent: "<id>"), else your default agent acts
 *   SOURCEBOOK_MCP_READONLY=1       read-only tools only
 *   SOURCEBOOK_MCP_AGENT_ID / _NAME only for a Sourcebook without accounts: the identity signing comments
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpSettings, Me } from "@sourcebook/shared";
import { httpApi } from "./api.js";
import { createSourcebookMcpServer, optionsFromEnv } from "./server.js";

const url = process.env.SOURCEBOOK_URL || "http://127.0.0.1:4000";
const token = process.env.SOURCEBOOK_TOKEN || undefined;
const api = httpApi(url, fetch, "stdio", token);
// With accounts, identities come from the token (the user) and each call's agent.
const me = await api.json<Me>("GET", "/api/auth/me").catch((e) => {
  console.error(`sourcebook-mcp: ${(e as Error).message}${token ? "" : " — set SOURCEBOOK_TOKEN to the token of an agent (Sourcebook → Settings → My agents)"}`);
  return null;
});
// Settings chosen in Sourcebook (Settings → AI assistant). The server enforces them on every call anyway;
// reading them here only avoids offering write tools in read-only mode.
const settings = await api.json<McpSettings>("GET", "/api/settings/mcp").catch(() => null);
if (settings && !settings.stdio.enabled) console.error("sourcebook-mcp: stdio access is disabled in Sourcebook settings; calls will be refused.");
const env = optionsFromEnv();
const server = createSourcebookMcpServer(api, {
  ...env,
  ...(me?.agent ? { author: me.author } : {}),
  readOnly: env.readOnly || !!settings?.readOnly,
});
await server.connect(new StdioServerTransport());
// stdout is the protocol channel: diagnostics go to stderr.
console.error(`sourcebook-mcp: connected over stdio, using ${url}`);
