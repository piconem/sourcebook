/** How the MCP tools reach Sourcebook: its REST API, over HTTP (stdio server) or in-process (/mcp endpoint). */
export interface SourcebookApi {
  /** JSON request; resolves with the parsed body (undefined for 204), rejects with ApiError. */
  json<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  /** Raw text response (Markdown export, reference files). */
  text(path: string): Promise<{ text: string; contentType: string; size: number }>;
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
/** Tells the server which transport is used, so it can apply the MCP settings (enabled, read-only). */
const headersFor = (transport: McpTransport) => ({ ...CLIENT_HEADER, "x-sourcebook-mcp-transport": transport });

const errorFrom = (status: number, raw: string) => {
  try {
    const body = JSON.parse(raw);
    return new ApiError(status, body.error ?? `HTTP ${status}`, body.details);
  } catch {
    return new ApiError(status, raw || `HTTP ${status}`);
  }
};

/** REST API over HTTP (e.g. http://127.0.0.1:4000). */
export function httpApi(baseUrl: string, fetchImpl: typeof fetch = fetch, transport: McpTransport = "stdio"): SourcebookApi {
  const base = baseUrl.replace(/\/+$/, "");
  const call = async (method: string, path: string, body?: unknown) => {
    let res: Response;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: { ...headersFor(transport), ...(body === undefined ? {} : { "content-type": "application/json" }) },
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
  };
}

/** Minimal shape of Fastify's inject() used in-process by the server's /mcp endpoint. */
export interface Injectable {
  inject(opts: {
    method: string;
    url: string;
    payload?: string;
    headers?: Record<string, string>;
  }): Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }>;
}

export function injectApi(app: Injectable, transport: McpTransport = "http"): SourcebookApi {
  const call = (method: string, url: string, body?: unknown) =>
    app.inject({
      method,
      url,
      payload: body === undefined ? undefined : JSON.stringify(body),
      headers: { ...headersFor(transport), ...(body === undefined ? {} : { "content-type": "application/json" }) },
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
  };
}
