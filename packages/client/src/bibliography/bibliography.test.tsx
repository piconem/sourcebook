// @vitest-environment jsdom
import type { BibEntry, BibUsage, Block } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor } from "@tiptap/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockView } from "../components/BlockView";
import { ReferencesProvider } from "../references/ReferencesContext";
import { markdownExtensions } from "../subblocks/markdown/extensions";
import { BibliographyProvider } from "./BibliographyContext";
import { BibliographyPage } from "./BibliographyPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
document.elementFromPoint ??= () => null;
Element.prototype.scrollIntoView ??= () => {};

const now = "2026-09-01T10:00:00Z";
const entry = (e: Partial<BibEntry> & Pick<BibEntry, "key" | "name">): BibEntry => ({ type: "article", createdAt: now, updatedAt: now, ...e });
let entries: BibEntry[];
let usages: Record<string, BibUsage[]>;
let block: Block;
const calls: { method: string; url: string; body?: any }[] = [];
const MD = [
  "See [Knuth 1984](bib:knuth84) and [Old](bib:gone).",
  "",
  "The API returns JSON.",
  "",
  "Read [spec](../../../references/papers/spec.pdf), [lost](../../../references/nope.pdf) and [the site](https://example.org).",
].join("\n");
const refFile = (path: string) => ({ name: path.split("/").pop()!, path, kind: "file" as const, size: 10, modified: now });

beforeEach(() => {
  calls.length = 0;
  entries = [
    entry({ key: "knuth84", name: "Knuth 1984", authors: "Knuth, Donald E.", year: "1984", title: "Literate Programming", venue: "The Computer Journal", bibtex: "@article{knuth84,\n  title = {Literate Programming}\n}" }),
    entry({ key: "react", name: "React docs", type: "online", title: "React documentation", url: "https://react.dev" }),
  ];
  usages = { knuth84: [{ kind: "section", blockId: "b1", ref: "§1", title: "Intro" }, { kind: "text", blockId: "b1", subBlockId: "md1", ref: "§1#1", title: "Summary" }] };
  block = {
    id: "b1", title: "Intro", parentId: null, order: 1, folder: "001-intro", citations: ["knuth84"], references: ["data.csv"],
    subBlocks: [{ id: "md1", type: "markdown", order: 1, source: "01-markdown.md", exports: [], props: {}, content: { markdown: MD } }],
  };
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    url = url.replace(/^\/api\/(?:projects|templates)\/[^/?]+(?=[/?]|$)/, "/api");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/references")
      return json({ name: "references", path: "", kind: "dir", children: [{ name: "papers", path: "papers", kind: "dir", children: [refFile("papers/spec.pdf")] }, refFile("data.csv")] });
    if (/^\/api\/blocks\/b1(\/subblocks\/md1)?\/references$/.test(url)) return json({ paths: body.paths });
    if (url === "/api/blocks/b1") return json(block);
    if (url === "/api/bibliography" && method === "GET") return json(entries);
    if (url === "/api/bibliography" && method === "POST") {
      const { generate: _g, ...fields } = body;
      const e = entry({ key: fields.key ?? "auto1", ...fields });
      entries.push(e);
      return json(e, 201);
    }
    if (url === "/api/bibliography/import") return json({ created: ["new1"], replaced: [], skipped: ["knuth84"], errors: [] });
    const m = /^\/api\/bibliography\/([^/?]+)(\/usages)?(?:\?force=(\w+))?$/.exec(url);
    if (m && m[2]) return json(usages[m[1]] ?? []);
    if (m && method === "PATCH") {
      const i = entries.findIndex((e) => e.key === m[1]);
      entries[i] = { ...entries[i], ...body, key: body.key ?? m[1] };
      return json(entries[i]);
    }
    if (m && method === "DELETE") {
      entries = entries.filter((e) => e.key !== m[1]);
      return json({ removedAssociations: 1 });
    }
    if (/^\/api\/blocks\/b1(\/subblocks\/md1)?\/citations$/.test(url)) return json({ keys: body.keys });
    if (/^\/api\/blocks\/b1\/subblocks\/md1$/.test(url)) return json({ ...block.subBlocks[0], rev: 1 });
    return json({ error: `unexpected ${method} ${url}` }, 500);
  }));
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});

