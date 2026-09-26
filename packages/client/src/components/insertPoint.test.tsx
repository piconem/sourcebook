// @vitest-environment jsdom
import type { Block } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockView } from "./BlockView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let block: Block;
const posts: unknown[] = [];

const equation = (id: string, order: number) => ({
  id, type: "equation", order, source: `0${order}-equation.tex`, exports: [], props: {}, content: { latex: "x" }, commentCount: 0,
});

beforeEach(() => {
  posts.length = 0;
  block = { id: "b1", title: "Intro", parentId: null, order: 1, folder: "001-intro", subBlocks: [equation("s1", 1), equation("s2", 2)] };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return json(equation("new", 3), 201);
    }
    if (url.endsWith("/blocks/b1")) return json(block);
    if (url.endsWith("/user")) return json({ name: "Mario Rossi", username: "mariorossi" });
    return json({ error: url }, 500);
  }));
});

let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));
const $ = (sel: string, scope: ParentNode = document) => scope.querySelector(sel) as HTMLElement;
const $$ = (sel: string, scope: ParentNode = document) => [...scope.querySelectorAll(sel)] as HTMLElement[];
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await tick();
};
const typeButton = (label: string, scope: ParentNode) => $$(".insert-options button", scope).find((b) => b.textContent?.includes(label))!;

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={qc}><BlockView blockId="b1" onDeleted={() => {}} /></QueryClientProvider>));
  for (let i = 0; i < 50 && !$(".subblock"); i++) await tick();
}

describe("insertion points", () => {
  it("offers a + before, between and (always open) after the sub-blocks", async () => {
    await render();
    const points = $$(".insert-point");
    expect(points.map((p) => p.dataset.position)).toEqual(["0", "1", "2"]);
    expect(points.map((p) => p.classList.contains("persistent"))).toEqual([false, false, true]);
    expect($$(".insert-plus")).toHaveLength(2);
    // Order in the page: point 0, sub-block 1, point 1, sub-block 2, end options.
    const sequence = $$(".insert-point, .subblock").map((e) => (e.classList.contains("subblock") ? "S" : `+${e.dataset.position}`));
    expect(sequence).toEqual(["+0", "S", "+1", "S", "+2"]);
    expect($$(".insert-options button", points[2]).map((b) => b.textContent?.trim())).toContain("¶ Markdown");
  });

  it("inserts at the chosen position between two sub-blocks", async () => {
    await render();
    const between = $$(".insert-point")[1];
    expect($(".insert-options", between)).toBeNull();
    await click($(".insert-plus", between));
    expect(between.classList.contains("open")).toBe(true);
    await click(typeButton("Code", between));
    expect(posts).toEqual([{ type: "code", position: 1 }]);
    expect(between.classList.contains("open")).toBe(false);
  });

  it("Esc closes the options; the end options append", async () => {
    await render();
    const first = $$(".insert-point")[0];
    await click($(".insert-plus", first));
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(first.classList.contains("open")).toBe(false);

    await click(typeButton("Mermaid", $$(".insert-point")[2]));
    expect(posts).toEqual([{ type: "mermaid" }]);
  });

  it("an empty section shows the options with a hint", async () => {
    block = { ...block, subBlocks: [] };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={qc}><BlockView blockId="b1" onDeleted={() => {}} /></QueryClientProvider>));
    for (let i = 0; i < 50 && !$(".insert-point"); i++) await tick();
    expect($$(".insert-point")).toHaveLength(1);
    expect($(".insert-label").textContent).toMatch(/empty/);
  });
});
