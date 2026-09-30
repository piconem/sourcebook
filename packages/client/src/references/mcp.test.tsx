// @vitest-environment jsdom
import type { McpInfo, McpManifest, ReferenceNode } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferencesBrowser } from "./ReferencesBrowser";
import { ReferencesProvider } from "./ReferencesContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
document.elementFromPoint ??= () => null;

const file = (path: string, mcp: McpInfo): ReferenceNode => ({ name: path.split("/").pop()!, path, kind: "file", size: 2048, modified: "2026-09-01T10:00:00Z", mcp });
const manifest: McpManifest = {
  version: 1,
  source: { path: "paper.pdf", size: 2048, mtimeMs: 1, sha256: "ab".repeat(32) },
  format: "pdf",
  converter: "pdfjs-dist 6.3",
  createdAt: "2026-09-30T10:00:00.000Z",
  unit: "page",
  parts: [
    { n: 1, kind: "text+figures", chars: 900, imageCoverage: 0, figures: [{ id: "p1-1", page: 1, caption: "Figure 1: Overview of the system.", kind: "drawing", bbox: [100, 300, 400, 600], image: "figures/p001-1.webp" }] },
    { n: 2, kind: "scan", chars: 0, imageCoverage: 1, needsImage: true, image: "pages/p002.webp" },
  ],
  warnings: ["1 scanned page(s)."],
};
const markdown = "# paper.pdf\n\n_Converted to Markdown from PDF · 2 pages._\n\n<!-- sourcebook:page 1 -->\n## Page 1\n\nHello world.\n\n<!-- sourcebook:page 2 -->\n## Page 2\n\n_Page 2 contains a scanned image with no text layer: read it with read_reference_pages (pages \"2\")._\n";
let tree: ReferenceNode;
const calls: { method: string; url: string; body?: any }[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  tree = {
    name: "references", path: "", kind: "dir",
    children: [
      { name: "docs", path: "docs", kind: "dir", children: [file("docs/slides.pptx", { status: "converting", kind: "markdown", unit: "slide" }), file("docs/old.ppt", { status: "unsupported", kind: "none" })] },
      file("notes.md", { status: "native", kind: "text" }),
      file("paper.pdf", { status: "ready", kind: "markdown", unit: "page", parts: 2, pageImages: 1, imageOnlyParts: 1 }),
      file("broken.docx", { status: "failed", kind: "markdown", unit: "document", error: "Corrupted zip" }),
    ],
  };
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    url = url.replace(/^\/api\/(?:projects|templates)\/[^/?]+(?=[/?]|$)/, "/api");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/references") return json(tree);
    if (url === "/api/references/mcp/convert") return json({ results: body.paths.map((path: string) => ({ path, status: "ready", kind: "markdown" })) });
    if (url === "/api/references/mcp?path=paper.pdf") return json({ info: tree.children![2].mcp, manifest, markdown });
    return json({ error: "unexpected" }, 500);
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

const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));
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

async function render() {
  localStorage.setItem("sourcebook.references.layout", "list");
  host = document.createElement("div");
  document.body.appendChild(host);
  const r = (root = createRoot(host));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    r.render(
      <QueryClientProvider client={qc}>
        <ReferencesProvider>
          <ReferencesBrowser />
        </ReferencesProvider>
      </QueryClientProvider>,
    ),
  );
  await waitFor(() => !!$(".mcp-bar"));
}
const badgeOf = (name: string) => {
  const row = $$(".ref-list tbody tr, .ref-card").find((r) => r.textContent?.includes(name))!;
  return $(".mcp-badge", row);
};

