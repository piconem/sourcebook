// @vitest-environment jsdom
import type { Block, Notification, Project, ProjectCommentThread } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AppearanceProvider } from "../theme/AppearanceContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sub = (id: string, order: number) => ({
  id, type: "equation", order, source: `0${order}-equation.tex`, exports: [], props: {}, content: { latex: "x" }, commentCount: 0, rev: 0,
});
const project: Project = {
  name: "demo",
  blocks: [
    { id: "a", title: "Introduction", parentId: null, order: 1, folder: "001-introduction", subBlocks: [sub("s1", 1)] },
    { id: "c", title: "Design", parentId: null, order: 2, folder: "002-design", subBlocks: [sub("s2", 1), sub("s3", 2)] },
  ],
};
const block = (id: string): Block => {
  const e = project.blocks.find((b) => b.id === id)!;
  return { id, title: e.title, parentId: e.parentId, order: e.order, folder: e.folder, subBlocks: e.subBlocks as Block["subBlocks"] };
};
const author = { name: "Claude", username: "claude", kind: "assistant" as const };
let notifications: Notification[];
let threads: ProjectCommentThread[];
let calls: string[];

let root: Root;
let host: HTMLDivElement;
const scrolled: string[] = [];

beforeEach(() => {
  localStorage.clear();
  scrolled.length = 0;
  calls = [];
  notifications = [
    {
      id: "n2", createdAt: new Date().toISOString(), author, summary: "Rewrote the design", read: false,
      targets: [{ blockId: "c", subBlockId: "s3", label: "§2#2 Equation", note: "new formula" }, { blockId: "gone", label: "§9 Old" }],
    },
    { id: "n1", createdAt: new Date().toISOString(), author, summary: "Earlier change", read: true, targets: [{ blockId: "a", label: "§1 Introduction" }] },
  ];
  threads = [
    { blockId: "c", sectionTitle: "Design", subBlockId: "s2", subBlockIndex: 1, subBlockType: "equation", comment: { id: "k1", author, createdAt: new Date().toISOString(), text: "Check the sign", replies: [] } },
    { blockId: "c", sectionTitle: "Design", subBlockId: "s3", subBlockIndex: 2, subBlockType: "equation", comment: { id: "k2", author, createdAt: new Date().toISOString(), text: "Done", replies: [], resolution: { by: author, at: new Date().toISOString() } } },
  ];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
  Element.prototype.scrollTo = () => {};
  Element.prototype.scrollBy = () => {};
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    url = url.replace(/^\/api\/(?:projects|templates)\/[^/?]+(?=[/?]|$)/, "/api").replace(/^\/api\/notebook$/, "/api/project");
    const method = init?.method ?? "GET";
    if (method !== "GET") calls.push(`${method} ${url}`);
    const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { "content-type": "application/json" } });
    if (url === "/api/project") return json(project);
    if (url === "/api") return json({ id: "demo", kind: "projects", name: "Demo project", description: "", createdAt: "", updatedAt: "", sections: 2 });
    if (url === "/api/user") return json({ name: "Mario Rossi", username: "mariorossi" });
    if (url === "/api/references") return json({ name: "references", path: "", kind: "dir", children: [] });
    if (url === "/api/comments") return json({ threads });
    if (url === "/api/notifications" && method === "GET") return json({ notifications });
    if (url === "/api/notifications" && method === "DELETE") return (notifications = []), new Response(null, { status: 204 });
    const read = /^\/api\/notifications\/(\w+)\/read$/.exec(url);
    if (read) return json({ notifications: (notifications = notifications.map((n) => (n.id === read[1] ? { ...n, read: true } : n))) });
    if (url === "/api/notifications/read-all") return json({ notifications: (notifications = notifications.map((n) => ({ ...n, read: true }))) });
    if (/\/comments$/.test(url)) return json({ comments: threads.filter((t) => url.includes(t.subBlockId)).map((t) => t.comment) });
    if (/\/subblocks\/\w+\?deleteAssets/.test(url)) return json({ deletedAssets: [], keptAssets: [] });
    const m = /^\/api\/blocks\/(\w+)$/.exec(url);
    if (m) return json(block(m[1]));
    return new Response(JSON.stringify({ error: url }), { status: 500 });
  }));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const tick = (ms = 10) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await tick();
};
const titles = () => $$(".block-title").map((i) => (i as HTMLInputElement).value);
const until = async (ok: () => unknown) => {
  for (let i = 0; i < 50 && !ok(); i++) await tick();
};

