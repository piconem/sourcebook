// @vitest-environment jsdom
import type { McpSettingsView } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "../components/TopBar";
import { AppearanceProvider } from "../theme/AppearanceContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPO = "/home/me/University&Research/sourcebook";
let settings: McpSettingsView;
const puts: unknown[] = [];
const copied: string[] = [];

beforeEach(() => {
  puts.length = 0;
  copied.length = 0;
  settings = {
    http: { enabled: true },
    stdio: { enabled: true },
    readOnly: false,
    connection: {
      http: { url: "http://127.0.0.1:4000/mcp" },
      stdio: { command: "pnpm", args: ["--silent", "--dir", REPO, "--filter", "@sourcebook/mcp", "exec", "tsx", "src/stdio.ts"], cwd: REPO, env: {} },
    },
  };
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { "content-type": "application/json" } });
    if (url === "/api/user") return json({ name: "Mario Rossi", username: "mariorossi" });
    if (url === "/api/settings/mcp") {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        settings = { ...settings, ...body };
      }
      return json(settings);
    }
    return new Response("{}", { status: 500 });
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
  for (let i = 0; i < 60 && !check(); i++) await tick();
  expect(check()).toBe(true);
};
const $ = (sel: string, scope: ParentNode = document) => scope.querySelector(sel) as HTMLElement;
const $$ = (sel: string, scope: ParentNode = document) => [...scope.querySelectorAll(sel)] as HTMLElement[];
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await tick();
};
const field = (label: string) => $$(".copy-field").find((f) => $(".copy-field-head span", f).textContent === label);
const fieldValue = (label: string) => $(".copy-value", field(label)!).textContent;
const toggle = (label: string) => $$(".toggle-row").find((r) => $("strong", r).textContent === label)!.querySelector("input") as HTMLInputElement;

async function openMcpTab() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <AppearanceProvider>
        <QueryClientProvider client={qc}>
          <TopBar onScrollModeChange={() => {}} />
        </QueryClientProvider>
      </AppearanceProvider>,
    ),
  );
  await until(() => !!$(".topbar .avatar:not(.placeholder)"));
  await click($("[aria-label='User settings']"));
  await click($$("[role=tab]").find((t) => t.textContent === "AI assistant (MCP)")!);
  await until(() => !!$(".mcp-settings"));
}

describe("Settings → AI assistant (MCP)", () => {
  it("shows the parameters for each enabled transport", async () => {
    await openMcpTab();
    expect(toggle("HTTP").checked).toBe(true);
    expect(toggle("stdio").checked).toBe(true);
    expect(fieldValue("Server URL")).toBe("http://127.0.0.1:4000/mcp");
    expect(fieldValue("Claude Code")).toBe("claude mcp add --transport http sourcebook http://127.0.0.1:4000/mcp");
    expect(fieldValue("Command")).toBe("pnpm");
    expect(fieldValue("Working directory")).toBe(REPO);
    const stdioCommand = $$(".copy-field").filter((f) => $(".copy-field-head span", f).textContent === "Claude Code")[1];
    expect($(".copy-value", stdioCommand).textContent).toBe(
      `claude mcp add sourcebook -- pnpm --silent --dir '${REPO}' --filter @sourcebook/mcp exec tsx src/stdio.ts`,
    );
    expect(JSON.parse(fieldValue("Claude Desktop (claude_desktop_config.json)")!).mcpServers.sourcebook.args[2]).toBe(REPO);
  });

  it("toggles transports and read-only access immediately", async () => {
    await openMcpTab();
    await click(toggle("HTTP"));
    expect(puts).toEqual([{ http: { enabled: false } }]);
    await until(() => !field("Server URL"));
    expect($(".mcp-off").textContent).toContain("requests to http://127.0.0.1:4000/mcp are refused");

    await click(toggle("stdio"));
    await click(toggle("Read-only access"));
    expect(puts).toEqual([{ http: { enabled: false } }, { stdio: { enabled: false } }, { readOnly: true }]);
    expect(toggle("Read-only access").checked).toBe(true);
    expect($$(".mcp-off")).toHaveLength(2);
  });

  it("copies a value", async () => {
    await openMcpTab();
    await click($("[aria-label='Copy Server URL']"));
    expect(copied).toEqual(["http://127.0.0.1:4000/mcp"]);
    expect($("[aria-label='Copy Server URL']").textContent).toBe("Copied ✓");
  });
});
