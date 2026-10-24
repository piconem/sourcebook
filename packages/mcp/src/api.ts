import { AsyncLocalStorage } from "node:async_hooks";
import { AGENT_HEADER } from "@sourcebook/shared";

/** The agent named by the tool call being run (sent as a header: the server signs with it). */
export const agentContext = new AsyncLocalStorage<string | undefined>();

/** How the MCP tools reach Sourcebook: its REST API, over HTTP (stdio server) or in-process (/mcp endpoint). */
export interface SourcebookApi {
  /** JSON request; resolves with the parsed body (undefined for 204), rejects with ApiError. */
  json<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  /** Raw text response (Markdown export, reference files). */
  text(path: string): Promise<{ text: string; contentType: string; size: number }>;
  /** Binary response (page images), base64-encoded. */
  bytes(path: string): Promise<{ base64: string; contentType: string }>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Identifies MCP changes in live events (the web editor shows "changed by the assistant"). */
export const CLIENT_HEADER = { "x-sourcebook-client": "mcp" };
export type McpTransport = "stdio" | "http";
/**
 * Tells the server which transport is used, so it can apply the MCP settings (enabled, read-only), and who the
 * agent is (its token).
 */
const headersFor = (transport: McpTransport, token?: string): Record<string, string> => {
  const agent = agentContext.getStore();
  return {
    ...CLIENT_HEADER,
    "x-sourcebook-mcp-transport": transport,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(agent ? { [AGENT_HEADER]: agent } : {}),
  };
};

const errorFrom = (status: number, raw: string) => {
  try {
    const body = JSON.parse(raw);
    return new ApiError(status, body.error ?? `HTTP ${status}`, body.details);
  } catch {
    return new ApiError(status, raw || `HTTP ${status}`);
  }
};

/** REST API over HTTP (e.g. http://127.0.0.1:4000, or with a base path: https://example.org/marco/sourcebook). */
export function httpApi(baseUrl: string, fetchImpl: typeof fetch = fetch, transport: McpTransport = "stdio", token?: string): SourcebookApi {
  const base = baseUrl.replace(/\/+$/, "");
  const call = async (method: string, path: string, body?: unknown) => {
    let res: Response;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: { ...headersFor(transport, token), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError(0, `Cannot reach the Sourcebook server at ${base} (${(e as Error).message}). Is it running (pnpm dev)?`);
    }
    return res;
  };
  return {
    async json(method, path, body) {
      const res = await call(method, path, body);
      const raw = await res.text();
      if (!res.ok) throw errorFrom(res.status, raw);
      return (raw ? JSON.parse(raw) : undefined) as never;
    },
    async text(path) {
      const res = await call("GET", path);
      const raw = await res.text();
      if (!res.ok) throw errorFrom(res.status, raw);
      return { text: raw, contentType: res.headers.get("content-type") ?? "", size: Number(res.headers.get("content-length") ?? raw.length) };
    },
    async bytes(path) {
      const res = await call("GET", path);
      if (!res.ok) throw errorFrom(res.status, await res.text());
      return { base64: Buffer.from(await res.arrayBuffer()).toString("base64"), contentType: res.headers.get("content-type") ?? "" };
    },
  };
}

/** Minimal shape of Fastify's inject() used in-process by the server's /mcp endpoint. */
export interface Injectable {
  inject(opts: {
    method: string;
    url: string;
    payload?: string;
    headers?: Record<string, string>;
  }): Promise<{ statusCode: number; body: string; rawPayload?: Buffer; headers: Record<string, unknown> }>;
}

/** In-process REST API; `prefix` is the server's base path, `token` the agent's (requests act as that agent). */
export function injectApi(app: Injectable, transport: McpTransport = "http", opts: { prefix?: string; token?: string } = {}): SourcebookApi {
  const call = (method: string, url: string, body?: unknown) =>
    app.inject({
      method,
      url: (opts.prefix ?? "") + url,
      payload: body === undefined ? undefined : JSON.stringify(body),
      headers: { ...headersFor(transport, opts.token), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    });
  return {
    async json(method, path, body) {
      const res = await call(method, path, body);
      if (res.statusCode >= 400) throw errorFrom(res.statusCode, res.body);
      return (res.body ? JSON.parse(res.body) : undefined) as never;
    },
    async text(path) {
      const res = await call("GET", path);
      if (res.statusCode >= 400) throw errorFrom(res.statusCode, res.body);
      return { text: res.body, contentType: String(res.headers["content-type"] ?? ""), size: Number(res.headers["content-length"] ?? res.body.length) };
    },
    async bytes(path) {
      const res = await call("GET", path);
      if (res.statusCode >= 400) throw errorFrom(res.statusCode, res.body);
      return { base64: (res.rawPayload ?? Buffer.from(res.body, "binary")).toString("base64"), contentType: String(res.headers["content-type"] ?? "") };
    },
  };
}
