/** RFC 4180-style CSV/TSV parsing (quoted fields, escaped quotes, CRLF). Stops after `maxRows`. */
export function parseDelimited(text: string, delimiter: string, maxRows = Infinity): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const src = text.replace(/^﻿/, "");
  const pushRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      pushRow();
      if (rows.length >= maxRows) return { rows, truncated: i + 1 < src.length };
    } else field += c;
    i++;
  }
  if (field !== "" || row.length) pushRow();
  return { rows, truncated: false };
}

import { parseBibtex as parseBibtexShared } from "@sourcebook/shared";

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

/** BibTeX entries for display (shared parser; braces removed from values). */
export function parseBibtex(text: string): BibEntry[] {
  return parseBibtexShared(text).map(({ type, key, fields }) => ({
    type,
    key,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.replace(/[{}]/g, "").replace(/\s+/g, " ").trim()])),
  }));
}
