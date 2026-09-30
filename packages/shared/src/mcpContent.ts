/**
 * "MCP content" of reference files: what the assistant can read. Text formats are read as they are; images are
 * passed as images; documents (PDF, Office, OpenDocument, EPUB…) are converted to Markdown, with page images
 * where text is not enough (scans, diagrams). Generated files live in references/.mcp/<path>/.
 */
import { z } from "zod";

/** Read natively as text. */
export const NATIVE_TEXT_EXT =
  /\.(txt|log|md|markdown|csv|tsv|json|ya?ml|toml|xml|ini|cfg|conf|env|tex|sty|cls|bib|bst|mmd|mermaid|excalidraw|css|scss|js|jsx|ts|tsx|py|java|c|h|cpp|hpp|cs|go|rs|rb|php|kt|swift|sql|sh|r|lua|pl|graphql|diff|rst|adoc|svg)$/i;
/** Passed to the assistant as images. */
export const NATIVE_IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** Formats converted to Markdown, with the unit their content is split into. */
export const CONVERTIBLE_FORMATS = {
  pdf: { label: "PDF", unit: "page" },
  docx: { label: "Word", unit: "document" },
  doc: { label: "Word 97-2003", unit: "document" },
  pptx: { label: "PowerPoint", unit: "slide" },
  xlsx: { label: "Excel", unit: "sheet" },
  odt: { label: "OpenDocument text", unit: "document" },
  odp: { label: "OpenDocument presentation", unit: "slide" },
  ods: { label: "OpenDocument spreadsheet", unit: "sheet" },
  rtf: { label: "Rich Text", unit: "document" },
  epub: { label: "EPUB", unit: "chapter" },
  html: { label: "HTML", unit: "document" },
  htm: { label: "HTML", unit: "document" },
  ipynb: { label: "Jupyter notebook", unit: "document" },
  eml: { label: "Email", unit: "document" },
  msg: { label: "Outlook email", unit: "document" },
  zip: { label: "ZIP archive", unit: "file" },
} as const;
export type ConvertibleExt = keyof typeof CONVERTIBLE_FORMATS;
export type McpUnit = "page" | "slide" | "sheet" | "chapter" | "file" | "document";

export const extOfName = (name: string) => (/\.([^./]+)$/.exec(name)?.[1] ?? "").toLowerCase();

/** How the assistant can read a file, from its name. */
export function mcpKindOf(name: string): "text" | "image" | "convertible" | "unsupported" {
  if (extOfName(name) in CONVERTIBLE_FORMATS) return "convertible";
  if (NATIVE_TEXT_EXT.test(name)) return "text";
  if (NATIVE_IMAGE_EXT.test(name)) return "image";
  return "unsupported";
}

/**
 * - native: readable as it is (text or image)
 * - ready: converted, up to date · stale: the file changed after the conversion
 * - pending: waiting to be converted · converting: in progress · failed: the conversion failed
 * - unsupported: no way to read it
 */
export type McpStatus = "native" | "ready" | "stale" | "pending" | "converting" | "failed" | "unsupported";

export interface McpInfo {
  status: McpStatus;
  /** How it is read: text, image, or markdown (converted). */
  kind: "text" | "image" | "markdown" | "none";
  /** Converted documents: number of pages/slides/sheets/…, and of page images. */
  unit?: McpUnit;
  parts?: number;
  pageImages?: number;
  /** Figures cut out of the document (PDF). */
  figures?: number;
  /** Parts that need their image (scans, diagrams) and have no transcription. */
  imageOnlyParts?: number;
  error?: string;
}

/**
 * What a PDF page turned out to contain: text · text with figures · a full-page scan · images without text ·
 * a vector drawing without text · nothing.
 */
