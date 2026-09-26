// @vitest-environment jsdom
import type { Block, Comment } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockView } from "../components/BlockView";
import { AskAiProvider } from "./AskAiContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
document.elementFromPoint ??= () => null;

let readOnly = false;
const copied: string[] = [];
const comments: Comment[] = [{ id: "c1", author: { name: "Anna Bianchi", username: "annab" }, createdAt: "2026-09-26T10:00:00Z", text: "Why python 2 style?", replies: [] }];
const block: Block = {
  id: "b2", title: "Implementation", parentId: null, order: 2, folder: "002-implementation",
  subBlocks: [
    { id: "code1", type: "code", order: 1, source: "01-code.py", exports: [], props: {}, rev: 0, commentCount: 1, title: "Main", content: { language: "python", code: "print 'hi'\nx = 1\n" } },
    { id: "img1", type: "image", order: 2, source: "02-image.md", exports: [], props: {}, rev: 0, commentCount: 0, content: { src: "", alt: "", caption: "" } },
  ],
};

beforeEach(() => {
  readOnly = false;
  copied.length = 0;
  localStorage.clear();
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  Element.prototype.scrollIntoView ??= () => {};
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { "content-type": "application/json" } });
    url = url.replace(/^\/api\/projects\/[^/]+/, "/api");
    if (url === "/api/blocks/b2") return json(block);
    if (url.endsWith("/comments")) return json({ comments });
    if (url === "/api/user") return json({ name: "Mario Rossi", username: "mario" });
    if (url === "/api/settings/mcp") return json({ http: { enabled: true }, stdio: { enabled: true }, readOnly, connection: {} });
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
  for (let i = 0; i < 80 && !check(); i++) await tick();
  expect(check()).toBe(true);
};
const $ = (sel: string, scope: ParentNode = document) => scope.querySelector(sel) as HTMLElement;
const $$ = (sel: string, scope: ParentNode = document) => [...scope.querySelectorAll(sel)] as HTMLElement[];
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  await tick();
};
const dialog = () => $(".dialog[open]");
const modes = () => $$(".ask-ai-mode", dialog()).map((m) => `${$("strong", m).textContent}${(m as HTMLButtonElement).disabled ? " (disabled)" : ""}`);
const prompt = () => $$(".copy-field", dialog()).find((f) => $(".copy-field-head span", f).textContent === "Prompt")!.querySelector(".copy-value")!.textContent!;
const chooseMode = (label: string) => click($$(".ask-ai-mode", dialog()).find((m) => $("strong", m).textContent === label)!);

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <AskAiProvider project={{ kind: "projects", id: "payments", name: "Payments" }}>
          <BlockView blockId="b2" number="2" onDeleted={() => {}} />
        </AskAiProvider>
      </QueryClientProvider>,
    ),
  );
  await until(() => !!$(".cm-editor"));
}

describe("Ask AI", () => {
  it("prepares a request about a section, with every mode", async () => {
    await render();
    await click($(".block-head [aria-label='Ask AI']"));
    await until(() => !!dialog());
    expect($(".ask-ai-target", dialog()).textContent).toBe('Sourcebook project "payments" · section §2 "Implementation" · id b2 · sourcebook://projects/payments/sections/b2');
    expect(modes()).toEqual(["Brainstorming", "Critique", "Build / Fill", "Improve / Rewrite", "Comment", "Custom prompt"]);
    await chooseMode("Critique");
    expect(prompt()).toContain('read_section (project "payments", section "§2" — id b2)');
    expect(prompt()).toMatch(/Critically review section §2 "Implementation"/);
    await click($$("button", dialog()).find((b) => b.textContent === "Copy prompt")!);
    expect(copied).toEqual([prompt()]);
  });

  it("offers only the modes that make sense for an image", async () => {
    await render();
    const imageFrame = $$(".subblock")[1];
    await click($("[aria-label='Ask AI']", imageFrame));
    await until(() => !!dialog());
    expect(modes()).toEqual(["Brainstorming", "Critique", "Comment", "Custom prompt"]);
    await chooseMode("Comment");
    expect(prompt()).toContain("add_comment on the whole sub-block");
  });

  it("targets the code line and lets the user write a custom request", async () => {
    await render();
    await click($$("button").find((b) => b.textContent?.includes("Ask AI about line"))!);
    await until(() => !!dialog());
    expect($(".ask-ai-target", dialog()).textContent).toContain("lines §2#1:L1 · sub-block id code1");
    await chooseMode("Custom prompt");
    const area = $("textarea", dialog()) as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "Port this line to Python 3");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(prompt()).toMatch(/Regarding lines L1 of sub-block §2#1:\nPort this line to Python 3$/);
  });

  it("disables writing modes when the assistant is read-only", async () => {
    readOnly = true;
    await render();
    await click($$(".subblock")[0].querySelector("[aria-label='Ask AI']")!);
    await until(() => modes().some((m) => m.includes("disabled")));
    expect(modes()).toEqual(["Brainstorming", "Critique", "Build / Fill (disabled)", "Improve / Rewrite (disabled)", "Comment (disabled)", "Custom prompt"]);
    expect($(".ask-ai-mode.selected strong", dialog()).textContent).toBe("Brainstorming");
  });

  it("works on comment threads", async () => {
    await render();
    await click($(".comment-toggle"));
    await until(() => !!$(".thread-ask-ai"));
    await click($(".thread-ask-ai"));
    await until(() => !!dialog());
    expect(modes()).toEqual(["Comment", "Custom prompt"]);
    expect($(".ask-ai-target", dialog()).textContent).toBe('Sourcebook project "payments" · comment c1 on §2#1 · sourcebook://projects/payments/comments/c1');
    expect(prompt()).toContain("reply_to_comment");
    expect(prompt()).toContain('by Anna Bianchi on §2#1 ("Why python 2 style?")');
  });
});
