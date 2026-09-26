import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSourcebookMcpServer, injectApi, optionsFromEnv, type Injectable } from "@sourcebook/mcp";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SettingsStore } from "../store/SettingsStore.js";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const hostname = (value: string) => value.replace(/:\d+$/, "").toLowerCase();

/**
 * Rejects requests that do not come from this machine: the Host header must be local (DNS-rebinding
 * protection) and a browser Origin, when present, must be local too.
 */
function localOnly(req: FastifyRequest, reply: FastifyReply): boolean {
  const host = hostname(req.headers.host ?? "");
  let originOk = true;
  if (req.headers.origin) {
    try {
      originOk = LOCAL_HOSTS.has(new URL(req.headers.origin).hostname.toLowerCase());
    } catch {
      originOk = false;
    }
  }
  if (LOCAL_HOSTS.has(host) && originOk) return true;
  reply.code(403).send({ jsonrpc: "2.0", error: { code: -32000, message: "Sourcebook MCP only accepts local requests" }, id: null });
  return false;
}

/**
 * MCP over Streamable HTTP at /mcp (stateless: a fresh MCP server per request). Tools reach the REST API
 * in-process through app.inject, so every change goes through the same validation, locking and live events.
 */
export function mcpRoutes(root: FastifyInstance, settings: SettingsStore) {
  const api = injectApi(root as unknown as Injectable, "http");
  return async (app: FastifyInstance) => {
    app.post("/mcp", async (req, reply) => {
      if (!localOnly(req, reply)) return;
      const mcp = settings.getMcp();
      if (!mcp.http.enabled) {
        reply.code(503).send({ jsonrpc: "2.0", error: { code: -32000, message: "The Sourcebook MCP server over HTTP is disabled (Settings → AI assistant)." }, id: null });
        return;
      }
      const env = optionsFromEnv();
      const server = createSourcebookMcpServer(api, { ...env, readOnly: env.readOnly || mcp.readOnly });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      reply.hijack();
      reply.raw.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    });
    const notAllowed = async (req: FastifyRequest, reply: FastifyReply) => {
      if (!localOnly(req, reply)) return;
      reply.code(405).header("allow", "POST").send({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: use POST)" }, id: null });
    };
    app.get("/mcp", notAllowed);
    app.delete("/mcp", notAllowed);
  };
}
