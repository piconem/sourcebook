// @vitest-environment jsdom
import type { Block, Comment } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockView } from "../components/BlockView";
import { ReferencesProvider } from "../references/ReferencesContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout: CodeMirror/ProseMirror measuring APIs need stubs.
Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
document.elementFromPoint ??= () => null;
Element.prototype.scrollIntoView ??= () => {};

const code = "import os\n\ndef main():\n    print('hi')\n";
const markdown = "The API is REST.\n\nThe API returns JSON for every call.";
let comments: Record<string, Comment[]>;
let block: Block;
const calls: { method: string; url: string; body?: any }[] = [];
const author = { name: "Mario Rossi", username: "mariorossi" };

beforeEach(() => {
  calls.length = 0;
  comments = {
    code1: [{ id: "c1", author, createdAt: "2026-09-01T10:00:00Z", text: "Use logging", replies: [],
      anchor: { unit: "lines", exact: "    print('hi')", prefix: "def main():\n", suffix: "\n", start: 23 } }],
    md1: [{ id: "m1", author, createdAt: "2026-09-01T10:00:00Z", text: "Which schema?", replies: [],
      anchor: { unit: "text", exact: "returns JSON", prefix: "The API ", suffix: " for every", start: 26 } }],
  };
  block = {
    id: "b1", title: "Intro", parentId: null, order: 1, folder: "001-intro",
    subBlocks: [
      { id: "code1", type: "code", order: 1, source: "01-code.py", exports: [], props: {}, content: { language: "python", code }, commentCount: 1 },
      { id: "md1", type: "markdown", order: 2, source: "02-markdown.md", exports: [], props: {}, content: { markdown }, commentCount: 1 },
    ],
  };
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    url = url.replace(/^\/api\/(?:projects|templates)\/[^/?]+(?=[/?]|$)/, "/api").replace(/^\/api\/notebook$/, "/api/project");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/user") return json(author);
    if (url === "/api/references") return json({ name: "references", path: "", kind: "dir", children: [] });
    if (url === "/api/blocks/b1") return json(block);
    const m = /^\/api\/blocks\/b1\/subblocks\/(\w+)(\/comments)?(?:\/(\w+))?$/.exec(url);
    if (m && !m[2] && method === "PATCH") return json({ ...block.subBlocks.find((s) => s.id === m[1]), ...body });
    if (m?.[2]) {
      const list = comments[m[1]];
      if (method === "GET") return json({ comments: list });
      if (method === "PATCH") {
        const c = list.find((x) => x.id === m[3])!;
        c.anchor = body.anchor ?? undefined;
        return json(c);
      }
      const c = { id: `n${list.length}`, author, createdAt: new Date().toISOString(), text: body.text, anchor: body.anchor, replies: [] };
      list.push(c);
      return json(c, 201);
    }
    return json({ error: `unexpected ${method} ${url}` }, 500);
  }));
});

let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const tick = (ms = 10) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await tick();
  expect(check()).toBe(true);
};
const $ = (sel: string, scope: ParentNode = document) => scope.querySelector(sel) as HTMLElement;
const $$ = (sel: string, scope: ParentNode = document) => [...scope.querySelectorAll(sel)] as HTMLElement[];
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await tick();
};

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <ReferencesProvider>
          <BlockView blockId="b1" onDeleted={() => {}} />
        </ReferencesProvider>
      </QueryClientProvider>,
    ),
  );
  await waitFor(() => !!$(".cm-comment-line") && !!$(".comment-hl"));
}

const rows = () => $$(".subblock-row:not(.insert-row)");
const cmView = () => EditorView.findFromDOM($(".cm-editor"))!;
const tiptap = () => ($(".ProseMirror") as unknown as { editor: import("@tiptap/core").Editor }).editor;

