/** CSV (RFC 4180): quoted fields may contain the delimiter, quotes ("") and line breaks. */

export type CsvDelimiter = "," | ";" | "\t" | "|";
export const CSV_DELIMITERS: { id: CsvDelimiter; label: string }[] = [
  { id: ",", label: "Comma" },
  { id: ";", label: "Semicolon" },
  { id: "\t", label: "Tab" },
  { id: "|", label: "Pipe" },
];

export interface ParsedCsv {
  /** Records (the first is the header), each a list of fields. */
  rows: string[][];
  /** For each record: its offsets in the text (`to` excludes the line break) and its 1-based source lines. */
  spans: { from: number; to: number; firstLine: number; lastLine: number }[];
}

/** Parses CSV text. A trailing line break does not make an empty record; ragged rows are kept as they are. */
export function parseCsv(text: string, delimiter: CsvDelimiter = ","): ParsedCsv {
  const rows: string[][] = [];
  const spans: ParsedCsv["spans"] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let start = 0;
  let line = 1;
  let startLine = 1;
  let i = 0;
  const endRecord = (end: number) => {
    row.push(field);
    rows.push(row);
    spans.push({ from: start, to: end, firstLine: startLine, lastLine: line });
    row = [];
    field = "";
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      const end = i;
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord(end);
      line++;
      start = i + 1;
      startLine = line;
    } else {
      field += ch;
    }
    i++;
  }
  // Anything after the last line break is a last record (a final line break adds none).
  if (start < text.length) endRecord(text.length);
  return { rows, spans };
}

const needsQuotes = (v: string, d: string) => v.includes(d) || v.includes('"') || v.includes("\n") || v.includes("\r") || /^\s|\s$/.test(v);

/** Writes records as CSV (fields quoted only when needed), one per line, with a final line break. */
export function stringifyCsv(rows: string[][], delimiter: CsvDelimiter = ","): string {
  if (!rows.length) return "";
  return rows.map((r) => r.map((v) => (needsQuotes(v, delimiter) ? `"${v.replace(/"/g, '""')}"` : v)).join(delimiter)).join("\n") + "\n";
}

/** The delimiter that splits the first lines most consistently (default comma). */
export function sniffDelimiter(text: string): CsvDelimiter {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20).join("\n");
  let best: { d: CsvDelimiter; score: number } = { d: ",", score: 0 };
  for (const { id } of CSV_DELIMITERS) {
    const { rows } = parseCsv(sample, id);
    if (!rows.length) continue;
    const width = rows[0].length;
    if (width < 2) continue;
    const consistent = rows.filter((r) => r.length === width).length / rows.length;
    const score = consistent * width;
    if (score > best.score) best = { d: id, score };
  }
  return best.d;
}

export type ColumnKind = "number" | "date" | "boolean" | "text" | "empty";

export interface ColumnSummary {
  name: string;
  kind: ColumnKind;
  /** Non-empty cells. */
  filled: number;
  empty: number;
  distinct: number;
  /** Numbers and dates: smallest / largest (as in the data); numbers: mean. */
  min?: string;
  max?: string;
  mean?: number;
  /** Most frequent values (text, booleans, few distinct numbers). */
  top?: { value: string; count: number }[];
}

const NUMBER = /^[-+]?(\d+([.,]\d+)?|\d{1,3}([ ,.']\d{3})+([.,]\d+)?|[.,]\d+)(e[-+]?\d+)?%?$/i;
const DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;
const BOOLEAN = /^(true|false|yes|no|si|sì|y|n)$/i;

/** "1.234,5" / "1,234.5" / "12%" → number (NaN when not a number). */
export function toNumber(v: string): number {
  let s = v.trim().replace(/%$/, "").replace(/[ ']/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  return s === "" ? NaN : Number(s);
}

/** Per-column type, fill, distinct values, range and frequent values of data rows (`header` names the columns). */
export function summarizeColumns(header: string[], data: string[][]): ColumnSummary[] {
  const width = Math.max(header.length, ...data.map((r) => r.length), 0);
  const out: ColumnSummary[] = [];
  for (let c = 0; c < width; c++) {
    const values = data.map((r) => (r[c] ?? "").trim());
    const filled = values.filter((v) => v !== "");
    const counts = new Map<string, number>();
    for (const v of filled) counts.set(v, (counts.get(v) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([value, count]) => ({ value, count }));
    const base = { name: header[c] || `Column ${c + 1}`, filled: filled.length, empty: values.length - filled.length, distinct: counts.size };
    if (!filled.length) {
      out.push({ ...base, kind: "empty" });
    } else if (filled.every((v) => NUMBER.test(v))) {
      const nums = filled.map(toNumber).filter((n) => !Number.isNaN(n));
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      out.push({ ...base, kind: "number", min: String(min), max: String(max), mean: nums.reduce((a, b) => a + b, 0) / nums.length, ...(counts.size <= 10 ? { top } : {}) });
    } else if (filled.every((v) => DATE.test(v))) {
      const sorted = [...filled].sort();
      out.push({ ...base, kind: "date", min: sorted[0], max: sorted[sorted.length - 1] });
    } else if (filled.every((v) => BOOLEAN.test(v))) {
      out.push({ ...base, kind: "boolean", top });
    } else {
      out.push({ ...base, kind: "text", top });
    }
  }
  return out;
}

/** Compares two cells for sorting: numerically when both are numbers, else as text (natural order). */
export function compareCells(a: string, b: string): number {
  const x = a.trim();
  const y = b.trim();
  if (x === "" || y === "") return x === y ? 0 : x === "" ? 1 : -1; // empty cells last
  if (NUMBER.test(x) && NUMBER.test(y)) return toNumber(x) - toNumber(y);
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
}
