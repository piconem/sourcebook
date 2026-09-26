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

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

/** Minimal BibTeX reader: @type{key, field = {…} | "…" | bare, …}; skips @comment/@preamble/@string. */
export function parseBibtex(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  let i = 0;
  const skipWs = () => {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
  };
  const readBalanced = (open: string, close: string) => {
    let depth = 0;
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === "\\") {
        i++;
        continue;
      }
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) return text.slice(start + 1, i++);
    }
    return text.slice(start + 1);
  };
  while ((i = text.indexOf("@", i)) !== -1) {
    const typeMatch = /^@([a-zA-Z]+)\s*([{(])/.exec(text.slice(i, i + 40));
    if (!typeMatch) {
      i++;
      continue;
    }
    const type = typeMatch[1].toLowerCase();
    i += typeMatch[0].length - 1;
    const body = readBalanced(typeMatch[2], typeMatch[2] === "{" ? "}" : ")");
    if (["comment", "preamble", "string"].includes(type)) continue;
    const comma = body.indexOf(",");
    const key = (comma === -1 ? body : body.slice(0, comma)).trim();
    const fields: Record<string, string> = {};
    const rest = comma === -1 ? "" : body.slice(comma + 1);
    const saved = { text, i };
    text = rest;
    i = 0;
    while (i < text.length) {
      skipWs();
      const nameMatch = /^([A-Za-z][\w-]*)\s*=\s*/.exec(text.slice(i));
      if (!nameMatch) break;
      i += nameMatch[0].length;
      let value: string;
      if (text[i] === "{") value = readBalanced("{", "}");
      else if (text[i] === '"') {
        const end = text.indexOf('"', i + 1);
        value = text.slice(i + 1, end === -1 ? undefined : end);
        i = end === -1 ? text.length : end + 1;
      } else {
        const m = /^[^,}]*/.exec(text.slice(i))!;
        value = m[0];
        i += m[0].length;
      }
      fields[nameMatch[1].toLowerCase()] = value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
    }
    ({ text, i } = saved);
    entries.push({ type, key, fields });
  }
  return entries;
}
