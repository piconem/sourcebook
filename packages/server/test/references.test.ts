import { strFromU8, unzipSync } from "fflate";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempProject, buildProjectApp } from "./helpers.js";

function multipart(files: { name: string; data: string | Buffer }[]) {
  const boundary = "----refs";
  const parts = files.map(({ name, data }) =>
    Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from(data),
      Buffer.from("\r\n"),
    ]),
  );
  return {
    payload: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

async function setup() {
  const { app, root } = await buildProjectApp();
  const inject = (method: string, url: string, payload?: object) =>
    app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown> });
  const upload = (dir: string, files: { name: string; data: string | Buffer }[]) =>
    app.inject({ method: "POST", url: `/api/references/upload?dir=${encodeURIComponent(dir)}`, ...multipart(files) });
  return { root, app, inject, upload };
}

describe("references", () => {
  it("uploads into folders, de-duplicates names and lists a sorted tree", async () => {
    const { root, inject, upload } = await setup();
    expect((await inject("POST", "/api/references/folders", { path: "papers/2026" })).statusCode).toBe(201);
    const r = await upload("papers", [
      { name: "spec.pdf", data: "%PDF-1.4" },
      { name: "spec.pdf", data: "%PDF-1.4 v2" },
      { name: "notes 2.md", data: "# Notes" },
    ]);
    expect(r.statusCode).toBe(201);
    expect(r.json().paths).toEqual(["papers/spec.pdf", "papers/spec (1).pdf", "papers/notes 2.md"]);
    await writeFile(join(root, "references", "manual.txt"), "copied by hand");
    await writeFile(join(root, "references", ".hidden"), "x");

    const tree = (await inject("GET", "/api/references")).json();
    const names = (n: { name: string; children?: unknown[] }): unknown =>
      n.children ? { [n.name]: n.children.map((c) => names(c as never)) } : n.name;
    expect(names(tree)).toEqual({
      references: [{ papers: [{ "2026": [] }, "notes 2.md", "spec (1).pdf", "spec.pdf"] }, "manual.txt"],
    });
  });

  it("serves files inline with safe types and headers", async () => {
    const { inject, upload } = await setup();
    await upload("", [
      { name: "doc.pdf", data: "%PDF" },
      { name: "page.html", data: "<script>alert(1)</script>" },
      { name: "data.bin", data: Buffer.from([0, 1, 2]) },
      { name: "a b.csv", data: "x,y\n1,2" },
    ]);
    const pdf = await inject("GET", "/api/references/file/doc.pdf");
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["content-disposition"]).toMatch(/^inline/);
    expect(pdf.headers["x-content-type-options"]).toBe("nosniff");

    const html = await inject("GET", "/api/references/file/page.html");
    expect(html.headers["content-security-policy"]).toMatch(/^sandbox; default-src 'none'/);

    const bin = await inject("GET", "/api/references/file/data.bin?download=1");
    expect(bin.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(bin.headers["content-disposition"]).toMatch(/^attachment; filename\*=UTF-8''data\.bin/);

    const csv = await inject("GET", "/api/references/file/a%20b.csv");
    expect(csv.body).toBe("x,y\n1,2");
    expect((await inject("GET", "/api/references/file/missing.txt")).statusCode).toBe(404);
  });

  it("rejects traversal and invalid names", async () => {
    const { root, inject, upload } = await setup();
    await mkdir(join(root, "secret"), { recursive: true });
    await writeFile(join(root, "notebook-secret.txt"), "no");
    expect((await inject("GET", "/api/references/file/..%2Fnotebook-secret.txt")).statusCode).toBe(400);
    expect((await inject("GET", "/api/references/file/..%2F..%2Fetc%2Fpasswd")).statusCode).toBe(400);
    expect((await inject("POST", "/api/references/folders", { path: "../secret/x" })).statusCode).toBe(400);
    expect((await upload("../secret", [{ name: "x.txt", data: "x" }])).statusCode).toBe(400);
    expect((await upload("", [{ name: "../escape.txt", data: "x" }])).json().paths).toEqual(["escape.txt"]);
    expect(existsSync(join(root, "escape.txt"))).toBe(false);
    expect((await inject("PATCH", "/api/references/rename", { path: "escape.txt", newName: "sub/x.txt" })).statusCode).toBe(400);
    expect((await inject("DELETE", "/api/references?path=..")).statusCode).toBe(400);
  });

  it("renames without overwriting and deletes folders recursively", async () => {
    const { root, inject, upload } = await setup();
    await upload("docs", [{ name: "a.txt", data: "a" }, { name: "b.txt", data: "b" }]);
    expect((await inject("PATCH", "/api/references/rename", { path: "docs/a.txt", newName: "b.txt" })).statusCode).toBe(409);
    const r = await inject("PATCH", "/api/references/rename", { path: "docs/a.txt", newName: "A.txt" });
    expect(r.json()).toEqual({ path: "docs/A.txt" });
    expect((await inject("PATCH", "/api/references/rename", { path: "docs", newName: "manuals" })).json()).toEqual({ path: "manuals" });
    expect((await inject("DELETE", "/api/references?path=manuals")).statusCode).toBe(204);
    expect(existsSync(join(root, "references", "manuals"))).toBe(false);
  });

  it("markdown links to references (and assets) are rebased and exported", async () => {
    const { inject, upload } = await setup();
    await upload("papers", [{ name: "spec v1.pdf", data: "%PDF" }]);
    const b = (await inject("POST", "/api/blocks", { title: "Intro" })).json();
    await inject("POST", `/api/blocks/${b.id}/subblocks`, {
      type: "markdown",
      content: { markdown: "See [the spec](../../../references/papers/spec%20v1.pdf#page=2) and [missing](../../../references/nope.pdf)." },
    });
    const md = (await inject("GET", "/api/project/markdown")).body;
    expect(md).toContain("[the spec](references/papers/spec%20v1.pdf#page=2)");

    const zip = unzipSync(new Uint8Array((await inject("GET", "/api/project/export.zip")).rawPayload));
    const keys = Object.keys(zip);
    expect(keys).toHaveLength(2);
    expect(keys.filter((k) => k.endsWith(".md") && !k.includes("/"))).toHaveLength(1);
    expect(keys).toContain("references/papers/spec v1.pdf");
    expect(strFromU8(zip["references/papers/spec v1.pdf"])).toBe("%PDF");
  });
});

