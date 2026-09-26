// @vitest-environment jsdom
import type { ReferenceNode } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferencesBrowser } from "./ReferencesBrowser";
import { ReferencesProvider } from "./ReferencesContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = (path: string, size = 10): ReferenceNode => ({ name: path.split("/").pop()!, path, kind: "file", size, modified: "2026-09-01T10:00:00Z" });
let tree: ReferenceNode;
const calls: { method: string; url: string; body?: unknown }[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  tree = {
    name: "references", path: "", kind: "dir",
    children: [
      { name: "papers", path: "papers", kind: "dir", children: [file("papers/a.pdf"), file("papers/data.csv")] },
      file("notes.md"),
      file("report.docx"),
    ],
  };
  URL.createObjectURL = vi.fn(() => "blob:zip");
  URL.revokeObjectURL = vi.fn();
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    url = url.replace(/^\/api\/(?:projects|templates)\/[^/?]+(?=[/?]|$)/, "/api").replace(/^\/api\/notebook$/, "/api/project");
    const method = init?.method ?? "GET";
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (data: unknown, status = 200) => new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/references") return json(tree);
    if (url === "/api/references/rename") return json({ path: `papers/${body.newName}` });
    if (url === "/api/references/folders") return json({ path: body.path }, 201);
    if (url === "/api/references/delete") return json({ deleted: body.paths });
    if (url === "/api/references/zip")
      return new Response(new Blob(["PK"]), { headers: { "content-type": "application/zip", "content-disposition": "attachment; filename*=UTF-8''papers.zip" } });
    return json({ error: "unexpected" }, 500);
  }));
});

let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ReferencesProvider>
          <ReferencesBrowser />
        </ReferencesProvider>
      </QueryClientProvider>,
    );
  });
  // Wait for the (mocked) tree request to resolve and render.
  for (let i = 0; i < 50 && !document.querySelector(".ref-card, .ref-list"); i++) {
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
  }
}

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const cardNames = () => [...document.querySelectorAll(".ref-card-name")].map((e) => e.textContent);
const card = (name: string) => [...document.querySelectorAll(".ref-card")].find((c) => c.querySelector(".ref-card-name")?.textContent === name) as HTMLElement;
const button = (label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const fire = async (el: Element, type: string, init: object = {}) =>
  act(async () => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init })));
