// @vitest-environment jsdom
import type { NotebookKind, ProjectSummary } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AppearanceProvider } from "../theme/AppearanceContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const summary = (kind: NotebookKind, id: string, name: string, sections: number, updatedAt: string, extra: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id, kind, name, description: "", createdAt: "2026-09-01T10:00:00Z", updatedAt, sections, ...extra,
});
let db: Record<NotebookKind, ProjectSummary[]>;
const calls: { method: string; url: string; body?: any }[] = [];

beforeEach(() => {
  window.location.hash = "#/projects";
  calls.length = 0;
  db = {
    projects: [
      summary("projects", "payments", "Payments", 4, "2026-09-20T10:00:00Z", { description: "Payment service design" }),
      summary("projects", "search", "Search", 2, "2026-09-25T10:00:00Z"),
    ],
    templates: [summary("templates", "design-doc", "Design doc", 5, "2026-09-10T10:00:00Z")],
  };
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (d: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/user") return json({ name: "Mario Rossi", username: "mariorossi" });
    if (url.startsWith("/api/templates/import")) {
      const q = new URL(url, "http://x").searchParams;
      const file = (init!.body as FormData).get("file") as File;
      if (file.name === "broken.zip")
        return json({ error: "Invalid template archive", details: { errors: ["notebook.json not found: this does not look like a Sourcebook template.", "Unsafe path \"../evil.sh\": contains '..'."], warnings: [] } }, 400);
      if (q.get("dryRun")) return json({ valid: true, name: "Imported Design", description: "", sections: 7, subBlocks: 12, references: 2, warnings: ["Comments are not imported."] });
      const t = summary("templates", "imported-v2", q.get("name") ?? "?", 7, new Date().toISOString());
      db.templates.push(t);
      return json({ ...t, warnings: [] }, 201);
    }
    if (url.endsWith("/archive.zip"))
      return new Response(new Blob(["PK"]), { headers: { "content-type": "application/zip", "content-disposition": "attachment; filename*=UTF-8''design-doc.sourcebook-template.zip" } });
    const m = /^\/api\/(projects|templates)(?:\/([\w-]+))?(\/.*)?$/.exec(url);
    if (!m) return json({ error: url }, 500);
    const kind = m[1] as NotebookKind;
    const list = db[kind];
    if (m[3] === "/notebook") return json({ name: list.find((p) => p.id === m[2])?.name, blocks: [] });
    if (m[3] === "/references") return json({ name: "references", path: "", kind: "dir", children: [] });
    if (!m[2]) {
      if (method === "GET") return json(list);
      const created = summary(kind, body.name.toLowerCase().replace(/\W+/g, "-"), body.name, body.from ? 5 : 0, new Date().toISOString(),
        body.from ? { createdFrom: { kind: body.from.kind, id: body.from.id, name: "Design doc" } } : {});
      list.push(created);
      return json(created, 201);
    }
    const i = list.findIndex((p) => p.id === m[2]);
    if (method === "PATCH") return json((list[i] = { ...list[i], ...body }));
    if (method === "DELETE") return list.splice(i, 1), json(null, 204);
    return json(list[i]);
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
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await tick();
  expect(check()).toBe(true);
};
const $ = (sel: string, scope: ParentNode = document) => scope.querySelector(sel) as HTMLElement;
const $$ = (sel: string, scope: ParentNode = document) => [...scope.querySelectorAll(sel)] as HTMLElement[];
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await tick();
};
const button = (label: string, scope: ParentNode = document) =>
  $$("button", scope).find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label)!;
const setValue = async (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) =>
  act(async () => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
const names = () => $$(".notebook-name a").map((a) => a.textContent);

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
  await until(() => names().length > 0);
}

