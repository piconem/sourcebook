#!/usr/bin/env -S npx tsx
/**
 * Sourcebook MCP server over stdio, for MCP clients that launch a local process
 * (Claude Code, Claude Desktop, …). Talks to a running Sourcebook server.
 *   SOURCEBOOK_URL                  default http://127.0.0.1:4000
 *   SOURCEBOOK_MCP_READONLY=1       read-only tools only
 *   SOURCEBOOK_MCP_AGENT_ID / SOURCEBOOK_MCP_AGENT_NAME   identity of this agent (author of its comments and
 *                                  notifications); one per agent when several work on the same project.
 *                                  SOURCEBOOK_MCP_AUTHOR_USERNAME / _NAME are accepted too.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpSettings } from "@sourcebook/shared";
import { httpApi } from "./api.js";
import { createSourcebookMcpServer, optionsFromEnv } from "./server.js";

const url = process.env.SOURCEBOOK_URL || "http://127.0.0.1:4000";
const api = httpApi(url, fetch, "stdio");
// Settings chosen in Sourcebook (Settings → AI assistant). The server enforces them on every call anyway;
// reading them here only avoids offering write tools in read-only mode.
const settings = await api.json<McpSettings>("GET", "/api/settings/mcp").catch(() => null);
if (settings && !settings.stdio.enabled) console.error("sourcebook-mcp: stdio access is disabled in Sourcebook settings; calls will be refused.");
const env = optionsFromEnv();
const server = createSourcebookMcpServer(api, { ...env, readOnly: env.readOnly || !!settings?.readOnly });
await server.connect(new StdioServerTransport());
// stdout is the protocol channel: diagnostics go to stderr.
console.error(`sourcebook-mcp: connected over stdio, using ${url}`);
