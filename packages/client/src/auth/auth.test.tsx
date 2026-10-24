// @vitest-environment jsdom
import type { Me, Project, SubBlockLock } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AppearanceProvider } from "../theme/AppearanceContext";
import { AuthGate } from "./AuthContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const account = (over: Partial<Me["user"]> = {}): Me["user"] => ({
  username: "mario", name: "Mario Rossi", role: "member", canCreateProjects: false, disabled: false, mustChangePassword: false, createdAt: "", ...over,
});
const sub = { id: "s1", type: "equation", order: 1, source: "01-equation.tex", exports: [], props: {}, content: { latex: "x" }, commentCount: 0, rev: 0 };
const project: Project = { name: "demo", blocks: [{ id: "a", title: "Intro", parentId: null, order: 1, folder: "001-intro", subBlocks: [sub] }] };

let me: Me | null;
let access: "read" | "write";
let locks: SubBlockLock[];
let calls: { method: string; url: string; body?: unknown }[];
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  calls = [];
  me = null;
  access = "write";
  locks = [];
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    url = url.replace(/^\/api\/(?:projects|templates)\/[^/?]+(?=[/?]|$)/, "/api").replace(/^\/api\/notebook$/, "/api/project");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/auth/me") return me ? json(me) : json({ error: "Not signed in" }, 401);
    if (url === "/api/auth/login") {
      if (body.password !== "temporary-1") return json({ error: "Wrong username or password" }, 401);
      me = { user: account({ mustChangePassword: true }), author: { name: "Mario Rossi", username: "mario", kind: "user" } };
      return json(me);
    }
    if (url === "/api/auth/password") {
      me = { user: account(), author: me!.author };
      return json(me);
    }
    if (url === "/api/projects" && method === "GET") return json([]);
    if (url === "/api/templates" && method === "GET") return json([]);
    if (url === "/api/user") return json({ name: "Mario Rossi", username: "mario" });
    if (url === "/api/project") return json(project);
    if (url === "/api") return json({ id: "demo", kind: "projects", name: "Demo", description: "", createdAt: "", updatedAt: "", sections: 1, access });
    if (url === "/api/blocks/a") return json({ ...project.blocks[0] });
    if (url === "/api/locks") return json({ locks });
    if (/\/lock$/.test(url) && method === "POST") {
      locks = [{ blockId: "a", subBlockId: "s1", holder: { name: "Mario Rossi", username: "mario", kind: "user" }, since: new Date().toISOString() }];
      return json(locks[0]);
    }
    if (url === "/api/notifications") return json({ notifications: [] });
    if (url === "/api/comments") return json({ threads: [] });
    if (url === "/api/references") return json({ name: "references", path: "", kind: "dir", children: [] });
    if (url === "/api/bibliography") return json([]);
    return json({ error: url }, 500);
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
const until = async (ok: () => unknown) => {
  for (let i = 0; i < 60 && !ok(); i++) await tick();
};
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await tick();
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submit = async (form: HTMLFormElement) => {
  await act(async () => void form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await tick();
};

async function render(hash: string) {
  window.location.hash = hash;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <AppearanceProvider>
        <QueryClientProvider client={qc}>
          <AuthGate>
            <App />
          </AuthGate>
        </QueryClientProvider>
      </AppearanceProvider>,
    ),
  );
}

describe("sign-in gate", () => {
  it("signs in, forces the password change, then shows the app without creation rights", async () => {
    await render("#/projects");
    await until(() => $(".auth-form"));
    const [username, password] = $$(".auth-form input") as HTMLInputElement[];
    await type(username, "mario");
    await type(password, "wrong");
    await submit($(".auth-form") as HTMLFormElement);
    expect($(".auth-form .render-error").textContent).toBe("Wrong username or password");

    await type(password, "temporary-1");
    await submit($(".auth-form") as HTMLFormElement);
    await until(() => $(".auth-card h1")?.textContent === "Choose your password");
    const [current, next, again] = $$(".auth-form input") as HTMLInputElement[];
    await type(current, "temporary-1");
    await type(next, "short");
    expect($(".auth-form").textContent).toContain("At least 8 characters");
    await type(next, "a-long-password");
    await type(again, "a-long-password");
    await submit($(".auth-form") as HTMLFormElement);
    expect(calls.find((c) => c.url === "/api/auth/password")?.body).toEqual({ currentPassword: "temporary-1", newPassword: "a-long-password" });

    await until(() => $(".notebook-list .ref-empty-state"));
    expect($(".notebook-list").textContent).toContain("ask the owner of this Sourcebook for access");
    expect($$(".notebook-list-head button").some((b) => b.textContent?.includes("New project"))).toBe(false);
  });
});

describe("editor permissions", () => {
  beforeEach(() => {
    me = { user: account(), author: { name: "Mario Rossi", username: "mario", kind: "user" } };
  });

  it("opening a project keeps the session (no re-mount loop)", async () => {
    await render("#/projects/demo/s/a");
    await until(() => $(".subblock"));
    await tick(200);
    expect(calls.filter((c) => c.url === "/api/auth/me")).toHaveLength(1);
    expect(calls.filter((c) => c.url === "/api/project").length).toBeLessThanOrEqual(2);
  });

  it("read-only access hides editing controls and freezes sub-blocks", async () => {
    access = "read";
    await render("#/projects/demo/s/a");
    await until(() => $(".subblock"));
    await until(() => $(".app.read-only"));
    expect($(".sidebar-head").textContent).toContain("Read-only");
    expect($(".subblock").classList.contains("frozen")).toBe(true);
    expect($(".subblock-body").hasAttribute("inert")).toBe(true);
    expect($("[aria-label=Lock]")).toBeNull();
    expect(($(".block-title") as HTMLInputElement).readOnly).toBe(true);
  });

  it("shows who holds a sub-block and lets you take a free one", async () => {
    locks = [{ blockId: "a", subBlockId: "s1", holder: { name: "Writer", username: "writer", kind: "assistant", onBehalfOf: { username: "luca", name: "Luca" } }, since: new Date().toISOString() }];
    await render("#/projects/demo/s/a");
    await until(() => $(".lock-badge"));
    expect($(".lock-badge").textContent).toContain("Writer");
    expect($(".lock-badge").getAttribute("title")).toContain("agent of Luca");
    expect($(".subblock").classList.contains("frozen")).toBe(true);
    expect($(".lock-badge button")).toBeNull(); // not mine, not the owner

    locks = [];
    await act(async () => void window.dispatchEvent(new Event("focus")));
    root.unmount();
    host.remove();
    await render("#/projects/demo/s/a");
    await until(() => $("[aria-label=Lock]"));
    await click($("[aria-label=Lock]"));
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/blocks/a/subblocks/s1/lock")).toBe(true);
    await until(() => $(".lock-btn.mine"));
    expect($(".subblock").classList.contains("frozen")).toBe(false);
  });
});
