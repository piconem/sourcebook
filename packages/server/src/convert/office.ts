import ExcelJS from "exceljs";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { htmlToMarkdown, markdownTable, paragraphs, shiftHeadings, type Conversion, type ConvertedPart } from "./common.js";
import { attr, child, children, descendants, localName, prefixedAttr, relationships, unzip, xmlEntry, type XmlElement } from "./xml.js";

/** Rows and columns of a sheet included in the Markdown (the rest is summarised). */
export const MAX_SHEET_ROWS = 1000;
export const MAX_SHEET_COLS = 40;

// ---------------------------------------------------------------- Word

export async function convertDocx(data: Uint8Array): Promise<Conversion> {
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(data) },
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
  );
  const markdown = shiftHeadings(htmlToMarkdown(result.value));
  const warnings = [...new Set(result.messages.filter((m) => m.type === "warning").map((m) => m.message))].slice(0, 10);
  return { unit: "document", parts: [{ n: 1, markdown }], warnings, converter: "mammoth + turndown" };
}

export async function convertDoc(data: Uint8Array): Promise<Conversion> {
  const doc = await new WordExtractor().extract(Buffer.from(data));
  const footnotes = doc.getFootnotes().trim();
  const markdown = [paragraphs(doc.getBody()), footnotes ? `#### Footnotes\n\n${paragraphs(footnotes)}` : ""].filter(Boolean).join("\n\n");
  return { unit: "document", parts: [{ n: 1, markdown }], warnings: ["Word 97-2003 file: text only (no formatting or tables)."], converter: "word-extractor" };
}

// ---------------------------------------------------------------- PowerPoint

/** Text of a DrawingML paragraph (runs, fields, line breaks). */
function drawingParagraph(p: XmlElement): string {
  let text = "";
  for (const c of children(p)) {
    const n = localName(c);
    if (n === "r" || n === "fld") text += descendants(c, "t").map((t) => t.textContent ?? "").join("");
    else if (n === "br") text += "\n";
  }
  return text.trim();
}

/** Paragraphs of a text body as Markdown (bullets with their level when `bullets`). */
function textBody(body: XmlElement | null, bullets: boolean): string[] {
  const out: string[] = [];
  for (const p of children(body, "p")) {
    const text = drawingParagraph(p);
    if (!text) continue;
    const pPr = child(p, "pPr");
    const level = Number(attr(pPr, "lvl") ?? 0);
    const noBullet = !!child(pPr, "buNone");
    const isBullet = !noBullet && (bullets || !!child(pPr, "buChar") || !!child(pPr, "buAutoNum"));
    out.push(isBullet ? `${"  ".repeat(level)}- ${text.replace(/\n/g, " ")}` : text);
  }
  return out;
}

function tableRows(tbl: XmlElement): string[][] {
  return children(tbl, "tr").map((tr) => children(tr, "tc").map((tc) => textBody(child(tc, "txBody"), false).join(" ")));
}

interface SlideContent {
  title?: string;
  blocks: string[];
}

/** Shapes of a slide in drawing order: titles, text, tables, pictures, groups. */
function slideShapes(tree: XmlElement | null, out: SlideContent) {
  for (const sp of children(tree)) {
    const n = localName(sp);
    if (n === "sp") {
      const ph = descendants(child(sp, "nvSpPr"), "ph")[0];
      const type = attr(ph, "type");
      const lines = textBody(child(sp, "txBody"), !!ph && (type === null || type === "body" || type === "obj"));
      if (!lines.length) continue;
      if ((type === "title" || type === "ctrTitle") && !out.title) out.title = lines.join(" ");
      else if (type === "sldNum" || type === "dt" || type === "ftr") continue;
      else out.blocks.push(lines.join("\n"));
    } else if (n === "graphicFrame") {
      const tbl = descendants(sp, "tbl")[0];
      if (tbl) out.blocks.push(markdownTable(tableRows(tbl)));
    } else if (n === "pic") {
      const nv = descendants(sp, "cNvPr")[0];
      const descr = attr(nv, "descr") || attr(nv, "title");
      out.blocks.push(descr ? `[image: ${descr}]` : "[image]");
    } else if (n === "grpSp") slideShapes(sp, out);
  }
}

