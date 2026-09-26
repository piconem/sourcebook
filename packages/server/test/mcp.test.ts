import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSourcebookMcpServer, injectApi, type Injectable } from "@sourcebook/mcp";
import type { NotebookEvent } from "@sourcebook/shared";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { tempProject } from "./helpers.js";

async function setup(opts: { readOnly?: boolean } = {}) {
  const workspace = await tempProject();
  const built = await buildApp(workspace, { configDir: await tempProject() });
  const { app } = built;
  const rest = async (method: string, url: string, payload?: object) => (await app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown> })).json();
  // A small project: §1 Overview (markdown), §1.1 Scope (code), §2 Design
  await rest("POST", "/api/projects", { name: "Demo" });
  const base = "/api/projects/demo";
  const overview = await rest("POST", `${base}/blocks`, { title: "Overview" });
  await rest("PATCH", `${base}/blocks/${overview.id}`, { objective: "Explain the system" });
  const md = await rest("POST", `${base}/blocks/${overview.id}/subblocks`, { type: "markdown", content: { markdown: "The API is **REST**.\n\nIt returns JSON.\n" }, title: "Summary" });
  const scope = await rest("POST", `${base}/blocks`, { title: "Scope", parentId: overview.id });
  const code = await rest("POST", `${base}/blocks/${scope.id}/subblocks`, { type: "code", content: { language: "python", code: "import os\n\ndef main():\n    print('hi')\n" } });
  const design = await rest("POST", `${base}/blocks`, { title: "Design" });

  const server = createSourcebookMcpServer(injectApi(app as unknown as Injectable), { readOnly: opts.readOnly });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
    return { text: res.content.map((c) => c.text).join("\n"), isError: !!res.isError };
  };
  const ok = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args);
    if (r.isError) throw new Error(`${name} failed: ${r.text}`);
    return r.text;
  };
  return { app, built, rest, client, call, ok, ids: { overview: overview.id, md: md.id, scope: scope.id, code: code.id, design: design.id } };
}

describe("MCP server: discovery", () => {
  it("exposes read, write, comment and destructive tools with annotations", async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "add_comment", "add_subblock", "create_project", "create_section", "create_template", "delete_comment", "delete_section", "delete_subblock",
      "edit_subblock_text", "get_outline", "list_comments", "list_references", "list_workspace", "move_section", "move_subblock",
      "read_document", "read_reference", "read_section", "read_subblock", "reanchor_comment", "reply_to_comment", "search",
      "update_section", "update_subblock",
    ]);
    expect(tools.find((t) => t.name === "delete_section")?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "get_outline")?.annotations?.readOnlyHint).toBe(true);
    expect(client.getInstructions()).toMatch(/§2\.1#3:L10-14/);
  });

  it("read-only mode only offers reading tools", async () => {
    const { client } = await setup({ readOnly: true });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("get_outline");
    expect(names.some((n) => /^(create|add|update|edit|move|delete|reply|reanchor)_/.test(n))).toBe(false);
  });
});