describe("References: assistant (MCP) status", () => {
  it("shows a badge per file, the readable count, and filters the files not readable yet", async () => {
    await render();
    if (!$(".ref-list")) await click(button("☰"));
    expect($(".mcp-bar-count").textContent).toMatch(/2 of 5 files readable by the assistant/);
    expect($(".mcp-bar").textContent).toContain("1 being converted…");
    expect($$(".ref-list thead th").map((t) => t.textContent)).toContain("Assistant ready");
    expect(badgeOf("notes.md").textContent).toBe("Yes");
    expect(badgeOf("paper.pdf").textContent).toBe("Yes");
    expect(badgeOf("paper.pdf").title).toBe("Converted to Markdown (2 pages). 1 page(s) without text are read as images.");
    expect(badgeOf("broken.docx").textContent).toBe("No");
    expect(badgeOf("broken.docx").title).toMatch(/Corrupted zip/);
    // Folder button (conversion details) only for converted documents.
    const rowOf = (name: string) => $$(".ref-list tbody tr").find((r) => r.textContent?.includes(name))!;
    expect(!!$(".mcp-inspect", rowOf("paper.pdf"))).toBe(true);
    expect(!!$(".mcp-inspect", rowOf("broken.docx"))).toBe(true);
    expect($(".mcp-inspect", rowOf("notes.md"))).toBeNull();

    const filter = $(".mcp-bar input[type=checkbox]") as HTMLInputElement;
    await click(filter);
    const names = $$(".ref-list-name").map((n) => n.textContent);
    expect(names).toEqual([expect.stringContaining("broken.docx"), expect.stringMatching(/old\.ppt — docs\//), expect.stringMatching(/slides\.pptx — docs\//)]);
    expect(badgeOf("old.ppt").textContent).toBe("No");
    expect(badgeOf("slides.pptx").textContent).toBe("Converting");
    expect($(".mcp-inspect", $$(".ref-list tbody tr").find((r) => r.textContent?.includes("slides.pptx"))!)).toBeNull();
  });

  it("converts from the context menu and inspects the generated content", async () => {
    await render();
    if (!$(".ref-list")) await click(button("☰"));
    const row = $$(".ref-list tbody tr").find((r) => r.textContent?.includes("paper.pdf"))!;
    await act(async () => void row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })));
    await click(button("Convert again for the assistant"));
    expect(calls.find((c) => c.url === "/api/references/mcp/convert")?.body).toEqual({ paths: ["paper.pdf"], force: true });
    await waitFor(() => /Converted 1 file to Markdown/.test($(".ref-status")?.textContent ?? ""));

    await click($(".mcp-inspect", $$(".ref-list tbody tr").find((r) => r.textContent?.includes("paper.pdf"))!));
    await waitFor(() => !!$(".mcp-summary"));
    const dialog = $(".dialog[open]");
    expect($(".dialog-head h2", dialog).textContent).toBe("Assistant content · paper.pdf");
    expect($(".mcp-summary", dialog).textContent).toMatch(/PDF → Markdown.*2 pages.*tokens \(approx\.\).*1 figure.*1 page images.*1 page\(s\) readable only as images/);
    expect($$(".tabs button", dialog).map((b) => b.textContent)).toEqual(["Markdown", "Figures (1)", "Pages", "What the assistant sees", "Details"]);

    await click(button("Figures (1)", dialog));
    expect($(".mcp-figure", dialog).textContent).toBe("p1-1 · page 1Figure 1: Overview of the system.");
    expect(($(".mcp-figure img", dialog) as HTMLImageElement).getAttribute("src")).toMatch(/\/references\/mcp\/figure\?path=paper\.pdf&id=p1-1&v=/);
    await click($(".mcp-figure", dialog));
    expect($(".mcp-figure-full-caption", dialog).textContent).toBe("Figure 1: Overview of the system.");
    await click(button("Page 1", dialog));
    expect($(".mcp-page-detail", dialog).textContent).toContain("Page 1 of 2");

    await click(button("What the assistant sees", dialog));
    expect($(".mcp-source", dialog).textContent).toMatch(/^references\/paper\.pdf — converted to Markdown from PDF \(2 pages\) on 2026-09-30\.\nPage 2 has no usable text/);

    await click(button("Pages", dialog));
    await click(button("← All pages", dialog));
    expect($$(".mcp-page", dialog).map((p) => p.textContent)).toEqual(["No image1 · Text + figures", "2 · Scan"]);
    expect(($(".mcp-page img", dialog) as HTMLImageElement).getAttribute("src")).toMatch(/\/references\/mcp\/page\?path=paper\.pdf&n=2&v=/);
    await click($$(".mcp-page", dialog)[1]);
    expect($(".mcp-page-detail", dialog).textContent).toContain("Page 2 of 2");
    expect($(".mcp-side-by-side .mcp-source", dialog).textContent).toContain("## Page 2");

    await click(button("Details", dialog));
    expect($(".mcp-details", dialog).textContent).toContain("pdfjs-dist 6.3");
    expect($(".mcp-details", dialog).textContent).toContain("⚠ 1 scanned page(s).");
    expect($$(".mcp-parts tbody tr", dialog).map((r) => r.textContent)).toEqual(["1Text + figures900", "2Scan0100%✓"]);
  });
});
