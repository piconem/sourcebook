import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  AGENT_ID_HEADER,
  AGENT_NAME_HEADER,
  DEFAULT_AUTHOR,
  createSourcebookMcpServer,
  injectApi,
  optionsFromEnv,
  withAgent,
  type Injectable,
} from "@sourcebook/mcp";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Author } from "@sourcebook/shared";
import type { SettingsStore } from "../store/SettingsStore.js";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const hostname = (value: string) => value.replace(/:\d+$/, "").toLowerCase();

/**
 * Rejects requests that do not come from this machine or from the public address of this Sourcebook: the Host
 * header must be one of them (DNS-rebinding protection) and a browser Origin, when present, too.
 */
function localOnly(req: FastifyRequest, reply: FastifyReply, publicHost: string): boolean {
  const host = hostname(req.headers.host ?? "");
  let originOk = true;
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin).hostname.toLowerCase();
      originOk = LOCAL_HOSTS.has(origin) || origin === publicHost;
    } catch {
      originOk = false;
    }
  }
  if ((LOCAL_HOSTS.has(host) || host === publicHost) && originOk) return true;
  reply.code(403).send({ jsonrpc: "2.0", error: { code: -32000, message: "Sourcebook MCP only accepts local requests" }, id: null });
  return false;
}

/**
 * MCP over Streamable HTTP at /mcp (stateless: a fresh MCP server per request). With accounts, every request
 * carries an agent token (Authorization: Bearer sbk_…): the tools act as that agent, with the rights of its user.
 * Single-user mode: the connection's identity comes from the x-sourcebook-agent-id / -name headers or the
 * agent_id / agent_name query parameters. Tools reach the REST API in-process through app.inject, so every change
 * goes through the same validation, permissions, locks and live events.
 */
export function mcpRoutes(root: FastifyInstance, settings: SettingsStore, opts: { basePath: string; publicUrl: string; authEnabled: boolean }) {
  const publicHost = new URL(opts.publicUrl).hostname.toLowerCase();
  return async (app: FastifyInstance) => {
    app.post("/mcp", async (req, reply) => {
      if (!localOnly(req, reply, publicHost)) return;
      const mcp = settings.getMcp();
      if (!mcp.http.enabled) {
        reply.code(503).send({ jsonrpc: "2.0", error: { code: -32000, message: "The Sourcebook MCP server over HTTP is disabled (Settings → AI assistant)." }, id: null });
        return;
      }
      const env = optionsFromEnv();
      const token = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ""))?.[1];
      let author: Author = { ...(env.author ?? DEFAULT_AUTHOR), kind: "assistant" };
      if (opts.authEnabled) {
        if (!req.principal || !token) {
          reply
            .code(401)
            .header("www-authenticate", "Bearer")
            .send({ jsonrpc: "2.0", error: { code: -32001, message: "Sourcebook needs your access token: Authorization: Bearer sbu_… (Settings → My agents)" }, id: null });
          return;
        }
        // Each tool call names its agent (or uses the user's default); the server signs with it.
        author = req.principal.author;
      } else {
        // Each agent can identify its connection (headers, or ?agent_id=…&agent_name=… on the URL).
        const query = req.query as Record<string, string | undefined>;
        const header = (name: string) => [req.headers[name]].flat()[0];
        try {
          author = { ...withAgent(author, header(AGENT_ID_HEADER) ?? query.agent_id, header(AGENT_NAME_HEADER) ?? query.agent_name), kind: "assistant" };
        } catch (e) {
          reply.code(400).send({ jsonrpc: "2.0", error: { code: -32602, message: (e as Error).message }, id: null });
          return;
        }
      }
      const api = injectApi(root as unknown as Injectable, "http", { prefix: opts.basePath, token });
      const server = createSourcebookMcpServer(api, { ...env, author, readOnly: env.readOnly || mcp.readOnly });
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
      if (!localOnly(req, reply, publicHost)) return;
      reply.code(405).header("allow", "POST").send({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: use POST)" }, id: null });
    };
    app.get("/mcp", notAllowed);
    app.delete("/mcp", notAllowed);
  };
}
