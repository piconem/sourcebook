import { markdownTable, type Conversion, type ConvertedPart } from "./common.js";
import { sheetGrid } from "./office.js";
import { attr, child, children, descendants, localName, unzip, xmlEntry, type XmlElement } from "./xml.js";

/** Inline text of an ODF paragraph/heading/span: spaces, tabs, line breaks, links, notes, images. */
function inline(el: XmlElement): string {
  let out = "";
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) {
      out += c.nodeValue ?? "";
      continue;
    }
    if (c.nodeType !== 1) continue;
    const e = c as XmlElement;
    switch (localName(e)) {
      case "s":
        out += " ".repeat(Number(attr(e, "c") ?? 1));
        break;
      case "tab":
        out += "\t";
        break;
      case "line-break":
        out += "\n";
        break;
      case "a": {
        const text = inline(e);
        const href = attr(e, "href");
        out += href && !href.startsWith("#") ? `[${text}](${href})` : text;
        break;
      }
      case "note": {
        const body = descendants(child(e, "note-body"), "p").map(inline).join(" ").trim();
        if (body) out += ` [note: ${body}]`;
        break;
      }
      case "frame":
        if (descendants(e, "image").length) {
          const title = child(e, "title")?.textContent || child(e, "desc")?.textContent || attr(e, "name");
          out += title ? `[image: ${title}]` : "[image]";
        } else out += descendants(e, "p").map(inline).join(" ");
        break;
      case "bookmark":
      case "bookmark-start":
      case "bookmark-end":
      case "soft-page-break":
      case "annotation":
        break;
      default:
        out += inline(e);
    }
  }
  return out;
}

function listItems(list: XmlElement, depth: number): string[] {
  const out: string[] = [];
  for (const item of children(list, "list-item")) {
    let first = true;
    for (const c of children(item)) {
      const n = localName(c);
      if (n === "p" || n === "h") {
        const text = inline(c).trim();
        if (!text) continue;
        out.push(`${"  ".repeat(depth)}${first ? "- " : "  "}${text}`);
        first = false;
      } else if (n === "list") out.push(...listItems(c, depth + 1));
    }
  }
  return out;
}

/** Rows of an ODF table (repeated cells/rows expanded, capped). */
function tableRows(table: XmlElement): string[][] {
  const rows: string[][] = [];
  const rowEls = [...children(table, "table-row"), ...children(child(table, "table-header-rows"), "table-row"), ...children(child(table, "table-rows"), "table-row")];
  // Header rows first (document order is header-rows, then rows).
  const ordered = descendants(table, "table-row").filter((r) => rowEls.includes(r));
  for (const row of ordered) {
    const cells: string[] = [];
    for (const cell of children(row).filter((c) => localName(c) === "table-cell" || localName(c) === "covered-table-cell")) {
      const text = children(cell, "p").map(inline).join(" ").trim();
      const repeat = Math.min(Number(attr(cell, "number-columns-repeated") ?? 1), text ? 200 : 1000);
      for (let i = 0; i < repeat; i++) cells.push(text);
    }
    const repeat = Math.min(Number(attr(row, "number-rows-repeated") ?? 1), cells.some((c) => c) ? 5000 : 1);
    for (let i = 0; i < repeat; i++) rows.push(cells);
  }
  return rows;
}

/** Body elements (headings, paragraphs, lists, tables, sections) → Markdown blocks. */
function blocks(parent: XmlElement | null): string[] {
  const out: string[] = [];
  for (const el of children(parent)) {
    const n = localName(el);
    if (n === "h") {
      const level = Number(attr(el, "outline-level") ?? 1);
      const text = inline(el).trim();
      if (text) out.push(`${"#".repeat(Math.min(6, level + 2))} ${text}`);
    } else if (n === "p") {
      const text = inline(el).trim();
      if (text) out.push(text);
    } else if (n === "list") out.push(listItems(el, 0).join("\n"));
    else if (n === "table") out.push(markdownTable(sheetGrid(tableRows(el)).rows));
    else if (n === "section" || n === "text-box" || n === "index-body") out.push(...blocks(el));
    else if (n === "table-of-content") out.push(...blocks(child(el, "index-body")));
  }
  return out.filter(Boolean);
}

export async function convertOdt(data: Uint8Array): Promise<Conversion> {
  const content = xmlEntry(unzip(data), "content.xml");
  const text = descendants(content, "text")[0];
  return { unit: "document", parts: [{ n: 1, markdown: blocks(text).join("\n\n") }], warnings: [], converter: "Sourcebook ODF reader" };
}

export async function convertOdp(data: Uint8Array): Promise<Conversion> {
  const content = xmlEntry(unzip(data), "content.xml");
  const pages = descendants(descendants(content, "presentation")[0], "page");
  const parts: ConvertedPart[] = pages.map((page, i) => {
    let title: string | undefined;
    const body: string[] = [];
    for (const frame of children(page, "frame")) {
      const cls = attr(frame, "class");
      const box = child(frame, "text-box");
      if (box) {
        const b = blocks(box);
        if ((cls === "title" || cls === "subtitle") && !title) title = b.join(" ");
        else body.push(...b);
      } else if (child(frame, "table")) body.push(markdownTable(tableRows(child(frame, "table")!)));
      else if (child(frame, "image")) {
        const t = child(frame, "title")?.textContent || child(frame, "desc")?.textContent;
        body.push(t ? `[image: ${t}]` : "[image]");
      }
    }
    const notes = blocks(descendants(child(page, "notes"), "text-box")[0] ?? null).join("\n");
    if (notes) body.push(`**Speaker notes:**\n\n${notes}`);
    return { n: i + 1, title: title || attr(page, "name") || undefined, markdown: body.join("\n\n") };
  });
  return { unit: "slide", parts, warnings: [], converter: "Sourcebook ODF reader" };
}

export async function convertOds(data: Uint8Array): Promise<Conversion> {
  const content = xmlEntry(unzip(data), "content.xml");
  const tables = children(descendants(content, "spreadsheet")[0], "table");
  const warnings: string[] = [];
  const parts: ConvertedPart[] = tables.map((t, i) => {
    const name = attr(t, "name") ?? `Sheet ${i + 1}`;
    const { rows, note } = sheetGrid(tableRows(t));
    if (note) warnings.push(`Sheet "${name}": ${note.replace(/_/g, "")}`);
    return { n: i + 1, title: name, markdown: rows.length ? [markdownTable(rows), note].filter(Boolean).join("\n\n") : "_Empty sheet._" };
  });
  return { unit: "sheet", parts, warnings, converter: "Sourcebook ODF reader" };
}