describe("line comments on Code", () => {
  it("highlights the anchored line and follows edits; detaches when the line is deleted", async () => {
    await render();
    expect($$(".cm-comment-line").map((l) => l.textContent)).toEqual(["    print('hi')"]);
    expect($(".cm-comment-marker").textContent).toBe("💬");

    await click($(".comment-toggle", rows()[0]));
    await waitFor(() => $(".comment-quote-lines", rows()[0])?.textContent === "Line 4");

    // Insert two lines on top: the comment moves to line 6.
    await act(async () => cmView().dispatch({ changes: { from: 0, insert: "import sys\nimport re\n" } }));
    await waitFor(() => $(".comment-quote-lines", rows()[0])?.textContent === "Line 6");

    // Delete the commented line: the comment is detached, not lost.
    const doc = cmView().state.doc.toString();
    const at = doc.indexOf("    print");
    await act(async () => cmView().dispatch({ changes: { from: at, to: at + "    print('hi')\n".length } }));
    await waitFor(() => !!$(".comment-thread.is-detached", rows()[0]));
    expect($(".comment-detached", rows()[0]).textContent).toMatch(/Text changed/);
    expect($(".cm-comment-line")).toBeNull();
  });

  it("clicking the gutter of an uncommented line opens a new line comment", async () => {
    await render();
    await click($(".comment-lines-btn")); // cursor at start: line 1
    const box = $(".comment-thread.new", rows()[0]);
    expect($(".comment-quote-text", box).textContent).toBe("import os");
    const area = $("textarea", box) as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "Unused import");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click([...box.querySelectorAll("button")].find((b) => b.textContent === "Comment")!);
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toMatchObject({ text: "Unused import", anchor: { unit: "lines", exact: "import os", start: 0 } });
    // Visible markers only (CodeMirror also renders a hidden spacer element to size the gutter).
    const visibleMarkers = () => $$(".cm-comment-marker").filter((m) => (m.parentElement as HTMLElement).style.visibility !== "hidden");
    await waitFor(() => visibleMarkers().length === 2);
    expect($$(".cm-comment-line").map((l) => l.textContent)).toEqual(["import os", "    print('hi')"]);
  });

  it("stores a refreshed anchor after the content is saved", async () => {
    await render();
    // Edit inside the commented line: the highlight follows; after the debounced save the anchor is updated.
    const at = cmView().state.doc.toString().indexOf("'hi'");
    await act(async () => cmView().dispatch({ changes: { from: at, to: at + 4, insert: "'hello'" } }));
    await waitFor(() => calls.some((c) => c.method === "PATCH" && c.url.endsWith("/comments/c1")));
    expect(calls.find((c) => c.url.endsWith("/comments/c1"))?.body.anchor).toMatchObject({ unit: "lines", exact: "    print('hello')" });
  });
});

describe("text comments on Markdown", () => {
  it("highlights the quoted text, activates the thread on click, and detaches when the text is removed", async () => {
    await render();
    expect($$(".comment-hl").map((e) => e.textContent).join("")).toBe("returns JSON");

    await click($(".comment-hl"));
    const panel = $(".comments-panel", rows()[1]);
    expect(panel).toBeTruthy();
    expect($(".comment-thread.active", panel).textContent).toContain("Which schema?");
    expect($(".comment-quote-text", panel).textContent).toBe("returns JSON");

    const ed = tiptap();
    const text = ed.state.doc.textBetween(0, ed.state.doc.content.size, "\n");
    expect(text).toContain("returns JSON");
    await act(async () => {
      ed.commands.setContent("The API is REST.\n\nIt answers with YAML.", { contentType: "markdown" });
    });
    await waitFor(() => !!$(".comment-thread.is-detached", rows()[1]));
    expect($(".comment-hl")).toBeNull();
  });

  it("comments a selection through the floating button", async () => {
    await render();
    const ed = tiptap();
    let from = -1;
    ed.state.doc.descendants((n, pos) => {
      if (n.isText && n.text!.includes("REST")) from = pos + n.text!.indexOf("REST");
    });
    await act(async () => void ed.chain().focus().setTextSelection({ from, to: from + 4 }).run());
    await waitFor(() => !!$(".selection-comment"));
    await click($(".selection-comment"));
    expect($(".comment-thread.new .comment-quote-text", rows()[1]).textContent).toBe("REST");
  });
});
