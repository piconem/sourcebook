// @vitest-environment jsdom
import type { Block, ReferenceImages } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockView } from "../components/BlockView";
import { InsertImageDialog } from "./InsertImageDialog";
import { ReferencesProvider } from "./ReferencesContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const images: ReferenceImages = {
  images: [{ path: "diagrams/arch.png", name: "arch.png", size: 2048 }],
  documents: [
    {
      path: "papers/paper.pdf",
      name: "paper.pdf",
      figures: [
        { id: "p3-1", page: 3, caption: "Fig. 1. Target environment.", kind: "drawing", bbox: [64, 566, 262, 738], image: "figures/p003-1.webp" },
        { id: "p7-2", page: 7, caption: "Fig. 5. Two ambassador containers.", kind: "drawing", bbox: [126, 432, 469, 553], image: "figures/p007-2.webp" },
      ],
    },
  ],
};
let block: Block;
const calls: { method: string; url: string; body?: any }[] = [];

beforeEach(() => {
  calls.length = 0;
  block = {
    id: "b1", title: "Results", parentId: null, order: 1, folder: "001-results",
    subBlocks: [{ id: "img1", type: "image", order: 1, source: "01-image.md", exports: [], props: {}, content: { src: "", alt: "", caption: "" } }],
  };
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    url = url.replace(/^\/api\/(?:projects|templates)\/[^/?]+(?=[/?]|$)/, "/api");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/references") return json({ name: "references", path: "", kind: "dir", children: [] });
    if (url === "/api/references/images") return json(images);
    if (url === "/api/blocks/b1") return json(block);
    if (url === "/api/notebook")
      return json({ name: "P", blocks: [{ id: "b1", title: "Results", parentId: null, order: 1, folder: "001-results", subBlocks: [] }, { id: "b2", title: "Discussion", parentId: "b1", order: 1, folder: "002-discussion", subBlocks: [] }] });
    if (url === "/api/blocks/b1/assets/from-reference")
      return json({ path: "assets/abc123.webp", url: "/x", alt: "paper, page 7", caption: "Fig. 5. Two ambassador containers." }, 201);
    if (url === "/api/blocks/b1/subblocks/img1" && method === "PATCH") return json({ ...block.subBlocks[0], ...body, rev: 1 });
    if (url === "/api/blocks/b2/images/from-reference") return json({ id: "n1", type: "image", content: {} }, 201);
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
  for (let i = 0; i < 150 && !check(); i++) await tick();
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
async function render(ui: ReactNode, ready: () => boolean) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const r = (root = createRoot(host));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => r.render(<QueryClientProvider client={qc}><ReferencesProvider>{ui}</ReferencesProvider></QueryClientProvider>));
  await waitFor(ready);
}

describe("images from references", () => {
  it("fills an image sub-block with a figure of a reference document (copied, caption suggested, source attached)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await render(<BlockView blockId="b1" onDeleted={() => {}} />, () => !!$(".image-sub"));
    await click(button(/From references…/));
    const dialog = $(".dialog[open]");
    expect($$(".tabs button", dialog).map((b) => b.textContent)).toEqual(["Figures from documents (2)", "Image files (1)"]);
    await waitFor(() => $$(".img-pick", dialog).length === 2);
    expect($(".img-pick-doc", dialog).textContent).toContain("paper.pdf");
    expect($$(".img-pick img", dialog).map((i) => i.getAttribute("src"))).toEqual([
      expect.stringMatching(/\/references\/mcp\/figure\?path=papers%2Fpaper\.pdf&id=p3-1$/),
      expect.stringMatching(/&id=p7-2$/),
    ]);

    // Search by caption, then pick.
    const search = $(".img-pick-search", dialog) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "ambassador");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect($$(".img-pick", dialog)).toHaveLength(1);
    await click($(".img-pick", dialog));
    expect(calls.find((c) => c.url === "/api/blocks/b1/assets/from-reference")?.body).toEqual({ path: "papers/paper.pdf", figure: "p7-2", attachTo: "img1" });
    await waitFor(() => !!$(".image-sub img"));
    expect($(".image-sub img").getAttribute("src")).toMatch(/\/blocks\/b1\/files\/assets\/abc123\.webp$/);
    expect(($$(".image-fields input")[1] as HTMLInputElement).value).toBe("Fig. 5. Two ambassador containers.");
    expect($(".image-sub").textContent).toContain("Copied from references/papers/paper.pdf (figure p7-2)");
    expect(button(/Replace from references…/)).toBeTruthy();

    // The content is saved with the copied asset.
    await act(async () => void vi.advanceTimersByTime(2000));
    await waitFor(() => calls.some((c) => c.method === "PATCH"));
    expect(calls.find((c) => c.method === "PATCH")?.body.content).toEqual({ src: "assets/abc123.webp", alt: "paper, page 7", caption: "Fig. 5. Two ambassador containers." });
    vi.useRealTimers();
  });

  it("inserts a figure into a chosen section as a new image sub-block", async () => {
    const done = vi.fn();
    await render(
      <InsertImageDialog source={{ path: "papers/paper.pdf", figure: "p3-1", caption: "Fig. 1. Target environment." }} onClose={() => {}} onDone={done} />,
      () => $$(".dialog[open] select option").length === 2,
    );
    const dialog = $(".dialog[open]");
    expect($$("option", dialog).map((o) => o.textContent)).toEqual(["1 Results", "\u00A0\u00A01.1 Discussion"]);
    const select = $("select", dialog) as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "b2");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(($("textarea", dialog) as HTMLTextAreaElement).value).toBe("Fig. 1. Target environment.");
    await click(button("Add image", dialog));
    expect(calls.find((c) => c.url === "/api/blocks/b2/images/from-reference")?.body).toEqual({ path: "papers/paper.pdf", figure: "p3-1", caption: "Fig. 1. Target environment." });
    expect(done).toHaveBeenCalledWith("Added to §1.1 Discussion as an image sub-block.");
  });
});
