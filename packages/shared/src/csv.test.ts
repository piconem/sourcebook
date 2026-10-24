import { describe, expect, it } from "vitest";
import { compareCells, parseCsv, sniffDelimiter, stringifyCsv, summarizeColumns } from "./csv.js";
import { csvType } from "./types/csv.js";

describe("CSV", () => {
  it("parses quoted fields with delimiters, quotes and line breaks, and maps records to source lines", () => {
    const text = 'name,note\n"Rossi, Mario","He said ""hi"""\nBianchi,"two\nlines"\n';
    const { rows, spans } = parseCsv(text);
    expect(rows).toEqual([["name", "note"], ["Rossi, Mario", 'He said "hi"'], ["Bianchi", "two\nlines"]]);
    expect(spans.map((s) => [s.firstLine, s.lastLine])).toEqual([[1, 1], [2, 2], [3, 4]]);
    expect(text.slice(spans[1].from, spans[1].to)).toBe('"Rossi, Mario","He said ""hi"""');
    expect(parseCsv("a,b\r\n1,2").rows).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("").rows).toEqual([]);
  });

  it("round-trips through stringify, quoting only when needed", () => {
    const rows = [["a", "b"], ["x;y", 'q"'], ["multi\nline", " pad"]];
    expect(stringifyCsv(rows, ";")).toBe('a;b\n"x;y";"q"""\n"multi\nline";" pad"\n');
    expect(parseCsv(stringifyCsv(rows, ";"), ";").rows).toEqual(rows);
  });

  it("detects the delimiter", () => {
    expect(sniffDelimiter("a;b;c\n1;2;3\n")).toBe(";");
    expect(sniffDelimiter("a\tb\n1\t2\n")).toBe("\t");
    expect(sniffDelimiter("a,b\n1,2\n")).toBe(",");
    expect(sniffDelimiter("single\nvalue\n")).toBe(",");
  });

  it("summarizes columns: kind, fill, distinct values, range, frequent values", () => {
    const [num, date, txt, empty] = summarizeColumns(["n", "d", "t", "e"], [
      ["1", "2026-01-02", "red", ""],
      ["2.5", "2026-03-01", "blue", ""],
      ["", "2025-12-31", "red", ""],
    ]);
    expect(num).toMatchObject({ kind: "number", filled: 2, empty: 1, min: "1", max: "2.5", mean: 1.75 });
    expect(date).toMatchObject({ kind: "date", min: "2025-12-31", max: "2026-03-01" });
    expect(txt).toMatchObject({ kind: "text", distinct: 2, top: [{ value: "red", count: 2 }, { value: "blue", count: 1 }] });
    expect(empty.kind).toBe("empty");
    expect(summarizeColumns(["x"], [["1.234,5"], ["10"]])[0]).toMatchObject({ kind: "number", max: "1234.5" });
  });

  it("sorts numbers numerically and empty cells last", () => {
    expect(["10", "", "9", "x"].sort(compareCells)).toEqual(["9", "10", "x", ""]);
  });

  it("compiles to a Markdown table", () => {
    const md = csvType.toMarkdown({ csv: "a,b\n1,x|y\n", delimiter: "," }, {} as never);
    expect(md).toBe("| a | b |\n| --- | --- |\n| 1 | x\\|y |");
    expect(csvType.deserialize("a;b\n1;2\n")).toEqual({ csv: "a;b\n1;2\n", delimiter: ";" });
  });
});