describe("MCP server: reading", () => {
  it("lists the workspace and shows a numbered outline with ids", async () => {
    const { ok, ids } = await setup();
    expect(await ok("list_workspace")).toMatch(/projects\/demo — "Demo" · 3 sections/);
    const outline = await ok("get_outline", { project: "demo" });
    expect(outline).toContain(`§1 Overview  (id ${ids.overview})`);
    expect(outline).toContain("objective: Explain the system");
    expect(outline).toMatch(new RegExp(`#1 markdown · "Summary" · 3 lines · rev 0 · id ${ids.md}`));
    expect(outline).toContain(`  §1.1 Scope  (id ${ids.scope})`);
    expect(outline).toMatch(/#1 code\/python · 4 lines/);
    expect(outline).toContain(`§2 Design  (id ${ids.design})`);
  });

  it("resolves §-references, ids and URIs to the same sub-block, with line ranges", async () => {
    const { ok, ids } = await setup();
    const byNumber = await ok("read_subblock", { project: "demo", subblock: "§1.1#1" });
    expect(byNumber).toContain("   3 | def main():".trim());
    expect(await ok("read_subblock", { project: "demo", subblock: ids.code })).toBe(byNumber);
    expect(await ok("read_subblock", { project: "demo", subblock: `sourcebook://projects/demo/subblocks/${ids.code}` })).toBe(byNumber);
    const range = await ok("read_subblock", { project: "demo", subblock: "§1.1#1:L3-4" });
    expect(range).toContain("(lines 3-4 of 4)");
    expect(range).not.toContain("import os");
    const section = await ok("read_section", { project: "demo", section: "§1" });
    expect(section).toContain("The API is **REST**.");
    expect(section).toContain("sub-sections: §1.1 Scope");
  });

  it("explains bad references instead of failing obscurely", async () => {
    const { call } = await setup();
    const missing = await call("read_section", { project: "demo", section: "§9" });
    expect(missing).toEqual({ isError: true, text: expect.stringMatching(/no section §9 .* 3 sections/) });
    expect((await call("read_subblock", { project: "demo", subblock: "§1#5" })).text).toMatch(/has 1 sub-block\(s\); there is no #5/);
    expect((await call("read_section", { project: "demo", section: "hello there" })).text).toMatch(/Cannot understand the reference/);
    expect((await call("get_outline", { project: "nope" })).text).toMatch(/404/);
  });

  it("searches with precise references and reads the whole document", async () => {
    const { ok } = await setup();
    expect(await ok("search", { project: "demo", query: "print" })).toContain("§1.1#1:L4  print('hi')");
    expect(await ok("search", { project: "demo", query: "overview" })).toContain("§1 (section title) Overview");
    expect(await ok("read_document", { project: "demo" })).toContain("## Overview");
  });
});

describe("MCP server: writing and editing", () => {
  it("creates sections and sub-blocks, then edits them precisely", async () => {
    const { ok, rest } = await setup();
    expect(await ok("create_section", { project: "demo", title: "Goals", parent: "§1", position: 1, objective: "Why" })).toMatch(/Created §1\.1 "Goals" .* under §1/);
    expect(await ok("get_outline", { project: "demo" })).toMatch(/§1\.2 Scope/); // Scope shifted

    expect(await ok("add_subblock", { project: "demo", section: "§1.1", type: "code", language: "typescript", content: "const a = 1;\nconst b = 2;\n", title: "Constants" })).toMatch(/Added §1\.1#1 code "Constants"/);
    const edit = await ok("edit_subblock_text", { project: "demo", subblock: "§1.1#1", edits: [{ find: "const b = 2;", replace: "const b = 3;" }, { lines: { first: 3, last: 2 }, text: "const c = a + b;" }] });
    expect(edit).toMatch(/Applied 2 edit\(s\) .* now rev 1, 3 lines/);
    expect(await ok("read_subblock", { project: "demo", subblock: "§1.1#1", lineNumbers: false })).toContain("const a = 1;\nconst b = 3;\nconst c = a + b;");

    await ok("update_subblock", { project: "demo", subblock: "§1.1#1", language: "javascript" });
    expect(await ok("read_subblock", { project: "demo", subblock: "§1.1#1" })).toContain("language javascript");
    await ok("update_section", { project: "demo", section: "§1.1", title: "Goals and non-goals", objective: "" });
    const project = await rest("GET", "/api/projects/demo/notebook");
    expect(project.blocks.map((b: { title: string }) => b.title)).toEqual(["Overview", "Goals and non-goals", "Scope", "Design"]);
  });

  it("reports conflicts and failed edits without changing anything", async () => {
    const { call, ok } = await setup();
    const stale = await call("update_subblock", { project: "demo", subblock: "§1#1", content: "x", expectedRev: 7 });
    expect(stale).toEqual({ isError: true, text: expect.stringMatching(/409.*changed in the meantime.*current rev 0/) });
    const ambiguous = await call("edit_subblock_text", { project: "demo", subblock: "§1#1", edits: [{ find: "e", replace: "E" }] });
    expect(ambiguous.text).toMatch(/occurs \d+ times/);
    expect(await ok("read_subblock", { project: "demo", subblock: "§1#1" })).toContain("rev 0");
    expect((await call("add_subblock", { project: "demo", section: "§2", type: "markdown", content: "<script>x</script>" })).text).toMatch(/Invalid markdown/);
  });

  it("moves sections and sub-blocks, and deletes them", async () => {
    const { ok, ids } = await setup();
    expect(await ok("move_section", { project: "demo", section: "§1.1", parent: "root", position: 1 })).toBe(`Moved "Scope" (id ${ids.scope}) from §1.1 to §1.`);
    await ok("add_subblock", { project: "demo", section: "§3", type: "mermaid", content: "graph LR; A-->B" });
    await ok("add_subblock", { project: "demo", section: "§3", type: "equation", content: "E = mc^2" });
    expect(await ok("move_subblock", { project: "demo", subblock: "§3#2", position: 1 })).toMatch(/from §3#2 to §3#1/);
    expect(await ok("read_section", { project: "demo", section: "§3" })).toMatch(/§3#1 equation[\s\S]*§3#2 mermaid/);
    expect(await ok("delete_subblock", { project: "demo", subblock: "§3#1" })).toMatch(/Deleted §3#1 equation/);
    expect(await ok("delete_section", { project: "demo", section: "§2" })).toMatch(/Deleted §2 "Overview"/);
    expect(await ok("get_outline", { project: "demo" })).toMatch(/— 2 sections/);
  });

  it("creates projects from templates and edits templates", async () => {
    const { ok } = await setup();
    expect(await ok("create_template", { name: "Demo template", fromProject: "demo" })).toMatch(/templates\/demo-template .* 3 section/);
    await ok("update_section", { project: "templates/demo-template", section: "§2", title: "Architecture" });
    expect(await ok("create_project", { name: "Checkout", fromTemplate: "demo-template" })).toMatch(/projects\/checkout "Checkout" with 3 section\(s\) from template "Demo template"/);
    expect(await ok("get_outline", { project: "checkout" })).toContain("§2 Architecture");
  });
});

describe("MCP server: comments", () => {
  it("comments on lines and quotes as the assistant, replies, re-anchors and deletes", async () => {
    const { ok, rest, ids } = await setup();
    expect(await ok("add_comment", { project: "demo", subblock: "§1.1#1:L3-4", text: "Add a docstring" })).toMatch(/\[comment \S+\] §1\.1#1:L3-4 — Claude \(assistant\) \(@claude, assistant\)/);
    await ok("add_comment", { project: "demo", subblock: "§1#1", quote: "returns JSON", text: "Which schema?" });
    await ok("add_comment", { project: "demo", subblock: "§1#1", text: "General remark" });

    const list = await ok("list_comments", { project: "demo" });
    expect(list).toMatch(/§1#1:L3 — Claude/); // markdown: "It returns JSON." is on line 3 of the .md
    expect(list).toContain('quote: "returns JSON"');
    expect(list).toMatch(/§1#1 \(whole sub-block\)/);
    expect(list).toMatch(/§1\.1#1:L3-4/);

    const commentId = /\[comment (\S+)\] §1\.1#1:L3-4/.exec(list)![1];
    expect(await ok("reply_to_comment", { project: "demo", comment: commentId, text: "Done." })).toMatch(/Replied to comment/);
    const thread = await rest("GET", `/api/projects/demo/blocks/${ids.scope}/subblocks/${ids.code}/comments`);
    expect(thread.comments[0].author).toEqual({ name: "Claude (assistant)", username: "claude", kind: "assistant" });
    expect(thread.comments[0].replies[0].text).toBe("Done.");

    // The code changes: the comment follows its lines; then it is re-anchored and deleted.
    await ok("edit_subblock_text", { project: "demo", subblock: "§1.1#1", edits: [{ lines: { first: 1, last: 0 }, text: "import sys" }] });
    expect(await ok("list_comments", { project: "demo", target: "§1.1#1" })).toMatch(/§1\.1#1:L4-5/);
    expect(await ok("reanchor_comment", { project: "demo", comment: `§1.1#1!c${commentId}`, lines: { first: 1, last: 2 } })).toMatch(/now on §1\.1#1:L1-2/);
    expect(await ok("delete_comment", { project: "demo", comment: commentId })).toMatch(/Deleted comment .* and its 1 repl/);
    expect(await ok("list_comments", { project: "demo", target: "§1.1" })).toBe("No comments.");
  });

  it("rejects anchors on types without text", async () => {
    const { call, ok } = await setup();
    await ok("add_subblock", { project: "demo", section: "§2", type: "equation", content: "x^2" });
    expect((await call("add_comment", { project: "demo", subblock: "§2#1:L1", text: "?" })).text).toMatch(/only take comments on the whole sub-block/);
    expect(await ok("add_comment", { project: "demo", subblock: "§2#1", text: "Is this squared?" })).toMatch(/whole sub-block/);
  });
});

describe("MCP server: references, resources, prompts, live events", () => {
  it("lists and reads text references, refusing binaries", async () => {
    const { app, ok } = await setup();
    const boundary = "----r";
    const upload = (name: string, data: string) =>
      app.inject({
        method: "POST",
        url: "/api/projects/demo/references/upload?dir=docs",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n\r\n${data}\r\n--${boundary}--\r\n`,
      });
    await upload("spec.md", "# Spec\nMust be fast.");
    await upload("paper.pdf", "%PDF-1.4");
    expect(await ok("list_references", { project: "demo" })).toMatch(/docs\/\n  paper\.pdf .*\n  spec\.md \(\d+ bytes\) — path "docs\/spec\.md"/);
    expect(await ok("read_reference", { project: "demo", path: "docs/spec.md" })).toBe("# Spec\nMust be fast.");
    expect(await ok("read_reference", { project: "demo", path: "docs/paper.pdf" })).toMatch(/not a text format/);
  });

  it("offers resources with stable URIs and prompts", async () => {
    const { client, ids } = await setup();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("sourcebook://projects/demo/outline");
    const sub = await client.readResource({ uri: `sourcebook://projects/demo/subblocks/${ids.code}` });
    expect((sub.contents[0] as { text: string }).text).toContain("§1.1#1 code");
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name).sort();
    expect(prompts).toEqual(["discuss-comments", "fill-placeholders", "review-section"]);
    const p = await client.getPrompt({ name: "review-section", arguments: { project: "demo", section: "§1" } });
    expect((p.messages[0].content as { text: string }).text).toContain("Review section §1");
  });

  it("changes made through MCP reach the live event stream as origin 'mcp'", async () => {
    const { built, ok } = await setup();
    const { store } = await built.workspace.open("projects", "demo");
    const events: NotebookEvent[] = [];
    store.events.on("event", (e: NotebookEvent) => events.push(e));
    await ok("edit_subblock_text", { project: "demo", subblock: "§1#1", edits: [{ find: "REST", replace: "HTTP" }] });
    expect(events).toEqual([expect.objectContaining({ type: "subblock", rev: 1, origin: "mcp" })]);
  });
});

describe("MCP over HTTP (/mcp)", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());

  it("serves the same tools to a Streamable HTTP client", async () => {
    const { app } = await setup();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    close = () => app.close();
    const client = new Client({ name: "http-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`)));
    expect((await client.listTools()).tools.length).toBe(24);
    const res = (await client.callTool({ name: "get_outline", arguments: { project: "demo" } })) as { content: { text: string }[] };
    expect(res.content[0].text).toContain("§1.1 Scope");
    await client.close();
  });

  it("rejects non-local hosts and origins", async () => {
    const { app } = await setup();
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
    const evil = await app.inject({ method: "POST", url: "/mcp", headers: { host: "evil.example", "content-type": "application/json" }, payload: body });
    expect(evil.statusCode).toBe(403);
    const origin = await app.inject({ method: "POST", url: "/mcp", headers: { host: "127.0.0.1:4000", origin: "https://evil.example", "content-type": "application/json" }, payload: body });
    expect(origin.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/mcp", headers: { host: "localhost:4000" } })).statusCode).toBe(405);
  });
});
