import { unzipSync, strFromU8 } from "fflate";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PNG_B64, ls, tempProject, buildProjectApp } from "./helpers.js";

type Json = Record<string, any>;

async function setup() {
  const { app, root, workspace } = await buildProjectApp();
  const call = async (method: string, url: string, payload?: unknown) => {
    const res = await app.inject({ method: method as "GET", url, payload: payload as Json });
    return { status: res.statusCode, body: res.headers["content-type"]?.toString().includes("json") ? (res.json() as Json) : undefined, raw: res.body };
  };
  return { root, app, call, workspace };
}

function multipart(filename: string, data: Buffer) {
  const boundary = "----sourcebook";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("REST API", () => {
  it("validates payloads and returns 404s", async () => {
    const { call } = await setup();
    expect((await call("POST", "/api/blocks", { title: "" })).status).toBe(400);
    expect((await call("GET", "/api/blocks/missing")).status).toBe(404);
    expect((await call("PATCH", "/api/blocks/reorder", { blocks: "x" })).status).toBe(400);
  });

  it("round-trips a project exercising every sub-block type", async () => {
    const { root, app, call, workspace } = await setup();

    const intro = (await call("POST", "/api/blocks", { title: "Introduction" })).body!;
    const arch = (await call("POST", "/api/blocks", { title: "Architecture" })).body!;
    const data = (await call("POST", "/api/blocks", { title: "Data model", parentId: arch.id })).body!;

    const add = async (blockId: string, body: Json) => {
      const res = await call("POST", `/api/blocks/${blockId}/subblocks`, body);
      expect(res.status).toBe(201);
      return res.body!;
    };
    const png = [{ ext: "png", mimeType: "image/png", dataBase64: PNG_B64 }];

    await add(intro.id, { type: "markdown", content: { markdown: "# Why\n\nSome **bold** text.\n" } });
    const eq = await add(intro.id, { type: "equation" });
    await call("PATCH", `/api/blocks/${intro.id}/subblocks/${eq.id}`, { content: { latex: "a^2+b^2=c^2" }, exports: png });

    const mm = await add(arch.id, { type: "mermaid" });
    await call("PATCH", `/api/blocks/${arch.id}/subblocks/${mm.id}`, { content: { code: "graph LR; A-->B" }, exports: png });
    const dr = await add(arch.id, { type: "drawing" });
    const scene = { type: "excalidraw", version: 2, elements: [{ id: "r1", type: "rectangle" }], appState: {}, files: {} };
    await call("PATCH", `/api/blocks/${arch.id}/subblocks/${dr.id}`, { content: scene, exports: png });

    const up = multipart("diagram.png", Buffer.from(PNG_B64, "base64"));
    const asset = await app.inject({ method: "POST", url: `/api/assets?blockId=${data.id}`, ...up });
    expect(asset.statusCode).toBe(201);
    const { path, url } = asset.json();
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(200);
    await add(data.id, { type: "image", content: { src: path, alt: "Schema", caption: "ER diagram" } });

    // On-disk layout
    expect(await ls(join(root, "blocks"))).toEqual(["001-introduction", "002-architecture", "003-data-model"]);
    expect(await ls(join(root, "blocks/001-introduction/subblocks"))).toEqual([
      "01-markdown.md",
      "02-equation.png",
      "02-equation.tex",
    ]);
    expect(await ls(join(root, "blocks/002-architecture/subblocks"))).toEqual([
      "01-mermaid.mmd",
      "01-mermaid.png",
      "02-drawing.excalidraw",
      "02-drawing.png",
    ]);
    expect(await readFile(join(root, "blocks/003-data-model/subblocks/01-image.md"), "utf8")).toBe(
      `![Schema](../${path} "ER diagram")\n`,
    );

    // Combined markdown references exported artifacts and nests headings
    const md = (await call("GET", "/api/project/markdown")).raw;
    expect(md).toContain("## Introduction");
    expect(md).toContain("### Why");
    expect(md).toContain("$$\na^2+b^2=c^2\n$$");
    expect(md).toContain("![Diagram](blocks/002-architecture/subblocks/01-mermaid.png)");
    expect(md).toContain("### Data model");
    expect(md).toContain(`![Schema](blocks/003-data-model/${path} "ER diagram")`);

    // Export archive: document + every referenced file at the same relative path
    const zipRes = await app.inject({ method: "GET", url: "/api/project/export.zip" });
    expect(zipRes.headers["content-type"]).toBe("application/zip");
    const zip = unzipSync(new Uint8Array(zipRes.rawPayload));
    const docName = Object.keys(zip).find((k) => k.endsWith(".md") && !k.includes("/"))!;
    expect(strFromU8(zip[docName])).toBe(md);
    expect(Object.keys(zip).sort()).toEqual(
      [
        docName,
        "blocks/002-architecture/subblocks/01-mermaid.png",
        "blocks/002-architecture/subblocks/02-drawing.png",
        `blocks/003-data-model/${path}`,
      ].sort(),
    );

    // Re-open the same folder with a fresh server: identical project and content
    const before = await Promise.all([intro, arch, data].map((b) => call("GET", `/api/blocks/${b.id}`)));
    const project = (await call("GET", "/api/project")).body;
    const { app: app2 } = await buildProjectApp({ workspace });
    const get2 = async (url: string) => (await app2.inject({ method: "GET", url })).json();
    expect(await get2("/api/project")).toEqual(project);
    for (const b of before) expect(await get2(`/api/blocks/${b.body!.id}`)).toEqual(b.body);
  });

  it("code sub-blocks rename their source file when the language changes", async () => {
    const { root, call } = await setup();
    const b = (await call("POST", "/api/blocks", { title: "Code" })).body!;
    const s = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "code", content: { language: "python", code: "x = 1\n" } })).body!;
    expect(s.source).toBe("01-code.py");
    const u = await call("PATCH", `/api/blocks/${b.id}/subblocks/${s.id}`, { content: { language: "rust", code: "let x = 1;\n" } });
    expect(u.body!.source).toBe("01-code.rs");
    expect(await ls(join(root, "blocks/001-code/subblocks"))).toEqual(["01-code.rs"]);
    expect((await call("GET", `/api/blocks/${b.id}`)).body!.subBlocks[0].content).toEqual({ language: "rust", code: "let x = 1;\n" });
    expect((await call("GET", "/api/project/markdown")).raw).toContain("```rust\nlet x = 1;\n```");
  });

  it("deletes sub-block assets on request, keeping shared ones", async () => {
    const { root, app, call } = await setup();
    const b = (await call("POST", "/api/blocks", { title: "Pics" })).body!;
    const upload = async () =>
      (await app.inject({ method: "POST", url: `/api/assets?blockId=${b.id}`, ...multipart("p.png", Buffer.from(PNG_B64, "base64")) })).json().path as string;
    const [p1, p2] = [await upload(), await upload()];
    const img = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "image", content: { src: p1, alt: "", caption: "" } })).body!;
    const img2 = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "image", content: { src: p2, alt: "", caption: "" } })).body!;
    await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "markdown", content: { markdown: `see ![](../${p2})` } });

    const impact = (await call("GET", `/api/blocks/${b.id}/deletion-impact`)).body!;
    expect(impact.assets.sort()).toEqual([`blocks/001-pics/${p1}`, `blocks/001-pics/${p2}`].sort());

    const r1 = await call("DELETE", `/api/blocks/${b.id}/subblocks/${img.id}?deleteAssets=true`);
    expect(r1.body).toEqual({ deletedAssets: [p1], keptAssets: [] });
    expect(existsSync(join(root, "blocks/001-pics", p1))).toBe(false);

    const r2 = await call("DELETE", `/api/blocks/${b.id}/subblocks/${img2.id}?deleteAssets=true`);
    expect(r2.body).toEqual({ deletedAssets: [], keptAssets: [p2] });
    expect(existsSync(join(root, "blocks/001-pics", p2))).toBe(true);
  });

  it("deletes a replaced asset only when nothing references it", async () => {
    const { root, app, call } = await setup();
    const b = (await call("POST", "/api/blocks", { title: "Pics" })).body!;
    const upload = async () =>
      (await app.inject({ method: "POST", url: `/api/assets?blockId=${b.id}`, ...multipart("p.png", Buffer.from(PNG_B64, "base64")) })).json().path as string;
    const [oldPath, newPath] = [await upload(), await upload()];
    const img = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "image", content: { src: oldPath, alt: "", caption: "" } })).body!;
    const oldName = oldPath.split("/")[1];

    expect((await call("DELETE", `/api/blocks/${b.id}/assets/${oldName}`)).status).toBe(409);
    await call("PATCH", `/api/blocks/${b.id}/subblocks/${img.id}`, { content: { src: newPath, alt: "", caption: "" } });
    expect((await call("DELETE", `/api/blocks/${b.id}/assets/${oldName}`)).status).toBe(204);
    expect(existsSync(join(root, "blocks/001-pics", oldPath))).toBe(false);
    expect((await call("DELETE", `/api/blocks/${b.id}/assets/${oldName}`)).status).toBe(404);
    expect((await call("DELETE", `/api/blocks/${b.id}/assets/..%2Fblock.json`)).status).toBe(400);
  });

  it("stores titles and objectives and exports objectives as comments", async () => {
    const { root, call } = await setup();
    const b = (await call("POST", "/api/blocks", { title: "Storage" })).body!;
    const s = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "markdown", content: { markdown: "# Detail\n\nText" } })).body!;
    expect((await call("PATCH", `/api/blocks/${b.id}`, { objective: "Explain why files --> not a DB" })).status).toBe(200);
    await call("PATCH", `/api/blocks/${b.id}/subblocks/${s.id}`, { title: "Layout", objective: "Line one\nLine two" });

    const block = (await call("GET", `/api/blocks/${b.id}`)).body!;
    expect(block.objective).toBe("Explain why files --> not a DB");
    expect(block.subBlocks[0]).toMatchObject({ title: "Layout", objective: "Line one\nLine two", content: { markdown: "# Detail\n\nText" } });
    const meta = JSON.parse(await readFile(join(root, "blocks/001-storage/block.json"), "utf8"));
    expect(meta.objective).toBe("Explain why files --> not a DB");

    const md = (await call("GET", "/api/project/markdown")).raw;
    expect(md).toContain("## Storage\n\n<!-- Objective: Explain why files - -> not a DB -->");
    expect(md).toContain("### Layout\n\n<!-- Objective:\nLine one\nLine two\n-->\n\n#### Detail");

    // Blank values remove the fields
    await call("PATCH", `/api/blocks/${b.id}`, { objective: "  " });
    await call("PATCH", `/api/blocks/${b.id}/subblocks/${s.id}`, { title: "", objective: "" });
    const cleared = (await call("GET", `/api/blocks/${b.id}`)).body!;
    expect(cleared.objective).toBeUndefined();
    expect(cleared.subBlocks[0].title).toBeUndefined();
    expect((await call("GET", "/api/project/markdown")).raw).not.toContain("Objective");
  });

  it("reorders sub-blocks and blocks via the API", async () => {
    const { root, call } = await setup();
    const a = (await call("POST", "/api/blocks", { title: "A" })).body!;
    const b = (await call("POST", "/api/blocks", { title: "B" })).body!;
    const s1 = (await call("POST", `/api/blocks/${a.id}/subblocks`, { type: "markdown" })).body!;
    const s2 = (await call("POST", `/api/blocks/${a.id}/subblocks`, { type: "equation" })).body!;
    const r = await call("PATCH", `/api/blocks/${a.id}/subblocks/reorder`, { order: [s2.id, s1.id] });
    expect(r.status).toBe(200);
    expect(await ls(join(root, "blocks/001-a/subblocks"))).toEqual(["01-equation.tex", "02-markdown.md"]);
    const p = await call("PATCH", "/api/blocks/reorder", {
      blocks: [
        { id: b.id, parentId: null },
        { id: a.id, parentId: null },
      ],
    });
    expect(p.status).toBe(200);
    expect(await ls(join(root, "blocks"))).toEqual(["001-b", "002-a"]);
  });
});
