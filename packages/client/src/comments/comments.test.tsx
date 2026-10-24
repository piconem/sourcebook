// @vitest-environment jsdom
import type { Block, Comment } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockView } from "../components/BlockView";
import { TopBar } from "../components/TopBar";
import { AppearanceProvider } from "../theme/AppearanceContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let user = { name: "Mario Rossi", username: "mariorossi" };
let comments: Record<string, Comment[]>;
let block: Block;
const calls: { method: string; url: string; body?: any }[] = [];

beforeEach(() => {
  calls.length = 0;
  user = { name: "Mario Rossi", username: "mariorossi" };
  comments = { s1: [], s2: [{ id: "c0", author: { name: "Anna Bianchi", username: "annab" }, createdAt: "2026-09-01T10:00:00Z", text: "Old note", replies: [] }] };
  const sub = (id: string, order: number) => ({
    id, type: "equation", order, source: `0${order}-equation.tex`, exports: [], props: {}, content: { latex: "x" },
    commentCount: comments[id].length,
  });
  block = { id: "b1", title: "Intro", parentId: null, order: 1, folder: "001-intro", subBlocks: [sub("s1", 1), sub("s2", 2)] };
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  let t = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    url = url.replace(/^\/api\/(?:projects|templates)\/[^/?]+(?=[/?]|$)/, "/api").replace(/^\/api\/notebook$/, "/api/project");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/user") return method === "PUT" ? json((user = body)) : json(user);
    if (url === "/api/blocks/b1") return json(block);
    const m = /^\/api\/blocks\/b1\/subblocks\/(\w+)\/comments(?:\/(\w+)\/replies)?$/.exec(url);
    if (m) {
      const list = comments[m[1]];
      const entry = { id: `n${++t}`, author: user, createdAt: new Date(Date.now() + t).toISOString(), text: body?.text };
      if (method === "GET") return json({ comments: list });
      if (m[2]) {
        list.find((c) => c.id === m[2])!.replies.push(entry);
        return json(entry, 201);
      }
      list.push({ ...entry, replies: [] });
      return json({ ...entry, replies: [] }, 201);
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
});

const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));
async function render(ui: React.ReactNode, ready: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>));
  for (let i = 0; i < 50 && !document.querySelector(ready); i++) await tick();
}
const $ = (sel: string, scope: ParentNode = document) => scope.querySelector(sel) as HTMLElement;
const $$ = (sel: string, scope: ParentNode = document) => [...scope.querySelectorAll(sel)] as HTMLElement[];
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await tick();
};
const type = async (el: HTMLTextAreaElement | HTMLInputElement, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const button = (label: string, scope: ParentNode = document) =>
  $$("button", scope).find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label)!;

describe("sub-block comments", () => {
  it("highlights the icon only when there are comments and shows them in the right column", async () => {
    await render(<BlockView blockId="b1" onDeleted={() => {}} />, ".subblock");
    const [row1, row2] = $$(".subblock-row:not(.insert-row)");
    expect($(".comment-toggle", row1).classList.contains("has-comments")).toBe(false);
    expect($(".comment-toggle", row2).classList.contains("has-comments")).toBe(true);
    expect($(".comment-count", row2).textContent).toBe("1");
    expect($(".comments-panel")).toBeNull();

    await click($(".comment-toggle", row2));
    expect($(".block-view").classList.contains("with-comments")).toBe(true);
    expect($(".comments-panel", row2).textContent).toContain("Old note");
    expect($(".comments-panel", row2).textContent).toContain("@annab");
    expect($(".comments-gutter", row1)).toBeTruthy(); // column space kept for alignment

    await click(button("Hide comments", row2));
    expect($(".comments-panel")).toBeNull();
    expect($(".block-view").classList.contains("with-comments")).toBe(false);
  });

  it("adds a comment with the current user, then a reply, in insertion order", async () => {
    await render(<BlockView blockId="b1" onDeleted={() => {}} />, ".subblock");
    const row1 = $$(".subblock-row:not(.insert-row)")[0];
    await click(button("Add a comment", row1));
    const panel = $(".comments-panel", row1);
    expect($(".comment-thread.new", panel).textContent).toContain("Mario Rossi");

    await type($("textarea", panel) as HTMLTextAreaElement, "First remark");
    await click(button("Comment", panel));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ text: "First remark" });
    expect($(".comment-thread.new", panel)).toBeNull();
    expect($$(".comment-text", panel).map((e) => e.textContent)).toEqual(["First remark"]);
    // The header icon is now highlighted with the count.
    expect($(".comment-toggle", row1).classList.contains("has-comments")).toBe(true);
    expect($(".comment-count", row1).textContent).toBe("1");

    await click(button("＋", panel));
    await type($(".comment-thread.new textarea", panel) as HTMLTextAreaElement, "Second remark");
    await click(button("Comment", panel));
    await click(button("Reply", panel));
    await type($(".comment-thread textarea", panel) as HTMLTextAreaElement, "An answer");
    await click($$("button", panel).find((b) => b.textContent === "Reply" && b.classList.contains("primary"))!);

    expect($$(".comment-entry.comment .comment-text", panel).map((e) => e.textContent)).toEqual(["First remark", "Second remark"]);
    expect($$(".comment-entry.reply .comment-text", panel).map((e) => e.textContent)).toEqual(["An answer"]);
    expect($(".comment-count", row1).textContent).toBe("2");
  });
});

describe("top bar settings", () => {
  it("edits the name; the username is the account id and is shown, not edited", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    await render(
      <AppearanceProvider>
        <TopBar scrollMode="section" onScrollModeChange={() => {}} />
      </AppearanceProvider>,
      ".topbar .avatar:not(.placeholder)",
    );
    expect($(".brand").textContent).toBe("Sourcebook");
    expect($(".topbar .avatar").textContent).toBe("MR");

    await click(button("User menu"));
    await click($$("[role=menuitem]").find((b) => b.textContent?.startsWith("Settings"))!);
    const dialog = $(".dialog[open]");
    const [name] = $$(".settings-fields input", dialog) as HTMLInputElement[];
    expect(name.value).toBe("Mario Rossi");
    expect(dialog.textContent).toContain("@mariorossi");
    expect((button("Save", dialog) as HTMLButtonElement).disabled).toBe(true); // nothing changed

    await type(name, " ");
    expect((button("Save", dialog) as HTMLButtonElement).disabled).toBe(true);
    await type(name, "Giulia Verdi");
    await click(button("Save", dialog));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ name: "Giulia Verdi", username: "mariorossi" });
    expect($(".topbar .avatar").textContent).toBe("GV");
  });
});