const tick = (ms = 10) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await tick();
  expect(check()).toBe(true);
};
const $ = (sel: string, scope: ParentNode = document) => scope.querySelector(sel) as HTMLElement;
const $$ = (sel: string, scope: ParentNode = document) => [...scope.querySelectorAll(sel)] as HTMLElement[];
const button = (label: string | RegExp, scope: ParentNode = document) =>
  $$("button", scope).find((b) => (typeof label === "string" ? b.textContent?.trim() === label : label.test(b.textContent ?? ""))) as HTMLButtonElement;
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await tick();
};
const fieldOf = (label: string) => $$(".dialog[open] .field").find((f) => f.querySelector("span")?.textContent?.startsWith(label))!.querySelector("input, textarea, select") as HTMLInputElement;
async function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function render(ui: ReactNode, ready: () => boolean) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const r = (root = createRoot(host));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    r.render(
      <QueryClientProvider client={qc}>
        <ReferencesProvider>
          <BibliographyProvider>{ui}</BibliographyProvider>
        </ReferencesProvider>
      </QueryClientProvider>,
    ),
  );
  await waitFor(ready);
}
const names = () => $$(".bibl-name").map((e) => e.textContent);

describe("Markdown citations", () => {
  it("round-trip [Name](bib:key) links unchanged", () => {
    const md = "See [Knuth 1984](bib:knuth84) and [React docs](bib:react).";
    const editor = new Editor({ extensions: markdownExtensions(), content: md, contentType: "markdown" });
    expect(editor.getMarkdown().trim()).toBe(md);
    let href = "";
    editor.state.doc.descendants((n) => void (n.marks[0]?.type.name === "link" && !href && (href = n.marks[0].attrs.href)));
    expect(href).toBe("bib:knuth84");
    editor.destroy();
  });
});