export async function convertPptx(data: Uint8Array): Promise<Conversion> {
  const files = unzip(data);
  const presentation = xmlEntry(files, "ppt/presentation.xml");
  const rels = relationships(files, "ppt/presentation.xml");
  // Slide order is the presentation's list, not the file numbering.
  const slidePaths = descendants(child(presentation, "sldIdLst"), "sldId")
    .map((s) => rels.get(prefixedAttr(s, "id") ?? "")?.target)
    .filter((p): p is string => !!p && !!files[p]);
  const parts: ConvertedPart[] = slidePaths.map((path, i) => {
    const slide = xmlEntry(files, path);
    const content: SlideContent = { blocks: [] };
    slideShapes(child(descendants(slide, "cSld")[0], "spTree"), content);
    const notesPath = [...relationships(files, path).values()].find((r) => r.type.endsWith("/notesSlide"))?.target;
    const notes = notesPath
      ? descendants(xmlEntry(files, notesPath), "sp")
          .filter((sp) => attr(descendants(sp, "ph")[0], "type") === "body")
          .flatMap((sp) => textBody(child(sp, "txBody"), false))
          .join("\n")
      : "";
    const markdown = [...content.blocks, notes ? `**Speaker notes:**\n\n${notes}` : ""].filter(Boolean).join("\n\n");
    const hidden = attr(slide, "show") === "0";
    return { n: i + 1, title: `${content.title ?? ""}${hidden ? " (hidden)" : ""}`.trim() || undefined, markdown };
  });
  return { unit: "slide", parts, warnings: [], converter: "Sourcebook OOXML reader" };
}

// ---------------------------------------------------------------- Excel

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v instanceof Date) return v.toISOString().replace(/T00:00:00\.000Z$/, "").replace(/\.000Z$/, "Z");
  if (v && typeof v === "object" && "result" in v) {
    const r = (v as { result?: unknown }).result;
    return r instanceof Date ? r.toISOString().slice(0, 10) : String(r ?? "");
  }
  return cell.text ?? "";
}

/** Trims empty trailing rows/columns and caps the size; returns the rows and a note when cut. */
export function sheetGrid(rows: string[][]): { rows: string[][]; note?: string } {
  let grid = rows.map((r) => {
    let end = r.length;
    while (end > 0 && !r[end - 1]?.trim()) end--;
    return r.slice(0, end);
  });
  while (grid.length && !grid[grid.length - 1].length) grid.pop();
  const totalRows = grid.length;
  const totalCols = Math.max(0, ...grid.map((r) => r.length));
  const notes: string[] = [];
  if (totalRows > MAX_SHEET_ROWS) {
    grid = grid.slice(0, MAX_SHEET_ROWS);
    notes.push(`first ${MAX_SHEET_ROWS} of ${totalRows} rows`);
  }
  if (totalCols > MAX_SHEET_COLS) {
    grid = grid.map((r) => r.slice(0, MAX_SHEET_COLS));
    notes.push(`first ${MAX_SHEET_COLS} of ${totalCols} columns`);
  }
  return { rows: grid, note: notes.length ? `_Showing the ${notes.join(" and ")}._` : undefined };
}

export async function convertXlsx(data: Uint8Array): Promise<Conversion> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(data) as unknown as ArrayBuffer);
  const parts: ConvertedPart[] = [];
  const warnings: string[] = [];
  wb.worksheets.forEach((ws, i) => {
    const raw: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c)));
      raw[r - 1] = cells;
    });
    const { rows, note } = sheetGrid(Array.from(raw, (r) => r ?? []));
    if (note) warnings.push(`Sheet "${ws.name}": ${note.replace(/_/g, "")}`);
    const hidden = ws.state !== "visible";
    const markdown = rows.length ? [markdownTable(rows), note].filter(Boolean).join("\n\n") : "_Empty sheet._";
    parts.push({ n: i + 1, title: `${ws.name}${hidden ? " (hidden)" : ""}`, markdown });
  });
  return { unit: "sheet", parts, warnings, converter: "exceljs" };
}
