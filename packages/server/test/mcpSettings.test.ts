import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSourcebookMcpServer, injectApi, type Injectable } from "@sourcebook/mcp";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { REPO_ROOT } from "../src/paths.js";
import { tempProject } from "./helpers.js";

async function setup(port?: number, mcpStdio?: boolean) {
  const workspace = await tempProject();
  const configDir = await tempProject();
  const { app } = await buildApp(workspace, { auth: false, configDir, port, mcpStdio });
  const call = async (method: string, url: string, payload?: object, headers?: Record<string, string>) => {
    const res = await app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown>, headers });
    return { status: res.statusCode, body: res.json() };
  };
  await call("POST", "/api/projects", { name: "Demo" });
  return { app, workspace, configDir, call };
}
const stdio = { "x-sourcebook-client": "mcp", "x-sourcebook-mcp-transport": "stdio" };
const http = { "x-sourcebook-client": "mcp", "x-sourcebook-mcp-transport": "http" };

describe("MCP settings", () => {
  it("defaults to both transports enabled and reports connection parameters", async () => {
    const { call } = await setup();
    const s = (await call("GET", "/api/settings/mcp")).body;
    expect(s).toMatchObject({ http: { enabled: true }, stdio: { enabled: true, available: true }, readOnly: false });
    expect(s.connection.http).toEqual({ url: "http://127.0.0.1:4000/mcp", headers: { Authorization: "Bearer <your access token>" } });
    expect(s.connection.stdio).toEqual({
      command: "pnpm",
      args: ["--silent", "--dir", REPO_ROOT, "--filter", "@sourcebook/mcp", "exec", "tsx", "src/stdio.ts"],
      cwd: REPO_ROOT,
      env: { SOURCEBOOK_TOKEN: "<your access token>" },
    });
    expect(REPO_ROOT.endsWith("sourcebook")).toBe(true);
  });

  it("uses the real port in URLs and the stdio environment", async () => {
    const { call } = await setup(4555);
    const s = (await call("GET", "/api/settings/mcp")).body;
    expect(s.connection.http.url).toBe("http://127.0.0.1:4555/mcp");
    expect(s.connection.stdio.env).toEqual({ SOURCEBOOK_URL: "http://127.0.0.1:4555", SOURCEBOOK_TOKEN: "<your access token>" });
  });

  it("persists changes in the workspace's .sourcebook/settings.json and validates them", async () => {
    const { call, configDir, workspace } = await setup();
    const updated = (await call("PUT", "/api/settings/mcp", { stdio: { enabled: false }, readOnly: true })).body;
    expect(updated).toMatchObject({ http: { enabled: true }, stdio: { enabled: false }, readOnly: true });
    expect(JSON.parse(await readFile(join(workspace, ".sourcebook", "settings.json"), "utf8")).mcp).toEqual({ http: { enabled: true }, stdio: { enabled: false }, readOnly: true });
    const { app: again } = await buildApp(workspace, { auth: false, configDir });
    expect((await again.inject({ method: "GET", url: "/api/settings/mcp" })).json()).toMatchObject({ stdio: { enabled: false }, readOnly: true });
    expect((await call("PUT", "/api/settings/mcp", { http: { enabled: "no" } })).status).toBe(400);
  });

  it("refuses calls from a disabled transport; the web editor is never affected", async () => {
    const { call } = await setup();
    await call("PUT", "/api/settings/mcp", { stdio: { enabled: false } });
    const refused = await call("GET", "/api/projects/demo/notebook", undefined, stdio);
    expect(refused).toEqual({ status: 403, body: { error: expect.stringMatching(/over stdio is disabled/) } });
    expect((await call("GET", "/api/settings/mcp", undefined, stdio)).status).toBe(200); // it can still learn why
    expect((await call("GET", "/api/projects/demo/notebook", undefined, http)).status).toBe(200);
    expect((await call("GET", "/api/projects/demo/notebook")).status).toBe(200); // web / API
  });

  it("in a container stdio is unavailable: off, without connection hints, refused, and cannot be turned on", async () => {
    const { call } = await setup(undefined, false);
    const s = (await call("GET", "/api/settings/mcp")).body;
    expect(s.stdio).toEqual({ enabled: false, available: false });
    expect(s.connection.stdio).toBeNull();
    expect(s.connection.http.url).toBe("http://127.0.0.1:4000/mcp");
    expect(await call("GET", "/api/projects/demo/notebook", undefined, stdio)).toEqual({ status: 403, body: { error: expect.stringMatching(/not available in this installation/) } });
    expect((await call("GET", "/api/projects/demo/notebook", undefined, http)).status).toBe(200);
    expect((await call("PUT", "/api/settings/mcp", { stdio: { enabled: true } })).status).toBe(400);
    expect((await call("PUT", "/api/settings/mcp", { readOnly: true })).body.stdio).toEqual({ enabled: false, available: false });
  });

  it("read-only refuses every MCP write but allows reads and the web editor", async () => {
    const { call } = await setup();
    await call("PUT", "/api/settings/mcp", { readOnly: true });
    expect((await call("POST", "/api/projects/demo/blocks", { title: "x" }, http))).toEqual({ status: 403, body: { error: expect.stringMatching(/read-only access/) } });
    expect((await call("GET", "/api/projects/demo/notebook", undefined, http)).status).toBe(200);
    expect((await call("POST", "/api/projects/demo/blocks", { title: "by user" })).status).toBe(201);
  });

  it("an MCP client gets a clear error for writes in read-only mode", async () => {
    const { app, call } = await setup();
    await call("PUT", "/api/settings/mcp", { readOnly: true });
    // A server started before the change still lists write tools: the API refuses them.
    const server = createSourcebookMcpServer(injectApi(app as unknown as Injectable, "stdio"));
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    const client = new Client({ name: "t", version: "1" });
    await client.connect(c);
    const res = (await client.callTool({ name: "create_section", arguments: { project: "demo", title: "x" } })) as { isError?: boolean; content: { text: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/403.*read-only access/);
  });
});

describe("/mcp endpoint and settings", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());

  it("is disabled with HTTP off, and offers only reading tools in read-only mode", async () => {
    const { app, call } = await setup();
    await call("PUT", "/api/settings/mcp", { http: { enabled: false } });
    const off = await app.inject({ method: "POST", url: "/mcp", headers: { host: "127.0.0.1:4000", "content-type": "application/json" }, payload: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(off.statusCode).toBe(503);
    expect(off.json().error.message).toMatch(/over HTTP is disabled/);

    await call("PUT", "/api/settings/mcp", { http: { enabled: true }, readOnly: true });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    close = () => app.close();
    const client = new Client({ name: "t", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`)));
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("get_outline");
    expect(names).not.toContain("create_section");
    await client.close();
  });
});