export const PAGE_KINDS = ["text", "text+figures", "scan", "figures", "vector", "blank"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
/** Page kinds whose content is only visible in the page image (unless transcribed). */
export const IMAGE_ONLY_KINDS: readonly PageKind[] = ["scan", "figures", "vector"];

export const McpFigureSchema = z.object({
  /** "p3-1": first figure of page 3. */
  id: z.string(),
  page: z.number().int().positive(),
  /** Caption found next to it ("Figure 2: …", "Table 1 …"). */
  caption: z.string().optional(),
  /** Made of embedded images, of vector drawings, or both. */
  kind: z.enum(["image", "drawing", "mixed"]),
  /** Region on the page in PDF points [x0, y0, x1, y1] (origin bottom-left). */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** Image file, relative to the content folder (e.g. "figures/p003-1.webp"). */
  image: z.string(),
});
export type McpFigure = z.infer<typeof McpFigureSchema>;

export const McpPartSchema = z.object({
  /** 1-based page/slide/sheet/chapter/file number. */
  n: z.number().int().positive(),
  title: z.string().optional(),
  /** PDF pages: what the page contains. */
  kind: z.enum(PAGE_KINDS).optional(),
  /** No usable text (scan, figures, diagram, unreadable text): the page image carries the content. */
  needsImage: z.boolean().optional(),
  chars: z.number().int().nonnegative(),
  /** Fraction (0–1) of the page covered by images. */
  imageCoverage: z.number().min(0).max(1).optional(),
  vector: z.boolean().optional(),
  /** Text drawn invisibly over an image: an OCR layer added by a scanner. */
  invisibleText: z.boolean().optional(),
  /** Text layer present but unreadable (broken font encoding). */
  garbled: z.boolean().optional(),
  /** Page image, relative to the content folder (e.g. "pages/p007.webp"). */
  image: z.string().optional(),
  /** Figures (images, charts, diagrams, tables drawn as graphics) cut out of the page. */
  figures: z.array(McpFigureSchema).optional(),
  /** Text written by the assistant from the page image. */
  transcribed: z.object({ at: z.string(), by: z.string() }).optional(),
});
export type McpPart = z.infer<typeof McpPartSchema>;

/**
 * Version of the conversion logic: content produced by an older one is converted again automatically.
 * 2: figures cut out of PDF pages.
 */
export const MCP_CONVERSION_REVISION = 2;

export const McpManifestSchema = z.object({
  version: z.literal(1),
  /** MCP_CONVERSION_REVISION that produced it (missing: 1). */
  revision: z.number().int().positive().optional(),
  source: z.object({ path: z.string(), size: z.number(), mtimeMs: z.number(), sha256: z.string() }),
  format: z.string(),
  converter: z.string(),
  createdAt: z.string(),
  unit: z.enum(["page", "slide", "sheet", "chapter", "file", "document"]),
  parts: z.array(McpPartSchema),
  warnings: z.array(z.string()),
  /** Set when the conversion failed (no content.md). */
  error: z.string().optional(),
});
export type McpManifest = z.infer<typeof McpManifestSchema>;

export interface McpContent {
  manifest: McpManifest;
  markdown: string;
}

/** Body of POST …/references/mcp/convert. */
export const ConvertReferencesBodySchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(1000),
  /** Convert again even when up to date. */
  force: z.boolean().default(false),
});
/** Body of POST …/references/mcp/pages: render page images (PDF). */
export const RenderPagesBodySchema = z.object({
  path: z.string().min(1),
  /** "all", or page numbers. */
  pages: z.union([z.literal("all"), z.array(z.number().int().positive()).max(2000)]),
});
/** Body of PUT …/references/mcp/transcription. */
export const TranscriptionBodySchema = z.object({
  path: z.string().min(1),
  page: z.number().int().positive(),
  markdown: z.string().max(200_000),
  by: z.string().max(200).optional(),
});

// ---- part markers in the Markdown ----

/** Marker opening each part: `<!-- sourcebook:page 3 -->`. */
export const partMarker = (unit: McpUnit, n: number) => `<!-- sourcebook:${unit} ${n} -->`;
const MARKER = /^<!-- sourcebook:(page|slide|sheet|chapter|file|document) (\d+) -->$/gm;

/** Splits converted Markdown into its parts (text before the first marker is the preamble, n = 0). */
export function splitParts(markdown: string): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  let last = 0;
  let n = 0;
  for (const m of markdown.matchAll(MARKER)) {
    const text = markdown.slice(last, m.index);
    if (n > 0 || text.trim()) out.push({ n, text });
    n = Number(m[2]);
    last = m.index!;
  }
  out.push({ n, text: markdown.slice(last) });
  return out.filter((p) => p.n > 0 || p.text.trim());
}

