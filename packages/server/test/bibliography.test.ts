import { strFromU8, unzipSync, zipSync, strToU8 } from "fflate";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProjectApp } from "./helpers.js";

const BIB = `@article{knuth84,
  author = {Donald E. Knuth},
  title = {Literate Programming},
  journal = {The Computer Journal},
  year = {1984},
  doi = {10.1093/comjnl/27.2.97}
}
@misc{tsx, title = {tsx: TypeScript Execute}, howpublished = {GitHub}, url = {https://github.com/privatenumber/tsx}, year = {2024}}`;

async function setup() {
  const { app, root, workspace } = await buildProjectApp();
  const call = async (method: string, url: string, payload?: object) => {
    const res = await app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown> });
    const type = String(res.headers["content-type"] ?? "");
    return { status: res.statusCode, body: type.includes("json") ? res.json() : res.body, raw: res };
  };
  return { app, root, workspace, call };
}

describe("bibliography entries", () => {
  it("creates entries with generated key, BibTeX and text citation, and validates input", async () => {
    const { root, call } = await setup();
    const e = (await call("POST", "/api/bibliography", { type: "article", name: "Knuth 1984", authors: "Donald E. Knuth", year: "1984", title: "Literate Programming", venue: "The Computer Journal", generate: true })).body;
    expect(e).toMatchObject({ key: "knuth1984literate", name: "Knuth 1984", textCitation: "Knuth, D. E. (1984). Literate Programming. The Computer Journal." });
    expect(e.bibtex).toMatch(/^@article\{knuth1984literate,\n  author  = \{Donald E\. Knuth\}/);
    const onDisk = JSON.parse(await readFile(join(root, "bibliography.json"), "utf8"));
    expect(onDisk.entries.map((x: { key: string }) => x.key)).toEqual(["knuth1984literate"]);

    // Same suggested key → a distinct one; explicit duplicate key → 409; invalid → 400
    expect((await call("POST", "/api/bibliography", { type: "article", name: "Knuth again", authors: "Donald E. Knuth", year: "1984", title: "Literate Programming" })).body.key).toBe("knuth1984literate-a");
    expect((await call("POST", "/api/bibliography", { type: "misc", name: "x", key: "knuth1984literate" })).status).toBe(409);
    expect((await call("POST", "/api/bibliography", { type: "misc", name: "x", key: "9bad" })).status).toBe(400);
    expect((await call("POST", "/api/bibliography", { type: "poster", name: "x" })).status).toBe(400);
    expect((await call("POST", "/api/bibliography", { type: "misc", name: " " })).status).toBe(400);

    // Pasted BibTeX gives the key when none is set
    expect((await call("POST", "/api/bibliography", { type: "misc", name: "Pasted", bibtex: "@misc{pasted2025, title={P}}" })).body.key).toBe("pasted2025");

    // Search and filter, sorted by name
    expect((await call("GET", "/api/bibliography?q=literate")).body.map((x: { name: string }) => x.name)).toEqual(["Knuth 1984", "Knuth again"]);
    expect((await call("GET", "/api/bibliography?type=misc")).body).toHaveLength(1);
  });

  it("generates BibTeX and citation without saving", async () => {
    const { call } = await setup();
    const r = (await call("POST", "/api/bibliography/generate", { type: "online", name: "MDN Fetch", title: "Fetch API", url: "https://developer.mozilla.org/docs/Web/API/Fetch_API", venue: "MDN" })).body;
    expect(r.bibtex).toMatch(/^@online\{mdnfetch,[\s\S]*organization = \{MDN\}[\s\S]*urldate/);
    expect(r.textCitation).toBe("Fetch API. MDN. https://developer.mozilla.org/docs/Web/API/Fetch_API");
    expect((await call("GET", "/api/bibliography")).body).toEqual([]);
  });

  it("imports BibTeX (skipping or replacing duplicates) and exports a .bib file", async () => {
    const { call } = await setup();
    const r1 = (await call("POST", "/api/bibliography/import", { bibtex: BIB })).body;
    expect(r1).toEqual({ created: ["knuth84", "tsx"], replaced: [], skipped: [], errors: [] });
    expect((await call("GET", "/api/bibliography/knuth84")).body).toMatchObject({ type: "article", authors: "Donald E. Knuth", venue: "The Computer Journal", doi: "10.1093/comjnl/27.2.97", textCitation: expect.stringMatching(/^Knuth, D\. E\. \(1984\)/) });
    expect((await call("POST", "/api/bibliography/import", { bibtex: BIB })).body).toMatchObject({ created: [], skipped: ["knuth84", "tsx"] });
    expect((await call("POST", "/api/bibliography/import", { bibtex: BIB.replace("Literate Programming", "LP"), onDuplicate: "replace" })).body.replaced).toEqual(["knuth84", "tsx"]);
    expect((await call("POST", "/api/bibliography/import", { bibtex: "not bibtex" })).body.errors).toEqual(["No BibTeX entries found."]);

    const bib = await call("GET", "/api/bibliography.bib");
    expect(bib.raw.headers["content-type"]).toMatch(/x-bibtex/);
    expect(bib.body).toContain("@article{knuth84,");
    expect(bib.body).toContain("title = {LP}");
  });
});

describe("citations and associations", () => {
  async function withContent() {
    const s = await setup();
    await s.call("POST", "/api/bibliography/import", { bibtex: BIB });
    const b = (await s.call("POST", "/api/blocks", { title: "Intro" })).body;
    const md = (await s.call("POST", `/api/blocks/${b.id}/subblocks`, { type: "markdown", content: { markdown: "As shown in [Knuth 1984](bib:knuth84), literate programming works.\n" } })).body;
    return { ...s, b, md };
  }

  it("associates entries with sections and sub-blocks, rejecting unknown keys", async () => {
    const { call, b, md } = await withContent();
    expect((await call("PUT", `/api/blocks/${b.id}/citations`, { keys: ["tsx"] })).body).toEqual({ keys: ["tsx"] });
    expect((await call("PUT", `/api/blocks/${b.id}/subblocks/${md.id}/citations`, { keys: ["knuth84", "knuth84"] })).body).toEqual({ keys: ["knuth84"] });
    expect((await call("PUT", `/api/blocks/${b.id}/citations`, { keys: ["nope"] })).status).toBe(400);
    const block = (await call("GET", `/api/blocks/${b.id}`)).body;
    expect(block.citations).toEqual(["tsx"]);
    expect(block.subBlocks[0].citations).toEqual(["knuth84"]);

    expect((await call("GET", "/api/bibliography/knuth84/usages")).body).toEqual([
      { kind: "subblock", blockId: b.id, subBlockId: md.id, ref: "§1#1", title: "markdown 1" },
      { kind: "text", blockId: b.id, subBlockId: md.id, ref: "§1#1", title: "markdown 1" },
    ]);
  });

  it("renames a key everywhere: entry, BibTeX, links in text and associations", async () => {
    const { root, call, b, md } = await withContent();
    await call("PUT", `/api/blocks/${b.id}/citations`, { keys: ["knuth84"] });
    const renamed = (await call("PATCH", "/api/bibliography/knuth84", { key: "knuth1984" })).body;
    expect(renamed.key).toBe("knuth1984");
    expect(renamed.bibtex).toMatch(/^@article\{knuth1984,/);
    const block = (await call("GET", `/api/blocks/${b.id}`)).body;
    expect(block.citations).toEqual(["knuth1984"]);
    expect(block.subBlocks[0].content.markdown).toContain("[Knuth 1984](bib:knuth1984)");
    expect(block.subBlocks[0].rev).toBe(1);
    expect(await readFile(join(root, "blocks/001-intro/subblocks/01-markdown.md"), "utf8")).toContain("(bib:knuth1984)");
    expect((await call("GET", "/api/bibliography/knuth84")).status).toBe(404);
    expect((await call("PATCH", "/api/bibliography/knuth1984", { key: "tsx" })).status).toBe(409);
    void md;
  });

  it("refuses to delete a used entry unless forced, then drops its associations", async () => {
    const { call, b, md } = await withContent();
    await call("PUT", `/api/blocks/${b.id}/subblocks/${md.id}/citations`, { keys: ["knuth84", "tsx"] });
    const refused = await call("DELETE", "/api/bibliography/knuth84");
    expect(refused.status).toBe(409);
    expect(refused.body.details.usages).toHaveLength(2);
    expect((await call("DELETE", "/api/bibliography/knuth84?force=true")).body).toEqual({ removedAssociations: 1 });
    expect((await call("GET", `/api/blocks/${b.id}`)).body.subBlocks[0].citations).toEqual(["tsx"]);
    expect((await call("DELETE", "/api/bibliography/tsx")).status).toBe(409); // still associated
  });

  it("exports a References section and the .bib file", async () => {
    const { app, call, b } = await withContent();
    await call("PUT", `/api/blocks/${b.id}/citations`, { keys: ["tsx"] });
    const md = (await call("GET", "/api/project/markdown")).body as string;
    expect(md).toContain("[Knuth 1984](#ref-tsx)".replace("tsx", "knuth84"));
    expect(md).toMatch(/## References\n\n<a id="ref-tsx"><\/a>\(2024\)\. tsx: TypeScript Execute\. GitHub\. <?https:\/\/github\.com\/privatenumber\/tsx>?\n\n<a id="ref-knuth84"><\/a>Knuth, D\. E\. \(1984\)/);
    const zip = unzipSync(new Uint8Array((await app.inject({ method: "GET", url: "/api/project/export.zip" })).rawPayload));
    expect(strFromU8(zip["bibliography.bib"])).toContain("@article{knuth84,");
    expect((await call("GET", "/api/project/export")).body.generated).toEqual(["bibliography.bib"]);
  });
});

describe("bibliography with templates", () => {
  it("is copied with projects created from templates and travels in template archives", async () => {
    const { call, app } = await setup();
    const t = (await app.inject({ method: "POST", url: "/api/templates", payload: { name: "Paper" } })).json();
    await app.inject({ method: "POST", url: `/api/templates/${t.id}/bibliography/import`, payload: { bibtex: BIB } });
    const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "My paper", from: { kind: "templates", id: t.id } } })).json();
    expect((await app.inject({ method: "GET", url: `/api/projects/${p.id}/bibliography` })).json().map((e: { key: string }) => e.key)).toEqual(["knuth84", "tsx"]);

    const files = unzipSync(new Uint8Array((await app.inject({ method: "GET", url: `/api/templates/${t.id}/archive.zip` })).rawPayload));
    expect(Object.keys(files)).toContain("bibliography.json");
    const upload = async (zip: Uint8Array) => {
      const boundary = "----b";
      const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.zip"\r\n\r\n`), Buffer.from(zip), Buffer.from(`\r\n--${boundary}--\r\n`)]);
      return (await app.inject({ method: "POST", url: "/api/templates/import?dryRun=1", payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } })).json();
    };
    expect((await upload(zipSync(files))).valid).toBe(true);
    files["bibliography.json"] = strToU8("{ bad");
    expect((await upload(zipSync(files))).details.errors).toContain("bibliography.json is not valid JSON.");
    void call;
  });
});

describe("live events", () => {
  it("bibliography changes are announced to open editors", async () => {
    const { buildApp } = await import("../src/app.js");
    const { tempProject } = await import("./helpers.js");
    const { app, workspace } = await buildApp(await tempProject(), { auth: false, configDir: await tempProject() });
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Live" } });
    const { store } = await workspace.open("projects", "live");
    const events: unknown[] = [];
    store.events.on("event", (e) => events.push(e));
    await app.inject({ method: "POST", url: "/api/projects/live/bibliography", payload: { type: "misc", name: "X" }, headers: { "x-sourcebook-client": "mcp" } });
    expect(events).toEqual([{ type: "bibliography", origin: "mcp" }]);
  });
});
