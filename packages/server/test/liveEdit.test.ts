import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { PNG_B64, buildProjectApp, tempProject } from "./helpers.js";

async function setup() {
  const { app, root } = await buildProjectApp();
  const call = async (method: string, url: string, payload?: object, headers?: Record<string, string>) => {
    const res = await app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown>, headers });
    return { status: res.statusCode, body: res.headers["content-type"]?.toString().includes("json") ? res.json() : res.body };
  };
  const b = (await call("POST", "/api/blocks", { title: "Intro" })).body;
  const code = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "code", content: { language: "python", code: "a = 1\nb = 2\nc = 3\n" } })).body;
  const md = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "markdown", content: { markdown: "The API is REST.\nIt returns JSON.\n" } })).body;
  const edit = (sub: { id: string }, body: object) => call("POST", `/api/blocks/${b.id}/subblocks/${sub.id}/edit`, body);
  return { root, call, b, code, md, edit };
}

describe("sub-block revisions", () => {
  it("starts at 0, increments on content changes only, and rejects stale writes", async () => {
    const { call, b, code } = await setup();
    expect(code.rev).toBe(0);
    const url = `/api/blocks/${b.id}/subblocks/${code.id}`;
    const r1 = (await call("PATCH", url, { content: { language: "python", code: "x = 1\n" }, expectedRev: 0 })).body;
    expect(r1.rev).toBe(1);
    expect((await call("PATCH", url, { title: "Setup" })).body.rev).toBe(1); // metadata only
    const stale = await call("PATCH", url, { content: { language: "python", code: "y = 2\n" }, expectedRev: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.details).toEqual({ currentRev: 1 });
    expect((await call("GET", `/api/blocks/${b.id}`)).body.subBlocks[0]).toMatchObject({ rev: 1, content: { code: "x = 1\n" } });
  });

  it("drops stale exports when content changes without new ones", async () => {
    const { root, call, b } = await setup();
    const mm = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "mermaid", content: { code: "graph LR; A-->B" } })).body;
    const url = `/api/blocks/${b.id}/subblocks/${mm.id}`;
    await call("PATCH", url, { content: { code: "graph LR; A-->B" }, exports: [{ ext: "png", mimeType: "image/png", dataBase64: PNG_B64 }] });
    expect(existsSync(join(root, "blocks/001-intro/subblocks/03-mermaid.png"))).toBe(true);
    const r = (await call("PATCH", url, { content: { code: "graph LR; A-->C" } })).body;
    expect(r.exports).toEqual([]);
    expect(existsSync(join(root, "blocks/001-intro/subblocks/03-mermaid.png"))).toBe(false);
  });
});

describe("text edits", () => {
  it("replaces a unique text and reports ambiguity or absence without writing", async () => {
    const { root, edit, md } = await setup();
    const ok = await edit(md, { edits: [{ find: "REST", replace: "GraphQL" }] });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ rev: 1, content: { markdown: "The API is GraphQL.\nIt returns JSON.\n" } });

    const ambiguous = await edit(md, { edits: [{ find: "e", replace: "E" }] });
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.error).toMatch(/occurs \d+ times/);
    const missing = await edit(md, { edits: [{ find: "nope", replace: "x" }] });
    expect(missing.body.error).toMatch(/text not found/);
    // Second edit fails: the first one is not applied either.
    const partial = await edit(md, { edits: [{ find: "GraphQL", replace: "gRPC" }, { find: "absent", replace: "x" }] });
    expect(partial.body.error).toMatch(/^Edit 2: text not found/);
    expect(await readFile(join(root, "blocks/001-intro/subblocks/02-markdown.md"), "utf8")).toBe("The API is GraphQL.\nIt returns JSON.\n");

    expect((await edit(md, { edits: [{ find: "e", replace: "E", all: true }] })).body.content.markdown).toBe("ThE API is GraphQL.\nIt rEturns JSON.\n");
  });

  it("replaces, deletes and inserts source lines", async () => {
    const { edit, code } = await setup();
    const r = await edit(code, { edits: [{ lines: { first: 2, last: 2 }, text: "b = 20\nb2 = 21" }] });
    expect(r.body.content.code).toBe("a = 1\nb = 20\nb2 = 21\nc = 3\n");
    expect((await edit(code, { edits: [{ lines: { first: 1, last: 1 }, text: "" }] })).body.content.code).toBe("b = 20\nb2 = 21\nc = 3\n");
    // Insert before line 1 (last = first - 1) and append after the last line
    expect((await edit(code, { edits: [{ lines: { first: 1, last: 0 }, text: "import os" }, { lines: { first: 5, last: 4 }, text: "d = 4" }] })).body.content.code).toBe(
      "import os\nb = 20\nb2 = 21\nc = 3\nd = 4\n",
    );
    const out = await edit(code, { edits: [{ lines: { first: 9, last: 9 }, text: "x" }] });
    expect(out.status).toBe(400);
    expect(out.body.error).toMatch(/outside the text \(5 lines\)/);
  });

  it("validates the result and honours expectedRev", async () => {
    const { edit, md } = await setup();
    const bad = await edit(md, { edits: [{ find: "REST", replace: "<script>x</script>" }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Invalid markdown/);
    expect((await edit(md, { edits: [{ find: "REST", replace: "HTTP" }], expectedRev: 5 })).status).toBe(409);
  });
});

describe("live events", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());

  it("streams changes with the origin of the client that made them", async () => {
    const workspace = await tempProject();
    const { app } = await buildApp(workspace, { auth: false, configDir: await tempProject() });
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Live" } });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    close = () => app.close();
    const controller = new AbortController();
    const res = await fetch(`${address}/api/projects/live/events`, { signal: controller.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const received: object[] = [];
    const pump = (async () => {
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        buf += new TextDecoder().decode(value);
        for (const m of buf.matchAll(/^data: (.+)$/gm)) received.push(JSON.parse(m[1]));
        buf = buf.slice(buf.lastIndexOf("\n") + 1);
      }
    })();

    const post = (url: string, body: object, client?: string) =>
      fetch(`${address}${url}`, { method: "POST", headers: { "content-type": "application/json", ...(client ? { "x-sourcebook-client": client } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
    const blk = await post("/api/projects/live/blocks", { title: "A" }, "tab-1");
    const sub = await post(`/api/projects/live/blocks/${blk.id}/subblocks`, { type: "markdown", content: { markdown: "hi\n" } }, "mcp");
    await post(`/api/projects/live/blocks/${blk.id}/subblocks/${sub.id}/edit`, { edits: [{ find: "hi", replace: "hello" }] }, "mcp");
    await post(`/api/projects/live/blocks/${blk.id}/subblocks/${sub.id}/comments`, { text: "ok?" });
    await post("/api/projects/live/references/folders", { path: "docs" }, "mcp");
    for (let i = 0; i < 50 && received.length < 5; i++) await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    await pump;

    expect(received).toEqual([
      { type: "blocks", blockId: blk.id, origin: "tab-1" },
      { type: "block", blockId: blk.id, subBlockId: sub.id, origin: "mcp" },
      { type: "subblock", blockId: blk.id, subBlockId: sub.id, rev: 1, origin: "mcp" },
      { type: "comments", blockId: blk.id, subBlockId: sub.id, origin: "api" },
      { type: "references", origin: "mcp" },
    ]);
  });
});