describe("home: projects and templates", () => {
  it("lists projects (most recent first), switches to templates, and sorts by name", async () => {
    await render();
    expect($("h1").textContent).toBe("Projects");
    expect(names()).toEqual(["Search", "Payments"]);
    expect($$(".home-nav .nav-count").map((c) => c.textContent)).toEqual(["2", "1"]);

    await click($$("th button").find((b) => b.textContent?.startsWith("Name"))!);
    expect(names()).toEqual(["Payments", "Search"]);

    await act(async () => {
      window.location.hash = "#/templates";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await until(() => names()[0] === "Design doc");
    expect($("h1").textContent).toBe("Templates");
  });

  it("creates a project from a template and opens it", async () => {
    await render();
    await click(button("＋ New project"));
    const dialog = $(".dialog[open]");
    await setValue($("input", dialog) as HTMLInputElement, "Checkout");
    await until(() => $$("option", dialog).some((o) => o.textContent?.startsWith("Design doc")));
    await setValue($("select", dialog) as HTMLSelectElement, "templates/design-doc");
    expect(dialog.textContent).toContain("comments are not");
    await click(button("Create", dialog));

    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "Checkout", description: "", from: { kind: "templates", id: "design-doc" },
    });
    await until(() => window.location.hash === "#/projects/checkout");
    await until(() => $(".topbar-crumb-current")?.textContent === "Checkout");
    expect($(".sidebar-head h1").textContent).toBe("Checkout");
  });

  it("renames, saves as template and deletes from the actions menu", async () => {
    await render();
    await click(button("Actions for Payments"));
    await click(button("Rename / edit…", $(".context-menu")));
    const edit = $(".dialog[open]");
    await setValue($("input", edit) as HTMLInputElement, "Payments v2");
    await click(button("Save", edit));
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/api/projects/payments", body: { name: "Payments v2", description: "Payment service design" } });
    await until(() => names().includes("Payments v2"));

    await click(button("Actions for Payments v2"));
    await click(button("Save as template…", $(".context-menu")));
    const tpl = $(".dialog[open]");
    expect(($("input", tpl) as HTMLInputElement).value).toBe("Payments v2 template");
    await click(button("Create", tpl));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/templates", body: { from: { kind: "projects", id: "payments" } } });
    await until(() => !!$(".notice"));
    expect($(".notice").textContent).toContain("Template “Payments v2 template” created");
    expect(window.location.hash).toBe("#/projects"); // stays on the projects list

    await click(button("Actions for Search"));
    await click(button("Delete…", $(".context-menu")));
    const del = $(".dialog[open]");
    expect(del.textContent).toContain("projects/search");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await click(button("Delete project", del));
    expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/api/projects/search");
    await until(() => !names().includes("Search"));
  });
});

describe("template archives", () => {
  const chooseFile = async (name: string) => {
    const input = $("input[type=file][accept*=zip]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["PK"], name, { type: "application/zip" })], configurable: true });
    await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
    await tick();
  };
  const goTemplates = async () => {
    await act(async () => {
      window.location.hash = "#/templates";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await until(() => names()[0] === "Design doc");
  };

  it("previews a valid archive, lets the user rename it, then imports", async () => {
    await render();
    await goTemplates();
    await chooseFile("design.zip");
    const dialog = $(".dialog[open]");
    await until(() => !!$(".import-ok", dialog));
    expect(calls.find((c) => c.url.startsWith("/api/templates/import"))?.url).toBe("/api/templates/import?dryRun=1");
    expect($(".import-summary", dialog).textContent).toBe("7 sections12 sub-blocks2 reference files");
    expect($(".import-warnings", dialog).textContent).toContain("Comments are not imported.");
    const nameInput = $("input", dialog) as HTMLInputElement;
    expect(nameInput.value).toBe("Imported Design");
    await setValue(nameInput, "Imported Design v2");
    await click(button("Import", dialog));
    expect(calls.filter((c) => c.url.startsWith("/api/templates/import")).map((c) => c.url)).toEqual([
      "/api/templates/import?dryRun=1",
      "/api/templates/import?name=Imported+Design+v2",
    ]);
    await until(() => names().includes("Imported Design v2"));
    expect($(".notice").textContent).toContain("Template “Imported Design v2” imported.");
  });

  it("shows every problem of an invalid archive and does not import", async () => {
    await render();
    await goTemplates();
    await chooseFile("broken.zip");
    const dialog = $(".dialog[open]");
    await until(() => !!$(".import-errors", dialog));
    expect($$(".import-errors li", dialog).map((li) => li.textContent)).toEqual([
      "notebook.json not found: this does not look like a Sourcebook template.",
      'Unsafe path "../evil.sh": contains \'..\'.',
    ]);
    expect(dialog.textContent).toContain("2 problems found");
    expect(button("Import", dialog)).toBeUndefined();
    expect(calls.filter((c) => c.url.startsWith("/api/templates/import"))).toHaveLength(1);
  });

  it("exports a template as ZIP from the actions menu", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click_ = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await render();
    await goTemplates();
    await click(button("Actions for Design doc"));
    await click(button("Export as ZIP", $(".context-menu")));
    expect(calls.some((c) => c.url === "/api/templates/design-doc/archive.zip")).toBe(true);
    expect(click_).toHaveBeenCalled();
    await until(() => !!$(".notice"));
    expect($(".notice").textContent).toContain("design-doc.sourcebook-template.zip");
    click_.mockRestore();
  });
});
