// @vitest-environment jsdom
import type { AgentFootprint, AgentView } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsSection } from "./AgentsSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const writer: AgentView = { id: "writer", name: "Writer", owner: "mario", ownerName: "Mario", default: true, createdAt: "", revoked: false };
const footprint: AgentFootprint = {
  agent: "writer",
  projects: [{ kind: "projects", id: "alpha", name: "Alpha", threads: 2, replies: 1, resolutions: 1, notifications: 3, locks: 0 }],
  total: { threads: 2, replies: 1, resolutions: 1, notifications: 3, locks: 0 },
};
let agents: AgentView[];
let calls: { method: string; url: string }[];
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  agents = [writer];
  calls = [];
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { "content-type": "application/json" } });
    if (url === "/api/agents") return json({ agents });
    if (url === "/api/tokens") return json({ tokens: [] });
    if (url === "/api/avatars") return json({ avatars: {} });
    if (url === "/api/agents/writer/footprint") return json(footprint);
    if (url === "/api/agents/writer/delete") {
      agents = [];
      return json(footprint);
    }
    return new Response("{}", { status: 500 });
  }));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const tick = (ms = 10) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const until = async (ok: () => unknown) => {
  for (let i = 0; i < 50 && !ok(); i++) await tick();
};
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await tick();
};

describe("deleting an agent", () => {
  it("shows what will be removed, asks to type the id, then reports what was removed", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={new QueryClient()}><AgentsSection /></QueryClientProvider>));
    await until(() => button("Delete…"));
    await click(button("Delete…"));
    const dialog = $(".dialog[open]");
    await until(() => dialog.textContent?.includes("Will be removed"));
    expect(dialog.textContent).toContain("2 comment threads, 1 reply, 1 resolution (those threads reopen), 3 notifications");
    expect(dialog.textContent).toContain("Alpha:");
    const confirm = button("Delete permanently", dialog);
    expect(confirm.disabled).toBe(true);

    const input = dialog.querySelector("input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "writer");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/agents/writer/delete")).toBe(true);
    await until(() => $(".agent-created"));
    expect($(".agent-created").textContent).toContain("Writer was deleted.");
    expect($(".agent-created").textContent).toContain("in Alpha");
    expect($(".agent-created").textContent).toContain("“writer” is free again");
    await until(() => document.body.textContent?.includes("No agents yet."));
  });
});
