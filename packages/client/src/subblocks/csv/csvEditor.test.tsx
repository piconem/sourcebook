// @vitest-environment jsdom
import type { Comment, CsvContent, SubBlock } from "@sourcebook/shared";
import { createAnchor } from "@sourcebook/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentBridge } from "../../comments/bridge";
import { CsvEditor } from "./CsvEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CSV = "city,population,region\nRome,2750000,Lazio\nMilan,1350000,Lombardy\nNaples,910000,Campania\n";
const sub = (csv = CSV, commentCount = 0) =>
  ({ id: "s1", type: "csv", order: 1, source: "01-csv.csv", exports: [], props: {}, content: { csv, delimiter: "," }, commentCount, rev: 0 }) as SubBlock & { content: CsvContent };

let changes: CsvContent[];
let comments: Comment[];
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  changes = [];
  comments = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/comments")) return new Response(JSON.stringify({ comments }), { headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 500 });
  }));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const tick = (ms = 10) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const $ = (sel: string) => host.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => [...host.querySelectorAll(sel)] as HTMLElement[];
const button = (label: string) => $$("button").find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const click = async (el: Element, init: MouseEventInit = {}) => {
  await act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init })));
  await tick();
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const column = (c: number) => $$("tbody tr").map((tr) => (tr.querySelectorAll(".csv-cell")[c] as HTMLInputElement).value);

async function render(subBlock = sub(), bridge?: CommentBridge) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CsvEditor blockId="b1" subBlock={subBlock} onChange={(c) => changes.push(c)} saveNow={async () => {}} commentBridge={bridge} />
      </QueryClientProvider>,
    ),
  );
  await tick();
}

describe("CSV data sub-block", () => {
  it("shows a table that sorts and filters without changing the data", async () => {
    await render();
    expect($(".csv-size").textContent).toBe("3 rows × 3 columns");
    expect(column(0)).toEqual(["Rome", "Milan", "Naples"]);
    await click($$(".csv-sort")[1]); // population, ascending (numeric)
    expect(column(0)).toEqual(["Naples", "Milan", "Rome"]);
    await click($$(".csv-sort")[1]);
    expect(column(0)).toEqual(["Rome", "Milan", "Naples"]);
    await type($(".csv-table-tools input[type=search]") as HTMLInputElement, "lomb");
    expect(column(0)).toEqual(["Milan"]);
    expect(changes).toEqual([]);
  });

  it("edits cells and the header, adds and removes rows and columns", async () => {
    await render();
    await type($$("tbody .csv-cell")[1] as HTMLInputElement, "2800000");
    expect(changes.at(-1)!.csv).toBe("city,population,region\nRome,2800000,Lazio\nMilan,1350000,Lombardy\nNaples,910000,Campania\n");
    await type($$("thead .csv-cell")[0] as HTMLInputElement, "City, name");
    expect(changes.at(-1)!.csv.split("\n")[0]).toBe('"City, name",population,region');

    await click(button("＋ Row"));
    expect(changes.at(-1)!.csv.endsWith("Campania\n,,\n")).toBe(true);
    await click($$(".csv-del-row")[0]);
    expect(changes.at(-1)!.csv.split("\n")[1]).toBe("Milan,1350000,Lombardy");
    await click(button("＋ Column"));
    expect(changes.at(-1)!.csv.split("\n")[0]).toBe('"City, name",population,region,column4');
    vi.stubGlobal("confirm", () => true);
    await click($$(".csv-del")[2]); // region
    expect(changes.at(-1)!.csv.split("\n")[1]).toBe("Milan,1350000,");
  });

  it("summarizes the columns", async () => {
    await render();
    await click(button("Summary"));
    const rows = $$(".csv-summary tbody tr").map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows[1].slice(0, 7)).toEqual(["population", "number", "3", "3", "910000", "2750000", expect.stringMatching(/^1[.,]?670[.,]?000$/)]);
    expect(rows[2][1]).toBe("text");
  });

  it("imports a file, detecting its delimiter, after confirmation", async () => {
    await render();
    vi.stubGlobal("confirm", () => true);
    const input = $("input[type=file]") as HTMLInputElement;
    const file = new File(["a;b\n1;2\n"], "data.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "a;b\n1;2\n" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
    await tick();
    expect(changes.at(-1)).toEqual({ csv: "a;b\n1;2\n", delimiter: ";" });
    expect($(".csv-size").textContent).toBe("1 row × 2 columns");
    expect($(".csv-notice").textContent).toContain("Imported data.csv: 1 rows.");
  });

  it("shows comments on their rows and comments the selected row", async () => {
    comments = [
      { id: "c1", author: { name: "Writer", username: "writer" }, createdAt: "", text: "Check", replies: [], anchor: createAnchor(CSV, CSV.indexOf("Milan"), CSV.indexOf("Milan") + 5, "lines")! },
    ];
    const bridge = new CommentBridge();
    const requested: unknown[] = [];
    bridge.requestComment = (a) => requested.push(a);
    let opened = 0;
    bridge.openPanel = () => opened++;
    await render(sub(CSV, 1), bridge);
    for (let i = 0; i < 20 && !$(".csv-comments"); i++) await tick();
    const commented = $$("tbody tr").filter((tr) => tr.classList.contains("commented"));
    expect(commented.map((tr) => (tr.querySelector(".csv-cell") as HTMLInputElement).value)).toEqual(["Milan"]);
    await click($(".csv-comments"));
    expect(opened).toBe(1);
    expect(bridge.getSnapshot().activeId).toBe("c1");

    await click($$(".csv-rownum")[2]); // Naples
    await click(button("💬+ Comment row"));
    expect(requested).toEqual([expect.objectContaining({ unit: "lines", exact: "Naples,910000,Campania" })]);
    // Lines status reported to the comments column: Milan is source line 3.
    expect(bridge.getSnapshot().status.get("c1")).toEqual({ attached: true, lines: { first: 3, last: 3 } });
  });
});
