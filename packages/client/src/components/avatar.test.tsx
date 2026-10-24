// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Avatar } from "./Avatar";
import { AvatarPicker } from "./AvatarPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let avatars: Record<string, number>;
let calls: { method: string; url: string; body?: { image?: string } }[];
let drawn: unknown[][];
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  avatars = { mario: 111 };
  calls = [];
  drawn = [];
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  URL.createObjectURL = vi.fn(() => "blob:picture");
  URL.revokeObjectURL = vi.fn();
  // jsdom loads no images and has no canvas: a 400×200 image, a recording 2D context.
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 400;
      naturalHeight = 200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      get src() {
        return this._src;
      }
      set src(v: string) {
        this._src = v;
        setTimeout(() => this.onload?.());
      }
    },
  );
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: (...args: unknown[]) => drawn.push(args) })) as never;
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,UElD";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { "content-type": "application/json" } });
    if (url === "/api/avatars" && method === "GET") return json({ avatars });
    if (url.startsWith("/api/avatars/") && method === "PUT") return json({ avatars: (avatars = { ...avatars, [url.split("/").pop()!]: 222 }) });
    if (url.startsWith("/api/avatars/") && method === "DELETE") {
      const { [url.split("/").pop()!]: _, ...rest } = avatars;
      return json({ avatars: (avatars = rest) });
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
const until = async (ok: () => unknown) => {
  for (let i = 0; i < 50 && !ok(); i++) await tick();
};
const click = async (el: Element) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await tick();
};

async function render(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>));
}

describe("pictures", () => {
  it("shows the picture in the circle, or the initials without one", async () => {
    await render(
      <>
        <Avatar name="Mario Rossi" username="mario" />
        <Avatar name="Luca Bianchi" username="luca" />
      </>,
    );
    await until(() => $(".avatar img"));
    expect($(".avatar img").getAttribute("src")).toBe("/api/avatars/mario?v=111");
    expect(document.querySelectorAll(".avatar")[1].textContent).toBe("LB");
  });

  it("crops a chosen image to a square and uploads it; removes it", async () => {
    await render(<AvatarPicker id="mario" name="Mario Rossi" />);
    await until(() => $(".avatar img"));
    const input = $("input[type=file]") as HTMLInputElement;
    const file = new File(["x"], "me.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
    await until(() => $(".avatar-crop-area img"));
    // A 400×200 image covers the 260 px square at zoom 1: 520×260, centred.
    const img = $(".avatar-crop-area img");
    expect([img.style.width, img.style.height, img.style.transform]).toEqual(["520px", "260px", "translate(-130px, 0px)"]);

    await click([...document.querySelectorAll(".dialog[open] button")].find((b) => b.textContent === "Save picture")!);
    const put = calls.find((c) => c.method === "PUT");
    expect(put).toEqual({ method: "PUT", url: "/api/avatars/mario", body: { image: "data:image/png;base64,UElD" } });
    expect(drawn[0].slice(1).map((n) => Math.round(n as number))).toEqual([-128, 0, 512, 256]); // into the 256 px square
    await until(() => $(".avatar img")?.getAttribute("src")?.endsWith("v=222"));
    expect($(".avatar img").getAttribute("src")).toBe("/api/avatars/mario?v=222");

    await click([...document.querySelectorAll("button")].find((b) => b.textContent === "Remove picture")!);
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/avatars/mario")).toBe(true);
    await until(() => !$(".avatar img"));
    expect($(".avatar").textContent).toBe("MR");
  });
});
