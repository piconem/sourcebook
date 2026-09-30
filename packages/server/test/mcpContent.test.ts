import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { selectParts, splitParts, type ReferenceNode } from "@sourcebook/shared";
import { describe, expect, it } from "vitest";
import { assembleMarkdown, convertDocument } from "../src/convert/index.js";
import { rtfToText } from "../src/convert/other.js";
import { classify, isGarbled } from "../src/convert/pdf.js";
import * as f from "./docFixtures.js";
import { buildProjectApp } from "./helpers.js";

const md = async (name: string, data: Uint8Array) => {
  const conv = await convertDocument(data, name);
  return { conv, text: assembleMarkdown(name, name.split(".").pop()!, conv) };
};

describe("document conversion to Markdown", () => {
  it("PDF: text, headings, lists and hyphenation; each page analysed", async () => {
    const { conv, text } = await md("paper.pdf", await f.samplePdf());
    expect(conv.parts.map((p) => [p.kind, p.needsImage])).toEqual([
      ["text", false],
      ["text+figures", false],
      ["scan", true],
      ["vector", true],
      ["scan", false], // scanner OCR layer: its text is used
      ["blank", false],
    ]);
    expect(conv.parts[4].invisibleText).toBe(true);
    expect(conv.parts[2].imageCoverage).toBe(1);
    const page1 = selectParts(text, [1]);
    expect(page1).toContain("<!-- sourcebook:page 1 -->\n## Page 1\n\n### Introduction\n\n");
    expect(page1).toContain("combines a programming language with a documentation language"); // "program-" + "ming" joined
    expect(page1).toContain("- First point of the list\n- Second point of the list");
    expect(selectParts(text, [3])).toContain('read it with read_reference_pages (pages "3")');
    expect(selectParts(text, [5])).toContain("_Text from the OCR layer of a scanned page");
    expect(splitParts(text).map((p) => p.n)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("PDF: cuts figures out of text pages (images and vector charts) with their captions", async () => {
    const { conv, text } = await md("paper.pdf", await f.samplePdf());
    const figs = conv.parts[1].figures!;
    expect(figs.map((x) => [x.id, x.kind, x.caption])).toEqual([
      ["p2-1", "image", "Figure 1: A scanned sample used as a picture."],
      ["p2-2", "drawing", "Fig. 2. Latency by service, measured in September."],
    ]);
    // Regions in PDF points: the image drawn at (100, 330) 300×400, the bars from y=90.
    expect(figs[0].bbox).toEqual([100, 330, 400, 730]);
    expect(figs[1].bbox[1]).toBeCloseTo(90, 0);
    expect(figs[1].bbox[3]).toBeCloseTo(240, 0);
    expect(Object.keys(conv.files ?? {})).toEqual(["figures/p002-1.webp", "figures/p002-2.webp"]);
    expect(Buffer.from(conv.files!["figures/p002-1.webp"]).subarray(8, 12).toString()).toBe("WEBP");
    expect(conv.parts.flatMap((p) => p.figures ?? []).length).toBe(2); // no figures on text-only or image-only pages
    expect(selectParts(text, [2])).toContain("**Figures on this page** (look at them with read_reference_figures):\n\n- `p2-1` — Figure 1: A scanned sample used as a picture.\n- `p2-2` — Fig. 2. Latency by service, measured in September.");
  });

  it("classifies pages from text, image coverage and drawings, and detects broken text layers", () => {
    const base = { chars: 0, imageCoverage: 0, paths: 0, invisibleText: false, garbled: false };
    expect(classify({ ...base, chars: 500 })).toBe("text");
    expect(classify({ ...base, chars: 500, imageCoverage: 0.3 })).toBe("text+figures");
    expect(classify({ ...base, chars: 3, imageCoverage: 0.97 })).toBe("scan");
    expect(classify({ ...base, imageCoverage: 0.4 })).toBe("figures");
    expect(classify({ ...base, paths: 40 })).toBe("vector");
    expect(classify({ ...base, chars: 900, imageCoverage: 1, garbled: true })).toBe("scan");
    expect(classify(base)).toBe("blank");
    expect(isGarbled("The quick brown fox jumps over the lazy dog")).toBe(false);
    expect(isGarbled("\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001\uE001")).toBe(true);
  });

  it("Word, PowerPoint (presentation order, tables, notes, pictures) and Excel", async () => {
    expect((await md("a.docx", f.sampleDocx())).text).toContain("### Design notes\n\nThe service exposes a REST API.\n\n| Name | Value |\n| --- | --- |\n| timeout | 30 s |");
    const pptx = (await md("deck.pptx", f.samplePptx())).text;
    expect(pptx).toContain("## Slide 1: Architecture\n\n- Gateway\n- Workers\n\n| Metric | p99 |\n| --- | --- |\n| Latency | 120 ms |\n\n**Speaker notes:**\n\nMention the retry policy.");
    expect(pptx).toContain("## Slide 2: Questions?\n\n[image: Team photo]");
    const xlsx = (await md("m.xlsx", await f.sampleXlsx())).text;
    expect(xlsx).toContain("## Sheet 1: Latency\n\n| Service | p50 | p99 | Measured |\n| --- | --- | --- | --- |\n| gateway | 12 | 120 | 2026-09-01 |\n| auth \\| sso | 8 | 80 | 2026-09-02 |");
    expect(xlsx).toContain("## Sheet 2: Empty\n\n_Empty sheet._");
  });

  it("OpenDocument text, presentation and spreadsheet (repeated empty cells trimmed)", async () => {
    expect((await md("a.odt", f.sampleOdt())).text).toContain("### Requirements\n\nMust  be [fast](https://example.org).\n\n- Low latency\n  - p99 under 200 ms\n\n| Key | Value |");
    expect((await md("a.odp", f.sampleOdp())).text).toContain("## Slide 1: Roadmap\n\n- Q1: beta\n\n**Speaker notes:**\n\nKeep it short.");
    expect((await md("a.ods", f.sampleOds())).text).toContain("## Sheet 1: Budget\n\n| Item | Cost |\n| --- | --- |\n| Servers | 1200 |\n");
  });

  it("RTF, HTML, EPUB (spine order), Jupyter, email and ZIP", async () => {
    expect(rtfToText(new TextDecoder("latin1").decode(f.sampleRtf()))).toBe("Caffè bold text.\nSecond € line\tend.\n");
    const html = (await md("g.html", f.sampleHtml())).text;
    expect(html).toContain("## Guide\n\n### Setup\n\nRun `pnpm dev`.\n\n- one\n\n[image: diagram]");
    const epub = (await md("b.epub", f.sampleEpub())).text;
    expect(epub.indexOf("Chapter 1: Prologue")).toBeLessThan(epub.indexOf("Chapter 2: Chapter One"));
    const nb = (await md("n.ipynb", f.sampleIpynb())).text;
    expect(nb).toContain("```python\nprint(1 + 1)\n```\n\nOutput:\n\n```\n2\n```");
    expect(nb).toContain("_[image output]_");
    const eml = (await md("m.eml", f.sampleEml())).text;
    expect(eml).toContain("## Meeting notes\n\n**From:**");
    expect(eml).toContain("We agreed on the API.\n\n**Attachments:**\n\n- data.csv (text/csv, 3 B)");
    const zip = (await md("z.zip", f.sampleZip())).text;
    expect(zip).toContain("## File 1: notes/readme.md");
    expect(zip).toContain("## File 2: spec.docx\n\n#### Design notes");
    expect(zip).toContain("- logo.bin (3 bytes)");
    expect(zip).not.toContain("__MACOSX");
  });
});

describe("reference content for the assistant (API)", () => {
  async function setup() {
    const { app, root } = await buildProjectApp();
    const refs = join(root, "references");
    await mkdir(join(refs, "docs"), { recursive: true });
    await writeFile(join(refs, "paper.pdf"), await f.samplePdf());
    await writeFile(join(refs, "notes.md"), "# Notes");
    await writeFile(join(refs, "photo.png"), Buffer.from("iVBORw0KGgo=", "base64"));
    await writeFile(join(refs, "blob.bin"), "x");
    await writeFile(join(refs, "docs", "spec.docx"), f.sampleDocx());
    await writeFile(join(refs, "docs", "broken.docx"), "not a zip");
    const call = async (method: string, url: string, payload?: object) => {
      const res = await app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown> });
      return { status: res.statusCode, body: String(res.headers["content-type"]).includes("json") ? res.json() : res.body, res };
    };
    return { app, root, refs, call };
  }
  const files = (n: ReferenceNode): ReferenceNode[] => (n.kind === "file" ? [n] : (n.children ?? []).flatMap(files));

  it("reports the MCP status of each file and converts documents with page images", async () => {
    const { call, refs } = await setup();
    const tree = (await call("GET", "/api/references")).body as ReferenceNode;
    const status = Object.fromEntries(files(tree).map((n) => [n.path, n.mcp?.status]));
    expect(status["notes.md"]).toBe("native");
    expect(status["photo.png"]).toBe("native");
    expect(status["blob.bin"]).toBe("unsupported");
    expect(["pending", "converting", "ready"]).toContain(status["paper.pdf"]);

    const r = (await call("POST", "/api/references/mcp/convert", { paths: ["paper.pdf"] })).body;
    expect(r.results).toEqual([{ path: "paper.pdf", status: "ready", kind: "markdown", unit: "page", parts: 6, pageImages: 2, figures: 2, imageOnlyParts: 2 }]);
    expect(existsSync(join(refs, ".mcp", "paper.pdf", "content.md"))).toBe(true);
    const content = (await call("GET", "/api/references/mcp?path=paper.pdf")).body;
    expect(content.manifest.parts.map((p: { kind: string }) => p.kind)).toEqual(["text", "text+figures", "scan", "vector", "scan", "blank"]);
    expect(content.manifest.parts[2].image).toBe("pages/p003.webp");
    expect(content.manifest.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(content.markdown).toContain("## Page 1");

    // The hidden folder is not listed as a reference.
    expect(files((await call("GET", "/api/references")).body).map((n) => n.path)).not.toContain(".mcp/paper.pdf/content.md");

    expect(content.manifest.parts[1].figures.map((x: { id: string; image: string }) => [x.id, x.image])).toEqual([["p2-1", "figures/p002-1.webp"], ["p2-2", "figures/p002-2.webp"]]);
    const fig = await call("GET", "/api/references/mcp/figure?path=paper.pdf&id=p2-2");
    expect(fig.status).toBe(200);
    expect(fig.res.headers["content-type"]).toBe("image/webp");
    expect((await call("GET", "/api/references/mcp/figure?path=paper.pdf&id=p9-9")).status).toBe(404);
    const img = await call("GET", "/api/references/mcp/page?path=paper.pdf&n=3");
    expect(img.status).toBe(200);
    expect(img.res.headers["content-type"]).toBe("image/webp");
    expect((await call("GET", "/api/references/mcp/page?path=paper.pdf&n=1")).status).toBe(404);
    const rendered = (await call("POST", "/api/references/mcp/pages", { path: "paper.pdf", pages: [1] })).body;
    expect(rendered.manifest.parts[0].image).toBe("pages/p001.webp");
  });

  it("saves transcriptions, follows renames, detects changes and deletions, and records failures", async () => {
    const { call, refs } = await setup();
    await call("POST", "/api/references/mcp/convert", { paths: ["paper.pdf", "docs"] });
    const t = (await call("PUT", "/api/references/mcp/transcription", { path: "paper.pdf", page: 3, markdown: "Scanned text line" })).body;
    expect(t.manifest.parts[2].transcribed.by).toBe("the assistant");
    const after = (await call("GET", "/api/references/mcp?path=paper.pdf")).body;
    expect(splitParts(after.markdown).find((p) => p.n === 3)?.text).toBe("<!-- sourcebook:page 3 -->\n## Page 3\n\n_Transcribed by the assistant from the page image._\n\nScanned text line\n\n");
    expect(after.info.imageOnlyParts).toBe(1);

    // Folder conversion: the docx converted, the broken one recorded as failed.
    const docs = files((await call("GET", "/api/references")).body).filter((n) => n.path.startsWith("docs/"));
    expect(docs.map((n) => [n.path, n.mcp?.status])).toEqual([["docs/broken.docx", "failed"], ["docs/spec.docx", "ready"]]);
    expect(docs[0].mcp?.error).toBeTruthy();

    await call("PATCH", "/api/references/rename", { path: "docs", newName: "specs" });
    expect((await call("GET", "/api/references/mcp?path=specs/spec.docx")).body.manifest.source.path).toBe("specs/spec.docx");
    expect((await call("GET", "/api/references/mcp?path=docs/spec.docx")).status).toBe(404);

    // Changed file: stale (then reconverted automatically).
    await writeFile(join(refs, "specs", "spec.docx"), f.sampleDocx().slice());
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(join(refs, "notes.md"), "changed");
    const { utimes } = await import("node:fs/promises");
    await utimes(join(refs, "specs", "spec.docx"), new Date(), new Date(Date.now() + 5000));
    const st = files((await call("GET", "/api/references")).body).find((n) => n.path === "specs/spec.docx")!.mcp!.status;
    expect(["stale", "pending", "converting"]).toContain(st);

    // Content made by an older conversion logic is converted again (seen by a server started afresh).
    const { readFile: rf, writeFile: wf } = await import("node:fs/promises");
    const mPath = join(refs, ".mcp", "paper.pdf", "manifest.json");
    const old = JSON.parse(await rf(mPath, "utf8"));
    expect(old.revision).toBe(2);
    delete old.revision;
    await wf(mPath, JSON.stringify(old));
    const restarted = await buildProjectApp({ workspace: join(refs, "..", "..", "..") });
    const tree2 = (await restarted.app.inject({ method: "GET", url: "/api/references" })).json() as ReferenceNode;
    expect(["stale", "pending", "converting"]).toContain(files(tree2).find((n) => n.path === "paper.pdf")!.mcp!.status);

    await call("DELETE", "/api/references?path=paper.pdf");
    expect(existsSync(join(refs, ".mcp", "paper.pdf"))).toBe(false);
  });
});

describe("images from references into image sub-blocks", () => {
  it("lists image files and document figures, copies them into block assets and attaches the source", async () => {
    const { app, root } = await buildProjectApp();
    const refs = join(root, "references");
    await mkdir(join(refs, "papers"), { recursive: true });
    await writeFile(join(refs, "papers", "paper.pdf"), await f.samplePdf());
    await writeFile(join(refs, "diagram.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP4z8DwnwEIGP4zMAAAPPIC/nPNnAoAAAAASUVORK5CYII=", "base64"));
    await writeFile(join(refs, "notes.md"), "# x");
    const call = async (method: string, url: string, payload?: object) => {
      const res = await app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown> });
      return { status: res.statusCode, body: String(res.headers["content-type"]).includes("json") ? res.json() : res.body };
    };
    await call("POST", "/api/references/mcp/convert", { paths: ["papers/paper.pdf"] });
    const list = (await call("GET", "/api/references/images")).body;
    expect(list.images).toEqual([{ path: "diagram.png", name: "diagram.png", size: expect.any(Number) }]);
    expect(list.documents.map((d: { path: string; figures: { id: string }[] }) => [d.path, d.figures.map((x) => x.id)])).toEqual([["papers/paper.pdf", ["p2-1", "p2-2"]]]);

    const b = (await call("POST", "/api/blocks", { title: "Results" })).body;
    const img = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "image" })).body;

    // Into an existing image sub-block: the figure is copied, its caption suggested, the paper attached.
    const copied = await call("POST", `/api/blocks/${b.id}/assets/from-reference`, { path: "papers/paper.pdf", figure: "p2-2", attachTo: img.id });
    expect(copied.status).toBe(201);
    expect(copied.body).toMatchObject({ path: expect.stringMatching(/^assets\/[\w-]+\.webp$/), alt: "paper, page 2", caption: "Fig. 2. Latency by service, measured in September." });
    expect(existsSync(join(root, "blocks", "001-results", copied.body.path))).toBe(true);
    expect((await call("GET", `/api/blocks/${b.id}`)).body.subBlocks[0].references).toEqual(["papers/paper.pdf"]);

    // A new image sub-block from an image file.
    const created = (await call("POST", `/api/blocks/${b.id}/images/from-reference`, { path: "diagram.png", caption: "Our architecture" })).body;
    expect(created).toMatchObject({ type: "image", content: { alt: "diagram", caption: "Our architecture", src: expect.stringMatching(/^assets\/[\w-]+\.png$/) }, references: ["diagram.png"] });
    const block = (await call("GET", `/api/blocks/${b.id}`)).body;
    expect(block.subBlocks.map((s: { type: string; references?: string[] }) => [s.type, s.references])).toEqual([["image", ["papers/paper.pdf"]], ["image", ["diagram.png"]]]);

    // The copy does not depend on the reference any more.
    await call("DELETE", "/api/references?path=diagram.png");
    const after = (await call("GET", `/api/blocks/${b.id}`)).body.subBlocks[1];
    expect(existsSync(join(root, "blocks", "001-results", after.content.src))).toBe(true);
    expect(after.references).toBeUndefined();

    // Errors: not an image, unknown figure.
    expect((await call("POST", `/api/blocks/${b.id}/images/from-reference`, { path: "notes.md" })).status).toBe(400);
    expect((await call("POST", `/api/blocks/${b.id}/images/from-reference`, { path: "papers/paper.pdf", figure: "p9-9" })).status).toBe(404);
  });
});
