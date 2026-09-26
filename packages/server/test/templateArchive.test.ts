import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { LIMITS } from "../src/store/templateArchive.js";
import { PNG_B64, tempProject } from "./helpers.js";

async function setup() {
  const workspace = await tempProject();
  const { app } = await buildApp(workspace, { configDir: await tempProject() });
  const call = async (method: string, url: string, payload?: object) => {
    const res = await app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown> });
    return { status: res.statusCode, body: res.headers["content-type"]?.toString().includes("json") ? res.json() : res.rawPayload };
  };
  const importZip = async (zip: Uint8Array, query = "", filename = "design.sourcebook-template.zip") => {
    const boundary = "----tpl";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/zip\r\n\r\n`),
      Buffer.from(zip),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({ method: "POST", url: `/api/templates/import${query}`, payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
    return { status: res.statusCode, body: res.json() };
  };
  const templateDirs = async () => (await readdir(join(workspace, "templates"))).sort();
  return { workspace, call, importZip, templateDirs };
}

/** A small template with a markdown sub-block, an image with its asset, a nested section, a reference and a comment. */
async function makeTemplate(call: Awaited<ReturnType<typeof setup>>["call"]) {
  await call("POST", "/api/templates", { name: "Design Doc", description: "Standard" });
  const a = (await call("POST", "/api/templates/design-doc/blocks", { title: "Overview" })).body;
  await call("POST", "/api/templates/design-doc/blocks", { title: "Scope", parentId: a.id });
  await call("PATCH", `/api/templates/design-doc/blocks/${a.id}`, { objective: "Explain the system" });
  const md = (await call("POST", `/api/templates/design-doc/blocks/${a.id}/subblocks`, { type: "markdown", content: { markdown: "# Purpose\n" } })).body;
  await call("POST", `/api/templates/design-doc/blocks/${a.id}/subblocks/${md.id}/comments`, { text: "internal note" });
  await call("POST", "/api/templates/design-doc/references/folders", { path: "standards" });
  return a;
}

function exportedFiles(zip: Uint8Array) {
  return Object.keys(unzipSync(zip)).sort();
}

describe("template export", () => {
  it("exports a ZIP with a manifest and the template, without comments", async () => {
    const { call } = await setup();
    const a = await makeTemplate(call);
    const res = await call("GET", "/api/templates/design-doc/archive.zip");
    expect(res.status).toBe(200);
    const zip = new Uint8Array(res.body as Buffer);
    const files = exportedFiles(zip);
    expect(files).toContain("sourcebook-template.json");
    expect(files).toContain("notebook.json");
    expect(files).toContain("project.json");
    expect(files).toContain("blocks/001-overview/block.json");
    expect(files.some((f) => f.endsWith(".comments.json"))).toBe(false);
    const manifest = JSON.parse(strFromU8(unzipSync(zip)["sourcebook-template.json"]));
    expect(manifest).toMatchObject({ format: "sourcebook-template", version: 1, template: { name: "Design Doc", description: "Standard" } });
    expect(a.id).toBeTruthy();
    expect((await call("GET", "/api/templates/nope/archive.zip")).status).toBe(404);
  });
});

describe("template import", () => {
  it("round-trips: export, preview, import as a new template", async () => {
    const { call, importZip, templateDirs } = await setup();
    const a = await makeTemplate(call);
    const zip = new Uint8Array((await call("GET", "/api/templates/design-doc/archive.zip")).body as Buffer);

    const preview = await importZip(zip, "?dryRun=1");
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ valid: true, name: "Design Doc", sections: 2, subBlocks: 1 });
    expect(await templateDirs()).toEqual(["design-doc"]); // dry run writes nothing

    const imported = await importZip(zip, "?name=Design%20Doc%20v2");
    expect(imported.status).toBe(201);
    expect(imported.body).toMatchObject({ id: "design-doc-v2", kind: "templates", name: "Design Doc v2", sections: 2 });
    const block = (await call("GET", `/api/templates/design-doc-v2/blocks/${a.id}`)).body;
    expect(block).toMatchObject({ title: "Overview", objective: "Explain the system" });
    expect(block.subBlocks[0]).toMatchObject({ content: { markdown: "# Purpose\n" }, commentCount: 0 });
    expect((await call("GET", "/api/templates")).body).toHaveLength(2);
  });

  it("accepts an archive wrapped in one folder, ignoring system files", async () => {
    const { call, importZip } = await setup();
    await makeTemplate(call);
    const files = unzipSync(new Uint8Array((await call("GET", "/api/templates/design-doc/archive.zip")).body as Buffer));
    const wrapped: Zippable = {};
    for (const [n, b] of Object.entries(files)) wrapped[`My Template/${n}`] = b;
    wrapped["__MACOSX/My Template/._notebook.json"] = strToU8("x");
    wrapped["My Template/.DS_Store"] = strToU8("x");
    wrapped["My Template/notes.txt"] = strToU8("hello");
    const res = await importZip(zipSync(wrapped), "?dryRun=1");
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual(['Ignored unexpected file "notes.txt".']);
  });

  it("imports an archive without manifest (warning) and names it after the file", async () => {
    const { call, importZip } = await setup();
    await makeTemplate(call);
    const files = unzipSync(new Uint8Array((await call("GET", "/api/templates/design-doc/archive.zip")).body as Buffer));
    delete files["sourcebook-template.json"];
    delete files["project.json"];
    const res = await importZip(zipSync(files), "", "team_standard-doc.zip");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "team standard doc", id: "team-standard-doc" });
    expect(res.body.warnings[0]).toMatch(/No sourcebook-template.json/);
  });
});

describe("template import validation", () => {
  const invalid = async (make: (files: Record<string, Uint8Array>) => Uint8Array | void, expected: RegExp) => {
    const { call, importZip, templateDirs } = await setup();
    await makeTemplate(call);
    const files = unzipSync(new Uint8Array((await call("GET", "/api/templates/design-doc/archive.zip")).body as Buffer));
    const zip = make(files) ?? zipSync(files);
    const res = await importZip(zip);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid template archive");
    expect(res.body.details.errors.join("\n")).toMatch(expected);
    expect(await templateDirs()).toEqual(["design-doc"]); // nothing imported
  };
  const blockJson = (files: Record<string, Uint8Array>) => JSON.parse(strFromU8(files["blocks/001-overview/block.json"]));
  const setJson = (files: Record<string, Uint8Array>, name: string, v: unknown) => (files[name] = strToU8(JSON.stringify(v)));

  it("rejects files that are not ZIPs", () => invalid(() => strToU8("just text"), /not a ZIP archive/));
  it("rejects corrupted ZIPs", () => invalid((f) => zipSync(f).slice(0, 200), /corrupted/));
  it("requires notebook.json", () => invalid((f) => void delete f["notebook.json"], /notebook\.json not found/));
  it("rejects invalid notebook.json", () => invalid((f) => void (f["notebook.json"] = strToU8("{ nope")), /notebook\.json is not valid JSON/));
  it("rejects unsafe paths", () => invalid((f) => void (f["../../evil.sh"] = strToU8("rm -rf /")), /Unsafe path "\.\.\/\.\.\/evil\.sh"/));
  it("rejects a missing block.json", () => invalid((f) => void delete f["blocks/002-scope/block.json"], /Scope.*block\.json is missing/));
  it("rejects id mismatches", () => invalid((f) => void setJson(f, "blocks/001-overview/block.json", { ...blockJson(f), id: "other" }), /does not match notebook\.json/));
  it("rejects cycles", () =>
    invalid((f) => {
      const nb = JSON.parse(strFromU8(f["notebook.json"]));
      nb.blocks[0].parentId = nb.blocks[1].id;
      setJson(f, "notebook.json", nb);
    }, /nested inside itself/));
  it("rejects missing sub-block files", () => invalid((f) => void delete f["blocks/001-overview/subblocks/01-markdown.md"], /subblocks\/01-markdown\.md is missing/));
  it("rejects unknown sub-block types", () =>
    invalid((f) => {
      const b = blockJson(f);
      b.subBlocks[0].type = "spreadsheet";
      setJson(f, "blocks/001-overview/block.json", b);
    }, /unknown sub-block type "spreadsheet"/));
  it("rejects invalid content", () => invalid((f) => void (f["blocks/001-overview/subblocks/01-markdown.md"] = strToU8("<script>alert(1)</script>")), /Inline <script> is not allowed/));
  it("rejects missing referenced images", () =>
    invalid((f) => {
      const b = blockJson(f);
      b.subBlocks.push({ id: "img1", type: "image", order: 2, source: "02-image.md", exports: [], props: {} });
      setJson(f, "blocks/001-overview/block.json", b);
      f["blocks/001-overview/subblocks/02-image.md"] = strToU8("![x](../assets/missing.png)\n");
    }, /referenced file assets\/missing\.png is missing/));
  it("reports every error at once", async () => {
    const { call, importZip } = await setup();
    await makeTemplate(call);
    const f = unzipSync(new Uint8Array((await call("GET", "/api/templates/design-doc/archive.zip")).body as Buffer));
    delete f["blocks/002-scope/block.json"];
    delete f["blocks/001-overview/subblocks/01-markdown.md"];
    const res = await importZip(zipSync(f));
    expect(res.body.details.errors).toHaveLength(2);
  });
  it("enforces size limits", async () => {
    const saved = { ...LIMITS };
    LIMITS.entries = 3;
    try {
      await invalid(() => undefined, /too large once extracted/);
    } finally {
      Object.assign(LIMITS, saved);
    }
  });
  it("accepts images whose asset is present", async () => {
    const { call, importZip } = await setup();
    await makeTemplate(call);
    const f = unzipSync(new Uint8Array((await call("GET", "/api/templates/design-doc/archive.zip")).body as Buffer));
    const b = JSON.parse(strFromU8(f["blocks/001-overview/block.json"]));
    b.subBlocks.push({ id: "img1", type: "image", order: 2, source: "02-image.md", exports: [], props: {} });
    f["blocks/001-overview/block.json"] = strToU8(JSON.stringify(b));
    f["blocks/001-overview/subblocks/02-image.md"] = strToU8("![x](../assets/logo.png)\n");
    f["blocks/001-overview/assets/logo.png"] = Buffer.from(PNG_B64, "base64");
    expect((await importZip(zipSync(f), "?dryRun=1")).status).toBe(200);
  });
});