describe("Bibliography page", () => {
  it("lists, searches, filters and sorts sources", async () => {
    await render(<BibliographyPage />, () => names().length === 2);
    expect(names()).toEqual(["Knuth 1984", "React docs"]);
    await type($(".ref-search") as HTMLInputElement, "literate");
    expect(names()).toEqual(["Knuth 1984"]);
    await type($(".ref-search") as HTMLInputElement, "");
    await type($(".bibl-type-filter") as HTMLSelectElement, "online");
    expect(names()).toEqual(["React docs"]);
    await type($(".bibl-type-filter") as HTMLSelectElement, "");
    await click(button(/^Name/));
    expect(names()).toEqual(["React docs", "Knuth 1984"]);
  });

  it("creates a source from pasted BibTeX, generating its text citation", async () => {
    await render(<BibliographyPage />, () => names().length === 2);
    await click(button("＋ New source"));
    await type(fieldOf("BibTeX"), "@inproceedings{lamport78, author = {Leslie Lamport}, title = {Time, Clocks, and the Ordering of Events}, booktitle = {CACM}, year = 1978}");
    await click(button("⤴ Fill fields from BibTeX"));
    expect(fieldOf("Name").value).toBe("Lamport 1978");
    expect(fieldOf("Title").value).toBe("Time, Clocks, and the Ordering of Events");
    expect(fieldOf("Type").value).toBe("inproceedings");
    expect(fieldOf("Key").value).toBe("lamport78");
    expect(fieldOf("Book / proceedings title").value).toBe("CACM");

    const genCitation = $$(".dialog[open] .bibl-field-head").find((h) => h.textContent?.startsWith("Text citation"))!;
    await click(button("⚙ Generate", genCitation));
    expect(fieldOf("Text citation").value).toBe("Lamport, L. (1978). Time, Clocks, and the Ordering of Events. CACM.");

    await click(button("Add source"));
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/bibliography")!;
    expect(post.body).toMatchObject({ key: "lamport78", type: "inproceedings", name: "Lamport 1978", year: "1978", venue: "CACM", bibtex: expect.stringContaining("@inproceedings{lamport78") });
    await waitFor(() => names().includes("Lamport 1978"));
  });

  it("edits a source: regenerating BibTeX asks first; renaming the key warns about its uses", async () => {
    await render(<BibliographyPage />, () => names().length === 2);
    await click($$(".bibl-table tbody tr")[0]);
    await waitFor(() => !!$(".bibl-usages"));
    expect($$(".bibl-usages li").map((l) => l.textContent)).toEqual(["§1 Intro — associated with the whole section", "§1#1 Summary — cited in the text"]);

    const bibHead = $$(".dialog[open] .bibl-field-head").find((h) => h.textContent?.startsWith("BibTeX"))!;
    await click(button("⚙ Generate", bibHead));
    expect($(".bibl-confirm pre").textContent).toMatch(/^@article\{knuth84,\n  author  = \{Knuth, Donald E\.\},\n  title   = \{\{Literate Programming\}\},\n  journal = \{The Computer Journal\},/);
    await click(button("Replace"));
    expect(fieldOf("BibTeX").value).toMatch(/journal = \{The Computer Journal\}/);

    await type(fieldOf("Key"), "knuth1984");
    expect($(".dialog[open] .field .notice").textContent).toMatch(/Renaming updates the 2 place\(s\) that use it/);
    await click(button("Save"));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toBe("/api/bibliography/knuth84");
    expect(patch.body).toMatchObject({ key: "knuth1984", name: "Knuth 1984", bibtex: expect.stringContaining("journal = {The Computer Journal}") });
    await waitFor(() => /Key renamed/.test($(".dialog[open] .dialog-body").textContent ?? ""));
  });

  it("imports BibTeX with a preview of duplicates", async () => {
    await render(<BibliographyPage />, () => names().length === 2);
    await click(button("⤓ Import .bib"));
    await type($(".bibl-import-text") as HTMLTextAreaElement, "@misc{new1, title={New}}\n@article{knuth84, title={Dup}}");
    expect($$(".bibl-import-preview li").map((l) => l.textContent)).toEqual(["@misc{new1} New", "@article{knuth84} Dup — already present, skipped"]);
    await click(button("Import"));
    expect(calls.find((c) => c.url === "/api/bibliography/import")!.body).toEqual({ bibtex: expect.stringContaining("@misc{new1"), onDuplicate: "skip" });
    expect($(".import-ok").textContent).toBe("1 added · 1 skipped (already present: knuth84)");
  });

  it("deletes a used source after showing where it is used", async () => {
    await render(<BibliographyPage />, () => names().length === 2);
    await click(button("⋮", $$(".bibl-table tbody tr")[0]) ?? $$(".ref-more")[0]);
    await click(button("Delete…"));
    await waitFor(() => !!button("Delete and remove associations"));
    expect($(".dialog[open] .file-list").textContent).toContain("§1 Intro — associated with the section");
    await click(button("Delete and remove associations"));
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/bibliography/knuth84?force=true")).toBe(true);
    await waitFor(() => names().length === 1);
  });
});

describe("Citations in sections and sub-blocks", () => {
  const tiptap = () => ($(".ProseMirror") as unknown as { editor: Editor }).editor;

  const renderBlock = () => render(<BlockView blockId="b1" onDeleted={() => {}} />, () => !!$(".ProseMirror .md-link") && !!$(".citations-toggle"));
  /** Puts the cursor inside the link whose text is `text`. */
  const cursorIn = async (text: string) => {
    const ed = tiptap();
    let at = -1;
    ed.state.doc.descendants((n, p) => void (at < 0 && n.isText && n.text === text && (at = p + 1)));
    expect(at).toBeGreaterThan(0);
    await act(async () => void ed.chain().focus().setTextSelection(at).run());
    await tick();
  };

  it("marks citations and reference files with icons, flags missing targets, and cites with the Cite button", async () => {
    await renderBlock();
    await waitFor(() => $$(".md-link-bib:not(.missing)").length === 1 && $$(".md-link-ref:not(.missing)").length === 1);
    expect($(".md-link-bib:not(.missing)").getAttribute("title")).toMatch(/^Knuth 1984 · Literate Programming · 1984 — bib:knuth84/);
    expect($(".md-link-bib.missing").textContent).toBe("Old");
    expect($(".md-link-ref:not(.missing)").textContent).toBe("spec");
    expect($(".md-link-ref.missing").textContent).toBe("lost");
    expect($(".md-link-url").textContent).toBe("the site");
    expect($$(".md-link-icon-bib").length).toBe(2);
    expect($$(".md-link-icon-ref").length).toBe(2);
    expect(tiptap().getMarkdown()).toBe(MD); // decorations never touch the content

    // Cite: select "API" and pick React docs.
    const ed = tiptap();
    let from = 0;
    ed.state.doc.descendants((n, p) => void (n.isText && n.text?.includes("The API") && (from = p + 4)));
    await act(async () => void ed.commands.setTextSelection({ from, to: from + 3 }));
    await click(button(/Cite$/));
    await type($(".dialog[open] .bib-search") as HTMLInputElement, "react");
    await click(button(/^React docs/, $(".dialog[open] .bibl-pick")));
    expect(ed.getMarkdown()).toContain("The [API](bib:react) returns JSON.");
  });

  it("edits links from the link bar: change a citation or a file, edit a URL, unlink, remove", async () => {
    await renderBlock();
    const bar = () => $(".link-bar");

    // Citation: shows the source; Change… cites another one (the text follows the source name).
    await cursorIn("Knuth 1984");
    await waitFor(() => !!bar());
    expect($(".link-bar-target", bar()).textContent).toBe("Knuth 1984Literate Programming");
    await click(button("Change…", bar()));
    expect($(".dialog[open] .dialog-head h2").textContent).toBe("Cite another source");
    await click(button(/^React docs/, $(".dialog[open] .bibl-pick")));
    expect(tiptap().getMarkdown()).toContain("See [React docs](bib:react) and");

    // Reference file: Change… links another file.
    await cursorIn("spec");
    await waitFor(() => /references\/papers\/spec\.pdf/.test(bar()?.textContent ?? ""));
    await click(button("Change…", bar()));
    expect($(".dialog[open] .dialog-head h2").textContent).toBe("Link another file");
    await click(button(/data\.csv/, $(".dialog[open] .ref-pick")));
    expect(tiptap().getMarkdown()).toContain("Read [data.csv](../../../references/data.csv), [lost]");

    // Web link: edit the address inline.
    await cursorIn("the site");
    await waitFor(() => /example\.org/.test(bar()?.textContent ?? ""));
    await click(button("Edit", bar()));
    await type($(".link-bar-input") as HTMLInputElement, "https://example.com/docs");
    await click(button("Apply", bar()));
    expect(tiptap().getMarkdown()).toContain("[the site](https://example.com/docs)");

    // Unlink keeps the text; Remove deletes it.
    await cursorIn("lost");
    await waitFor(() => /missing file/.test(bar()?.textContent ?? ""));
    await click(button("Unlink", bar()));
    expect(tiptap().getMarkdown()).toContain(", lost and");
    await cursorIn("Old");
    await waitFor(() => /not in the bibliography/.test(bar()?.textContent ?? ""));
    await click(button("Remove", bar()));
    expect(tiptap().getMarkdown()).toContain("See [React docs](bib:react) and .");
  });

  it("associates sources with a section and a sub-block from the 📚 popover", async () => {
    await renderBlock();
    const [section, sub] = $$(".citations-toggle");
    expect(section.querySelector(".comment-count")?.textContent).toBe("1");
    await click(section);
    expect($$(".citations-popover .assoc-list:not(.add) strong").map((s) => s.textContent)).toEqual(["Knuth 1984"]);
    await type($(".citations-popover .bib-search") as HTMLInputElement, "react");
    await click(button(/^＋ React docs/));
    expect(calls.find((c) => c.method === "PUT")).toMatchObject({ url: "/api/blocks/b1/citations", body: { keys: ["knuth84", "react"] } });

    await click(section); // close
    await click(sub);
    expect($$(".citations-popover").length).toBe(1);
    expect($(".citations-popover .assoc-intext").textContent).toBe("Cited in the text: Knuth 1984, gone");
    await click(button(/^＋ Knuth 1984/, $(".citations-popover")));
    expect(calls.filter((c) => c.method === "PUT").pop()).toMatchObject({ url: "/api/blocks/b1/subblocks/md1/citations", body: { keys: ["knuth84"] } });
  });

  it("attaches reference files to a section and a sub-block from the 📎 popover", async () => {
    await renderBlock();
    await waitFor(() => $$(".attachments-toggle").length === 2);
    const [section, sub] = $$(".attachments-toggle");
    expect(section.querySelector(".comment-count")?.textContent).toBe("1");
    await click(section);
    expect($$(".attachments-popover .assoc-list:not(.add) .assoc-open").map((s) => s.textContent)).toEqual([expect.stringMatching(/data\.csvreferences\/$/)]);
    await type($(".attachments-popover .bib-search") as HTMLInputElement, "spec");
    await click(button(/^＋ .*spec\.pdf/));
    expect(calls.find((c) => c.method === "PUT")).toMatchObject({ url: "/api/blocks/b1/references", body: { paths: ["data.csv", "papers/spec.pdf"] } });

    await click(section);
    await click(sub);
    expect($(".attachments-popover .assoc-intext").textContent).toMatch(/^Linked in the text: .*spec\.pdf, .*nope\.pdf$/);
    await click(button(/^＋ .*data\.csv/, $(".attachments-popover")));
    expect(calls.filter((c) => c.method === "PUT").pop()).toMatchObject({ url: "/api/blocks/b1/subblocks/md1/references", body: { paths: ["data.csv"] } });
  });
});