describe("references: multiple selection", () => {
  it("zips files and folders relative to the browsed folder", async () => {
    const { root, inject, upload } = await setup();
    await upload("papers", [{ name: "a.pdf", data: "%PDF-a" }, { name: "notes.txt", data: "notes ".repeat(200) }]);
    await upload("papers/2026", [{ name: "b.csv", data: "x,y" }]);
    await inject("POST", "/api/references/folders", { path: "papers/empty" });
    await upload("", [{ name: "top.md", data: "# top" }]);

    const res = await inject("POST", "/api/references/zip", { paths: ["papers/a.pdf", "papers/2026", "papers/empty", "top.md", "papers/a.pdf"], base: "papers" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''papers.zip");
    const zip = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(zip).sort()).toEqual(["2026/b.csv", "a.pdf", "empty/", "top.md"]);
    expect(strFromU8(zip["a.pdf"])).toBe("%PDF-a");
    expect(strFromU8(zip["2026/b.csv"])).toBe("x,y");

    const folder = await inject("POST", "/api/references/zip", { paths: ["papers"] });
    expect(folder.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''papers.zip");
    expect(Object.keys(unzipSync(new Uint8Array(folder.rawPayload))).sort()).toEqual([
      "papers/2026/b.csv", "papers/a.pdf", "papers/empty/", "papers/notes.txt",
    ]);
    expect(strFromU8(unzipSync(new Uint8Array(folder.rawPayload))["papers/notes.txt"])).toBe("notes ".repeat(200));

    expect((await inject("POST", "/api/references/zip", { paths: ["missing.pdf"] })).statusCode).toBe(404);
    expect((await inject("POST", "/api/references/zip", { paths: ["../notebook.json"] })).statusCode).toBe(400);
    expect(existsSync(join(root, "references", "papers", "a.pdf"))).toBe(true);
  });

  it("deletes several entries at once, skipping ones inside selected folders", async () => {
    const { root, inject, upload } = await setup();
    await upload("papers", [{ name: "a.pdf", data: "a" }]);
    await upload("", [{ name: "x.txt", data: "x" }, { name: "keep.txt", data: "k" }]);
    const r = await inject("POST", "/api/references/delete", { paths: ["papers/a.pdf", "papers", "x.txt"] });
    expect(r.json()).toEqual({ deleted: ["papers", "x.txt"] });
    expect(existsSync(join(root, "references", "papers"))).toBe(false);
    expect(existsSync(join(root, "references", "keep.txt"))).toBe(true);
    expect((await inject("POST", "/api/references/delete", { paths: ["gone.txt"] })).statusCode).toBe(404);
    expect((await inject("POST", "/api/references/delete", { paths: [""] })).statusCode).toBe(400);
  });
});
