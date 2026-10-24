// @vitest-environment jsdom
import type { Block, Project } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AppearanceProvider } from "../theme/AppearanceContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project: Project = {
  name: "demo",
  blocks: [
    { id: "a", title: "Introduction", parentId: null, order: 1, folder: "001-introduction", subBlocks: [] },
    { id: "b", title: "Goals", parentId: "a", order: 2, folder: "002-goals", subBlocks: [] },
    { id: "c", title: "Design", parentId: null, order: 3, folder: "003-design", subBlocks: [] },
  ],
};
const block = (id: string): Block => {
  const e = project.blocks.find((b) => b.id === id)!;
  return { id, title: e.title, parentId: e.parentId, order: e.order, folder: e.folder, subBlocks: [] };
};

let root: Root;
let host: HTMLDivElement;
const scrolled: string[] = [];

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "#/projects/demo";
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
  Element.prototype.scrollTo = () => {};
  Element.prototype.scrollBy = () => {};
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    url = url.replace(/^\/api\/(?:projects|templates)\/[^/?]+(?=[/?]|$)/, "/api").replace(/^\/api\/notebook$/, "/api/project");
    const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { "content-type": "application/json" } });
    if (url === "/api/project") return json(project);
    if (url === "/api") return json({ id: "demo", kind: "projects", name: "Demo project", description: "", createdAt: "", updatedAt: "", sections: 3 });
    if (url === "/api/user") return json({ name: "Mario Rossi", username: "mariorossi" });
    if (url === "/api/references") return json({ name: "references", path: "", kind: "dir", children: [] });
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

const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await tick();
};
const titles = () => $$(".block-title").map((i) => (i as HTMLInputElement).value);

async function render() {
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
  for (let i = 0; i < 50 && !$(".block-title"); i++) await tick();
}

describe("top bar and scrolling mode", () => {
  it("has comments, notifications, scrolling, appearance and profile buttons on the right, in this order", async () => {
    await render();
    for (let i = 0; i < 20 && !$("[aria-label=Notifications]"); i++) await tick();
    expect($$(".topbar-actions button[aria-label]").map((e) => e.getAttribute("aria-label"))).toEqual([
      "All comments",
      "Notifications",
      "Scrolling mode",
      "Appearance",
      "User menu",
    ]);
    expect($(".sidebar-head [aria-label=Appearance]")).toBeNull();
    // Breadcrumb back to the projects list
    for (let i = 0; i < 20 && !$(".topbar-crumb-current")?.textContent?.includes("Demo"); i++) await tick();
    expect($(".topbar-crumbs").textContent).toContain("Projects");
    expect($(".topbar-crumb-current").textContent).toBe("Demo project");
  });

  it("switches between one section and the whole document, and remembers the choice", async () => {
    await render();
    expect(titles()).toEqual(["Introduction"]);
    expect($(".block-number").textContent).toBe("1");

    await click($("[aria-label='Scrolling mode']"));
    const items = $$("[role=menuitemradio]");
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    await click(items[1]);
    for (let i = 0; i < 20 && titles().length < 3; i++) await tick();
    expect(titles()).toEqual(["Introduction", "Goals", "Design"]);
    expect($$(".block-number").map((n) => n.textContent)).toEqual(["1", "1.1", "2"]);
    expect(localStorage.getItem("sourcebook.scrollMode")).toBe("document");
    expect($("[role=menu]")).toBeNull(); // menu closed after choosing

    // Selecting in the outline scrolls to the section.
    const row = $$(".tree-row").find((r) => r.textContent?.includes("Design"))!;
    await click(row);
    await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
    expect(scrolled).toContain("block-c");
    expect(titles()).toHaveLength(3);

    await click($("[aria-label='Scrolling mode']"));
    await click($$("[role=menuitemradio]")[0]);
    for (let i = 0; i < 20 && titles().length !== 1; i++) await tick();
    expect(titles()).toEqual(["Design"]); // section mode shows the selected section
    expect(localStorage.getItem("sourcebook.scrollMode")).toBe("section");
  });

  it("resizes the sidebar with the keyboard and remembers the width", async () => {
    await render();
    const handle = $("[aria-label='Resize sidebar']");
    expect($(".app").style.gridTemplateColumns).toBe("280px minmax(0, 1fr)");
    await act(async () => void handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
    expect($(".app").style.gridTemplateColumns).toBe("320px minmax(0, 1fr)");
    expect(localStorage.getItem("sourcebook.sidebarWidth")).toBe("320");
    await act(async () => void handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(handle.getAttribute("aria-valuenow")).toBe("200");
    await act(async () => void handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(handle.getAttribute("aria-valuenow")).toBe("280");
  });

  it("starts in the remembered mode", async () => {
    localStorage.setItem("sourcebook.scrollMode", "document");
    await render();
    for (let i = 0; i < 20 && titles().length < 3; i++) await tick();
    expect(titles()).toEqual(["Introduction", "Goals", "Design"]);
  });
});