const key = async (el: Element, k: string) =>
  act(async () => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
const type = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("ReferencesBrowser", () => {
  it("lists folders first, navigates with double-click, breadcrumbs and Backspace", async () => {
    await render();
    expect(cardNames()).toEqual(["papers", "notes.md", "report.docx"]);
    expect(card("report.docx").textContent).toContain("download only");

    await fire(card("papers"), "dblclick");
    expect(cardNames()).toEqual(["a.pdf", "data.csv"]);
    expect($(".crumb.current").textContent).toBe("papers");
    expect(localStorage.getItem("sourcebook.references.dir")).toBe("papers");

    await key($(".ref-browser"), "Backspace");
    expect(cardNames()).toEqual(["papers", "notes.md", "report.docx"]);
  });

  it("selects an item and renames it from the selection bar", async () => {
    localStorage.setItem("sourcebook.references.dir", "papers");
    await render();
    await fire(card("a.pdf"), "click");
    expect($(".ref-selection-name").textContent).toContain("a.pdf");

    await fire(button("Rename", $(".ref-selection-bar")), "click");
    const input = $(".dialog[open] input") as HTMLInputElement;
    expect(input.value).toBe("a.pdf");
    await type(input, "spec.pdf");
    await fire(button("Rename", $(".dialog[open]")), "click");
    expect(calls.find((c) => c.url === "/api/references/rename")?.body).toEqual({ path: "papers/a.pdf", newName: "spec.pdf" });
  });

  it("creates folders, and deletes via the context menu after confirmation", async () => {
    await render();
    await fire(button("＋ New folder"), "click");
    await type($(".dialog[open] input") as HTMLInputElement, "datasets");
    await fire(button("Create", $(".dialog[open]")), "click");
    expect(calls.find((c) => c.url === "/api/references/folders")?.body).toEqual({ path: "datasets" });

    await fire(card("papers"), "contextmenu", { clientX: 50, clientY: 60 });
    await fire(button("Delete…", $(".context-menu")), "click");
    expect($(".dialog[open]").textContent).toContain("the 2 files it contains");
    expect(calls.some((c) => c.url === "/api/references/delete")).toBe(false);
    await fire(button("Delete", $(".dialog[open]")), "click");
    expect(calls.find((c) => c.url === "/api/references/delete")?.body).toEqual({ paths: ["papers"] });
  });

  it("switches to the list layout and searches across folders", async () => {
    await render();
    await fire(button("☰"), "click");
    expect([...document.querySelectorAll(".ref-list-name")].map((e) => e.textContent?.trim())).toEqual([
      "📁 papers", "📝 notes.md", "📦 report.docx",
    ]);
    await type($(".ref-search") as HTMLInputElement, "csv");
    expect([...document.querySelectorAll(".ref-list-name")].map((e) => e.textContent?.trim())).toEqual(["📊 data.csv — papers/"]);
  });
});

describe("ReferencesBrowser multiple selection", () => {
  const selectedNames = () => [...document.querySelectorAll(".ref-card.selected .ref-card-name")].map((e) => e.textContent);

  it("Ctrl/⌘-click and Shift-click build a selection; Download ZIP sends it", async () => {
    await render();
    await fire(card("papers"), "click");
    await fire(card("report.docx"), "click", { ctrlKey: true });
    expect(selectedNames()).toEqual(["papers", "report.docx"]);
    expect($(".ref-selection-name").textContent).toBe("2 selected");

    await fire(card("report.docx"), "click", { metaKey: true }); // toggle off
    expect(selectedNames()).toEqual(["papers"]);

    // Like file managers, the range starts at the last plain or Ctrl/⌘-clicked item.
    await fire(card("papers"), "click");
    await fire(card("report.docx"), "click", { shiftKey: true }); // range papers..report.docx
    expect(selectedNames()).toEqual(["papers", "notes.md", "report.docx"]);

    await fire(button("Download ZIP"), "click");
    expect(calls.find((c) => c.url === "/api/references/zip")?.body).toEqual({
      paths: ["papers", "notes.md", "report.docx"],
      base: "",
    });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("a single file downloads directly, without a ZIP", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await render();
    await fire(card("notes.md"), "click");
    await fire(button("Download", $(".ref-selection-bar")), "click");
    expect(calls.some((c) => c.url === "/api/references/zip")).toBe(false);
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("Ctrl/⌘+A then Delete asks once for everything, then deletes in one request", async () => {
    await render();
    await key($(".ref-browser"), "a"); // plain "a" does nothing
    expect(selectedNames()).toEqual([]);
    await act(async () => void $(".ref-browser").dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true })));
    expect(selectedNames()).toEqual(["papers", "notes.md", "report.docx"]);

    await key($(".ref-browser"), "Delete");
    const dialog = $(".dialog[open]");
    expect(dialog.querySelector("h2")?.textContent).toBe("Delete 3 items?");
    expect(dialog.textContent).toContain("4 files in total");
    await fire(button("Delete", dialog), "click");
    expect(calls.find((c) => c.url === "/api/references/delete")?.body).toEqual({ paths: ["papers", "notes.md", "report.docx"] });
  });

  it("checkboxes toggle items; the context menu acts on the whole selection", async () => {
    await render();
    const check = (name: string) => card(name).querySelector(".ref-check") as HTMLInputElement;
    await fire(check("notes.md"), "click");
    await fire(check("report.docx"), "click");
    expect(selectedNames()).toEqual(["notes.md", "report.docx"]);

    await fire(card("report.docx"), "contextmenu", { clientX: 10, clientY: 10 });
    expect($(".context-menu").textContent).toContain("2 selected");
    await fire(button("Delete 2 items…", $(".context-menu")), "click");
    expect($(".dialog[open] h2").textContent).toBe("Delete 2 items?");

    await key($(".dialog[open]"), "Escape");
    await fire(card("papers"), "contextmenu", { clientX: 10, clientY: 10 }); // unselected item: acts on it alone
    expect(selectedNames()).toEqual(["papers"]);
    expect(button("Download as ZIP", $(".context-menu"))).toBeTruthy();
  });
});