/** Parses "3", "3-5", "1,4,7-9" into sorted unique numbers (null when invalid). */
export function parsePartRange(spec: string, max: number): number[] | null {
  const out = new Set<number>();
  for (const piece of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(piece);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a) return null;
    for (let i = a; i <= Math.min(b, max); i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

/** The Markdown of some parts only (preamble included). */
export function selectParts(markdown: string, numbers: number[]): string {
  const want = new Set(numbers);
  return splitParts(markdown)
    .filter((p) => p.n === 0 || want.has(p.n))
    .map((p) => p.text)
    .join("");
}

/** Replaces the body of one part, keeping its marker and heading line. */
export function replacePart(markdown: string, n: number, body: string): string {
  return splitParts(markdown)
    .map((p) => {
      if (p.n !== n) return p.text;
      const [marker, heading] = p.text.split("\n", 2);
      return `${marker}\n${heading}\n\n${body.trim()}\n\n`;
    })
    .join("");
}

/** Rough token estimate (≈ 4 characters per token). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

const unitPlural = (unit: McpUnit, n: number) => `${n} ${unit}${n === 1 ? "" : "s"}`;
const ranges = (ns: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(i === j ? `${ns[i]}` : `${ns[i]}-${ns[j]}`);
    i = j;
  }
  return out.join(",");
};

/** Parts whose content is only in their image (and not transcribed). */
export const imageOnlyParts = (m: McpManifest) => m.parts.filter((p) => p.needsImage && !p.transcribed).map((p) => p.n);

/**
 * What the assistant receives for a converted file (read_reference): a header describing the conversion
 * and how to get what the text lacks, then the Markdown (all parts, or some).
 */
export function assistantView(path: string, content: McpContent, parts?: number[]): string {
  const m = content.manifest;
  const head = [`references/${path} — converted to Markdown from ${m.format.toUpperCase()} (${m.unit === "document" ? "1 document" : unitPlural(m.unit, m.parts.length)}) on ${m.createdAt.slice(0, 10)}.`];
  const label = (ns: number[]) => `${m.unit === "page" ? "Page" : "Part"}${ns.length > 1 ? "s" : ""} ${ranges(ns)}`;
  const imageOnly = imageOnlyParts(m);
  if (imageOnly.length)
    head.push(`${label(imageOnly)} ${imageOnly.length > 1 ? "have" : "has"} no usable text (scans, figures, diagrams): read ${imageOnly.length > 1 ? "them" : "it"} with read_reference_pages; after reading one you may save its text with save_reference_transcription.`);
  const transcribed = m.parts.filter((p) => p.transcribed).map((p) => p.n);
  if (transcribed.length) head.push(`${label(transcribed)} ${transcribed.length > 1 ? "were" : "was"} transcribed from ${transcribed.length > 1 ? "their images" : "its image"}.`);
  const figures = m.parts.flatMap((p) => p.figures ?? []);
  if (figures.length)
    head.push(`${figures.length} figure${figures.length > 1 ? "s" : ""} (images, charts, diagrams, graphic tables) ${figures.length > 1 ? "were" : "was"} cut out and listed at the end of ${figures.length > 1 ? "their pages" : "its page"}: look at them with read_reference_figures.`);
  if (m.parts.some((p) => p.invisibleText)) head.push("Some pages are scans whose text comes from the scanner's OCR layer (it may contain errors; their images can be read with read_reference_pages).");
  if (m.unit !== "document" && m.parts.length > 1 && !parts) head.push(`To read only some ${m.unit}s pass parts, e.g. "1-3".`);
  for (const w of m.warnings) head.push(`Note: ${w}`);
  const body = parts ? selectParts(content.markdown, parts) : content.markdown;
  return `${head.join("\n")}\n\n${body}`;
}

// ---- images from references (image files, figures of documents) into image sub-blocks ----

/** Extensions an image sub-block can hold (same as asset uploads). */
export const IMAGE_ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

/** An image reference or a figure of a converted document. */
export const ReferenceImageSourceSchema = z.object({
  /** Path inside references/: an image file, or the document the figure comes from. */
  path: z.string().min(1),
  /** Figure id ("p3-1") when taking a figure of a document. */
  figure: z.string().regex(/^p\d+-\d+$/).optional(),
});
export type ReferenceImageSource = z.infer<typeof ReferenceImageSourceSchema>;

/** Body of POST …/blocks/:id/assets/from-reference: copy into the block's assets. */
export const AssetFromReferenceBodySchema = ReferenceImageSourceSchema.extend({
  /** Sub-block to attach the source file to (📎). */
  attachTo: z.string().optional(),
});

/** Body of POST …/blocks/:id/images/from-reference: a new image sub-block. */
export const ImageFromReferenceBodySchema = ReferenceImageSourceSchema.extend({
  caption: z.string().max(2000).optional(),
  alt: z.string().max(500).optional(),
  title: z.string().max(200).optional(),
  position: z.number().int().nonnegative().optional(),
});

export interface AssetFromReferenceResult {
  /** "assets/…" inside the block folder. */
  path: string;
  url: string;
  alt: string;
  /** Caption of the figure, if any. */
  caption: string;
}

/** Images available in the references: image files and figures of converted documents. */
export interface ReferenceImages {
  images: { path: string; name: string; size?: number }[];
  documents: { path: string; name: string; figures: McpFigure[] }[];
}