async function render(hash = "#/projects/demo") {
  window.location.hash = hash;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <AppearanceProvider>
        <QueryClientProvider client={qc}>
          <App />
        </QueryClientProvider>
      </AppearanceProvider>,
    ),
  );
  await until(() => $(".block-title"));
}

describe("deep links", () => {
  it("opens the section and sub-block named by the URL, and records outline navigation", async () => {
    await render("#/projects/demo/s/c/b/s3");
    await until(() => titles()[0] === "Design");
    expect(titles()).toEqual(["Design"]);
    await until(() => scrolled.includes("subblock-s3"));
    expect(scrolled).toContain("subblock-s3");

    const row = $$(".tree-row").find((r) => r.textContent?.includes("Introduction"))!;
    await click(row);
    expect(window.location.hash).toBe("#/projects/demo/s/a");
    await until(() => titles()[0] === "Introduction");
  });
});

describe("notifications menu", () => {
  it("counts unread notifications, links to the parts involved and marks them read", async () => {
    await render();
    await until(() => $(".topbar-badge"));
    const bell = $("[aria-label=Notifications]");
    expect(bell.querySelector(".topbar-badge")?.textContent).toBe("1");
    await click(bell);
    const items = $$(".notif-item");
    expect(items.map((i) => i.querySelector(".notif-summary")?.textContent)).toEqual(["Rewrote the design", "Earlier change"]);
    expect(items[1].classList.contains("read")).toBe(true);
    // Live labels, and stored label for a deleted section.
    expect(items[0].querySelector(".notif-targets")?.textContent).toContain("§2#2 Equation — new formula");
    expect(items[0].querySelector(".notif-targets")?.textContent).toContain("§9 Old (deleted)");

    await click([...items[0].querySelectorAll(".notif-targets button")][0]);
    expect(calls).toContain("POST /api/notifications/n2/read");
    expect(window.location.hash).toBe("#/projects/demo/s/c/b/s3");
    await until(() => titles()[0] === "Design");
    expect($("[role=menu]")).toBeNull();
    await until(() => !$("[aria-label=Notifications] .topbar-badge"));
    expect($("[aria-label=Notifications] .topbar-badge")).toBeNull();
  });

  it("clears the list after confirmation", async () => {
    await render();
    await until(() => $(".topbar-badge"));
    await click($("[aria-label=Notifications]"));
    await click($$(".notif-menu-head button").find((b) => b.textContent === "Clear")!);
    expect(calls).not.toContain("DELETE /api/notifications");
    await click($$(".notif-menu-head button").find((b) => b.textContent === "Clear all")!);
    expect(calls).toContain("DELETE /api/notifications");
    expect($(".notif-empty")).not.toBeNull();
  });
});

describe("all comments", () => {
  it("lists open threads by section and goes to a thread", async () => {
    await render();
    await until(() => $("[aria-label='All comments'] .topbar-badge"));
    expect($("[aria-label='All comments'] .topbar-badge").textContent).toBe("1");
    await click($("[aria-label='All comments']"));
    expect($$(".allc-item .allc-text").map((e) => e.textContent)).toEqual(["Check the sign"]);
    expect($(".allc-section").textContent).toBe("§2 Design");
    await click($$(".seg button")[2]);
    expect($$(".allc-item .allc-text").map((e) => e.textContent)).toEqual(["Check the sign", "Done"]);
    await click($$(".allc-item")[0]);
    expect(window.location.hash).toBe("#/projects/demo/s/c/b/s2/c/k1");
    await until(() => $(".comments-panel"));
    expect($(".comments-panel")).not.toBeNull();
  });
});

describe("deleting a sub-block", () => {
  it("always asks for confirmation", async () => {
    await render();
    await click($("[title='Delete sub-block']"));
    expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false);
    const dialog = $("dialog[open]");
    expect(dialog.textContent).toContain("Delete §1#1 (Equation)");
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Delete")!);
    expect(calls).toContain("DELETE /api/blocks/a/subblocks/s1?deleteAssets=false");
  });
});
