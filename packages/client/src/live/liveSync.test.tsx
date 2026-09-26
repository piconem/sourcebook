// @vitest-environment jsdom
import type { Block, Comment } from "@sourcebook/shared";
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keys } from "../api/queries";
import { BlockView } from "../components/BlockView";
import { ExternalChanges, ExternalChangesContext } from "./externalChanges";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
document.elementFromPoint ??= () => null;

/** Server state of one code sub-block, with the real revision rules (409 on stale expectedRev). */
let server: { code: string; rev: number };
let comments: Comment[];
const patches: { content?: { code: string }; expectedRev?: number }[] = [];

const block = (): Block => ({
  id: "b1", title: "Intro", parentId: null, order: 1, folder: "001-intro",
  subBlocks: [{ id: "s1", type: "code", order: 1, source: "01-code.py", exports: [], props: {}, rev: server.rev, commentCount: comments.length, content: { language: "python", code: server.code } }],
});

beforeEach(() => {
  server = { code: "a = 1\n", rev: 0 };
  comments = [];
  patches.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
    url = url.replace(/^\/api\/projects\/[^/]+/, "/api");
    if (url === "/api/user") return json({ name: "Mario Rossi", username: "mario" });
    if (url === "/api/blocks/b1") return json(block());
    if (url.endsWith("/comments")) return json({ comments });
    if (url === "/api/blocks/b1/subblocks/s1" && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      patches.push(body);
      if (body.expectedRev !== undefined && body.expectedRev !== server.rev) return json({ error: "changed", details: { currentRev: server.rev } }, 409);
      if (body.content) server = { code: body.content.code, rev: server.rev + 1 };
      return json({ ...block().subBlocks[0] });
    }
    return json({ error: url }, 500);
  }));
});

let root: Root;
let host: HTMLDivElement;
let qc: QueryClient;
let changes: ExternalChanges;
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const tick = (ms = 10) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const until = async (check: () => boolean, tries = 150) => {
  for (let i = 0; i < tries && !check(); i++) await tick();
  expect(check()).toBe(true);
};
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const view = () => EditorView.findFromDOM($(".cm-editor"))!;
const editorText = () => view().state.doc.toString();
const click = async (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  changes = new ExternalChanges();
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <ExternalChangesContext.Provider value={changes}>
          <BlockView blockId="b1" number="1" onDeleted={() => {}} />
        </ExternalChangesContext.Provider>
      </QueryClientProvider>,
    ),
  );
  await until(() => !!$(".cm-editor"));
}

/** What the live event handler does when the assistant changes the sub-block. */
async function assistantWrites(code: string) {
  server = { code, rev: server.rev + 1 };
  await act(async () => {
    changes.record("s1", server.rev, "mcp");
    await qc.invalidateQueries({ queryKey: keys.block("b1") });
  });
}

describe("live collaboration", () => {
  it("shows the assistant's change at once when there are no local edits", async () => {
    await render();
    expect(editorText()).toBe("a = 1\n");
    await assistantWrites("a = 1\nb = 2\n");
    await until(() => editorText() === "a = 1\nb = 2\n");
    expect($(".live-flash").textContent).toBe("Updated by the assistant");
    expect($(".conflict-banner")).toBeNull();
    expect(patches).toEqual([]); // nothing written back
  });

  it("asks which version to keep when the user is editing — Load their version", async () => {
    await render();
    await act(async () => view().dispatch({ changes: { from: 0, insert: "# mine\n" } }));
    await assistantWrites("theirs = True\n");
    await until(() => !!$(".conflict-banner"));
    expect($(".conflict-banner").textContent).toContain("Changed by the assistant");
    await click(button("Load their version"));
    await until(() => editorText() === "theirs = True\n");
    await tick(700); // past the save debounce: the discarded edit must not be saved
    expect(patches.filter((p) => p.content)).toEqual([]);
    expect($(".conflict-banner")).toBeNull();
  });

  it("Keep mine saves the local version on top of the new revision", async () => {
    await render();
    await act(async () => view().dispatch({ changes: { from: 0, insert: "# mine\n" } }));
    await assistantWrites("theirs = True\n");
    await until(() => !!$(".conflict-banner"));
    await click(button("Keep mine"));
    await until(() => server.code === "# mine\na = 1\n");
    expect(patches.at(-1)).toMatchObject({ content: { code: "# mine\na = 1\n" }, expectedRev: 1 });
    expect($(".conflict-banner")).toBeNull();
  });

  it("a save rejected because of a newer revision opens the conflict banner", async () => {
    await render();
    server = { code: "changed elsewhere\n", rev: 5 }; // no event received (e.g. connection lost)
    await act(async () => view().dispatch({ changes: { from: 0, insert: "x" } }));
    await until(() => !!$(".conflict-banner"));
    expect(patches[0]).toMatchObject({ expectedRev: 0 });
    expect(server.code).toBe("changed elsewhere\n"); // not overwritten
  });

  it("marks comments written by the assistant", async () => {
    comments = [{ id: "c1", author: { name: "Claude (assistant)", username: "claude", kind: "assistant" }, createdAt: "2026-09-26T10:00:00Z", text: "Rename a", replies: [] }];
    await render();
    await click($(".comment-toggle"));
    await until(() => !!$(".badge-ai"));
    expect($(".comment-name").textContent).toBe("Claude (assistant)AI");
  });
});
