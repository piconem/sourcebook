import { CONVERTIBLE_FORMATS, partMarker, type ConvertibleExt, type McpFigure, type McpUnit, type PageKind } from "@sourcebook/shared";
import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";

/** One page / slide / sheet / chapter / file of a converted document. */
export interface ConvertedPart {
  n: number;
  title?: string;
  markdown: string;
  /** PDF pages: analysis (see pdf.ts). */
  kind?: PageKind;
  imageCoverage?: number;
  vector?: boolean;
  invisibleText?: boolean;
  garbled?: boolean;
  /** No usable text: the assistant needs the page image. */
  needsImage?: boolean;
  /** Figures cut out of the page (their images are in Conversion.files). */
  figures?: McpFigure[];
}

export interface Conversion {
  unit: McpUnit;
  parts: ConvertedPart[];
  warnings: string[];
  /** Generated files (e.g. figure images), by path relative to the content folder. */
  files?: Record<string, Uint8Array>;
  /** Library used, e.g. "pdfjs-dist 6.3". */
  converter: string;
}

export const formatLabel = (ext: string) => CONVERTIBLE_FORMATS[ext as ConvertibleExt]?.label ?? ext.toUpperCase();

/** Markdown headings of a fragment moved down (document content sits below the part heading "##"). */
export function shiftHeadings(md: string, by = 2): string {
  let fence = false;
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (fence) return line;
      const m = /^(#{1,6})(\s)/.exec(line);
      return m ? `${"#".repeat(Math.min(6, m[1].length + by))}${line.slice(m[1].length)}` : line;
    })
    .join("\n");
}

const unitLabel: Record<McpUnit, string> = { page: "Page", slide: "Slide", sheet: "Sheet", chapter: "Chapter", file: "File", document: "Document" };

/** Short note for a part whose content is only visible in its image. */
export function imageOnlyNote(unit: McpUnit, n: number, kind?: PageKind): string {
  const what = kind === "scan" ? "a scanned image with no text layer" : kind === "vector" ? "a drawing/diagram with no text" : kind === "figures" ? "images with no text" : "no readable text";
  return `_${unitLabel[unit]} ${n} contains ${what}: read it with read_reference_pages (pages "${n}")._`;
}

/** The whole converted document: preamble, then each part with its marker and heading. */
export function assembleMarkdown(fileName: string, ext: string, conv: Conversion): string {
  const count = conv.parts.length;
  const unitName = conv.unit === "document" ? "" : ` · ${count} ${conv.unit}${count === 1 ? "" : "s"}`;
  const out = [`# ${fileName}`, "", `_Converted to Markdown from ${formatLabel(ext)}${unitName}._`, ""];
  for (const p of conv.parts) {
    const heading = conv.unit === "document" ? (p.title ?? "Content") : `${unitLabel[conv.unit]} ${p.n}${p.title ? `: ${p.title}` : ""}`;
    out.push(partMarker(conv.unit, p.n), `## ${heading.replace(/\s+/g, " ").trim()}`, "", p.markdown.trim() || "_(empty)_", "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/** HTML → Markdown (GFM tables), images replaced by their description. */
export function htmlToMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "_" });
  td.use(gfm);
  td.remove(["script", "style", "noscript", "head", "title"]);
  td.addRule("images", {
    filter: "img",
    replacement: (_content, node) => {
      const alt = ((node as HTMLElement).getAttribute("alt") ?? "").trim();
      return alt ? `[image: ${alt}]` : "[image]";
    },
  });
  // Tables without a header row: the first row becomes the header (GFM tables need one).
  const withHeaders = html.replace(/(<table[^>]*>\s*(?:<tbody[^>]*>)?\s*<tr[^>]*>)([\s\S]*?)(<\/tr>)/gi, (all, open: string, row: string, close: string) =>
    /<th[\s>]/i.test(all) ? all : `${open}${row.replace(/<td(\s|>)/gi, "<th$1").replace(/<\/td>/gi, "</th>")}${close}`,
  );
  return td
    .turndown(withHeaders)
    .replace(/^(\s*)([-*]|\d+\.)\s{2,}/gm, "$1$2 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A Markdown table from rows of cells (first row = header). */
export function markdownTable(rows: string[][]): string {
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (s: string | undefined) => (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(" | ")} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

/** Plain paragraphs → Markdown (blank line between paragraphs). */
export const paragraphs = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
