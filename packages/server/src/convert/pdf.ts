import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { McpFigure, PageKind } from "@sourcebook/shared";
import { imageOnlyNote, type Conversion, type ConvertedPart } from "./common.js";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

let pdfjsPromise: Promise<PdfJs> | null = null;
const pdfjs = () => (pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs"));
const pdfjsDir = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

/** Below this many visible, readable characters a page has no real text (page numbers, headers). */
export const MIN_TEXT_CHARS = 80;
/** A page image covering at least this fraction of the page is a scan. */
export const SCAN_COVERAGE = 0.85;
/** Images covering at least this fraction of a text page make it a page "with figures". */
export const FIGURE_COVERAGE = 0.08;
/** Path-drawing operations from which a page without text is a vector drawing. */
const VECTOR_OPS = 12;

export async function openPdf(data: Uint8Array): Promise<PdfDocument> {
  const lib = await pdfjs();
  return lib.getDocument({
    // pdf.js may take ownership of (detach) the buffer it receives.
    data: data.slice(),
    verbosity: 0,
    standardFontDataUrl: join(pdfjsDir, "standard_fonts/"),
    cMapUrl: join(pdfjsDir, "cmaps/"),
    cMapPacked: true,
    wasmUrl: join(pdfjsDir, "wasm/"),
  }).promise;
}

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

export interface PageAnalysis {
  kind: PageKind;
  /** Visible, readable characters (not whitespace). */
  chars: number;
  imageCoverage: number;
  vector: boolean;
  invisibleText: boolean;
  garbled: boolean;
  needsImage: boolean;
}

/** Text that is mostly replacement/private-use characters or not letters: a broken font encoding. */
export function isGarbled(text: string): boolean {
  const chars = [...text.replace(/\s/g, "")];
  if (chars.length < 20) return false;
  const bad = chars.filter((c) => c === "\uFFFD" || /[\uE000-\uF8FF\u0000-\u0008]/.test(c)).length;
  const letters = chars.filter((c) => /[\p{L}\p{N}]/u.test(c)).length;
  return bad / chars.length > 0.1 || letters / chars.length < 0.4;
}

/**
 * What a page contains, from its drawing operations: area covered by images (following the transformation
 * matrices), vector path operations, and text drawn invisibly (the OCR layer scanners add).
 */
async function analyseOperators(page: PdfPage) {
  const { OPS } = await pdfjs();
  const ops = await page.getOperatorList();
  const [x0, y0, x1, y1] = page.view;
  const pageArea = Math.max(1, (x1 - x0) * (y1 - y0));
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let imageArea = 0;
  let paths = 0;
  /** Regions painted by images and drawings, in page space. */
  const rects: Rect[] = [];
  const toPage = (bx0: number, by0: number, bx1: number, by1: number): Rect => {
    const pts = [[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]]);
    const xs = pts.map((p) => Math.min(x1, Math.max(x0, p[0])));
    const ys = pts.map((p) => Math.min(y1, Math.max(y0, p[1])));
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), kind: "drawing" };
  };
  let renderMode = 0;
  let shown = 0;
  let invisible = 0;
  const imageOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat]);
  const textOps = new Set<number>([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(args as Matrix, ctm);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args[0]) && args[0].length === 6) ctm = multiply(args[0] as Matrix, ctm);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (imageOps.has(fn)) {
      // Images are drawn in the unit square, mapped to the page by the current matrix.
      const r = { ...toPage(0, 0, 1, 1), kind: "image" as const };
      imageArea += (r.x1 - r.x0) * (r.y1 - r.y0);
      rects.push(r);
    } else if (fn === OPS.constructPath) {
      paths++;
      // [op, path data, [minX, minY, maxX, maxY]] in the current user space.
      const mm = args[2] as ArrayLike<number> | null | undefined;
      if (mm && mm.length === 4 && Number.isFinite(mm[0])) rects.push(toPage(mm[0], mm[1], mm[2], mm[3]));
    }
    else if (fn === OPS.setTextRenderingMode) renderMode = Number(args[0]);
    else if (textOps.has(fn)) {
      shown++;
      if (renderMode === 3 || renderMode === 7) invisible++;
    }
  }
  return { imageCoverage: Math.min(1, imageArea / pageArea), paths, invisibleText: shown > 0 && invisible / shown > 0.5, rects, view: [x0, y0, x1, y1] as const };
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind: "image" | "drawing";
}

/** Figures smaller than this (points) are decorations: icons, rules, underlines, bullets. */
const MIN_FIGURE_W = 40;
const MIN_FIGURE_H = 30;
const MIN_FIGURE_AREA = 0.012;
/** Graphics closer than this (points) belong to the same figure. */
const FIGURE_GAP = 16;
const CAPTION = /^(fig(ure|\.)?|figura|table|tab\.|tabella|chart|diagram|scheme|plate|listing|algorithm)\s*[0-9IVX]+[a-z]?\b/i;

export interface FigureRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind: "image" | "drawing" | "mixed";
  caption?: string;
}

/**
 * Figures of a page: regions painted by images and drawings, merged when close, that are big enough — minus
 * page backgrounds and thin rules — each with the caption line found just below or above it.
 */
export function findFigures(rects: Rect[], view: readonly [number, number, number, number], lines: Line[]): FigureRegion[] {
  const [vx0, vy0, vx1, vy1] = view;
  const pageW = vx1 - vx0;
  const pageH = vy1 - vy0;
  const pageArea = pageW * pageH;
  // `solid`: has something more than hairlines (a region of rules only — e.g. a table's lines — is not a figure).
  const clusters: (Rect & { kinds: Set<string>; solid: boolean })[] = [];
  const near = (a: Rect, b: Rect) => a.x0 - FIGURE_GAP <= b.x1 && b.x0 - FIGURE_GAP <= a.x1 && a.y0 - FIGURE_GAP <= b.y1 && b.y0 - FIGURE_GAP <= a.y1;
  for (const r of rects) {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    // Page backgrounds / frames, and dots.
    if (w * h > pageArea * 0.85 || (w < 1.5 && h < 1.5)) continue;
    // Hairlines (rules, axes, underlines) join figures but do not make one.
    const solid = r.kind === "image" || (w >= 3 && h >= 3);
    const c = clusters.find((k) => near(k, r));
    if (c) {
      c.x0 = Math.min(c.x0, r.x0);
      c.y0 = Math.min(c.y0, r.y0);
      c.x1 = Math.max(c.x1, r.x1);
      c.y1 = Math.max(c.y1, r.y1);
      c.kinds.add(r.kind);
      c.solid ||= solid;
    } else clusters.push({ ...r, kinds: new Set([r.kind]), solid });
  }
  // Merge clusters that grew into each other.
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < clusters.length && !changed; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        if (!near(clusters[i], clusters[j])) continue;
        const a = clusters[i];
        const b = clusters.splice(j, 1)[0];
        Object.assign(a, { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
        b.kinds.forEach((k) => a.kinds.add(k));
        a.solid ||= b.solid;
        changed = true;
        break;
      }
  }
  const figures = clusters.filter((c) => c.solid && c.x1 - c.x0 >= MIN_FIGURE_W && c.y1 - c.y0 >= MIN_FIGURE_H && ((c.x1 - c.x0) * (c.y1 - c.y0)) / pageArea >= MIN_FIGURE_AREA);
  // Top to bottom, then left to right (PDF y grows upwards).
  figures.sort((a, b) => b.y1 - a.y1 || a.x0 - b.x0);
  const used = new Set<Line>();
  return figures.map((f) => {
    const overlapsX = (l: Line) => l.x1 > f.x0 && l.x0 < f.x1;
    const candidates = lines
      .filter((l) => !used.has(l) && overlapsX(l) && CAPTION.test(l.text))
      .map((l) => ({ l, d: l.y < f.y0 ? f.y0 - l.y : l.y > f.y1 ? l.y - f.y1 : 0 }))
      .filter(({ l, d }) => d <= (l.y < f.y0 ? 45 : 30))
      .sort((a, b) => a.d - b.d);
    let caption: string | undefined;
    if (candidates[0]) {
      const first = candidates[0].l;
      used.add(first);
      // The caption paragraph: following lines in the same column, close below.
      const parts = [first.text];
      let prev = first;
      for (const l of lines.slice(lines.indexOf(first) + 1)) {
        if (prev.y - l.y > Math.max(prev.size, l.size) * 1.6 || !overlapsX(l) || CAPTION.test(l.text) || parts.join(" ").length > 400) break;
        parts.push(l.text);
        prev = l;
      }
      caption = parts.join(" ").replace(/(\w)- (\w)/g, "$1$2").slice(0, 500);
    }
    const kind = f.kinds.size > 1 ? "mixed" : f.kinds.has("image") ? "image" : "drawing";
    return { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, kind, caption };
  });
}

export interface Line {
  text: string;
  y: number;
  size: number;
  /** Horizontal extent (points). */
  x0: number;
  x1: number;
}

/** Page text as lines (content-stream order, which is the reading order for most documents). */
async function pageLines(page: PdfPage): Promise<Line[]> {
  const content = await page.getTextContent();
  const lines: Line[] = [];
  let cur: Line | null = null;
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const y = item.transform[5];
    const size = Math.hypot(item.transform[2], item.transform[3]) || item.height || 0;
    if (cur && Math.abs(cur.y - y) > Math.max(2, size * 0.6) && item.str.trim()) {
      lines.push(cur);
      cur = null;
    }
    if (!cur) cur = { text: "", y, size: 0, x0: Infinity, x1: -Infinity };
    cur.text += item.str;
    if (item.str.trim()) {
      cur.size = Math.max(cur.size, size);
      cur.x0 = Math.min(cur.x0, item.transform[4]);
      cur.x1 = Math.max(cur.x1, item.transform[4] + (item.width || 0));
    }
    if (item.hasEOL) {
      lines.push(cur);
      cur = null;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() })).filter((l) => l.text);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Lines → Markdown: paragraphs from vertical gaps, headings from larger fonts, bullets, joined hyphenation. */
export function linesToMarkdown(lines: Line[], bodySize: number): string {
  const out: string[] = [];
  let para = "";
  let prev: Line | null = null;
  const flush = () => {
    if (para) out.push(para);
    para = "";
  };
  for (const l of lines) {
    const heading = bodySize > 0 && l.size >= bodySize * 1.25 && l.text.length <= 120 && !/[.;,]$/.test(l.text);
    const bullet = /^[•◦▪●■\-–]\s+/.test(l.text);
    const gap = prev ? Math.abs(prev.y - l.y) : 0;
    const newPara = !prev || heading || bullet || gap > Math.max(prev.size, l.size) * 1.7 || Math.abs(prev.size - l.size) > 1.5;
    if (heading) {
      flush();
      out.push(`${l.size >= bodySize * 1.6 ? "###" : "####"} ${l.text}`);
      prev = null;
      continue;
    }
    if (newPara) flush();
    const text = bullet ? `- ${l.text.replace(/^[•◦▪●■\-–]\s+/, "")}` : l.text;
    if (!para) para = text;
    else if (/[a-zà-ÿ]-$/i.test(para) && /^[a-zà-ÿ]/.test(text)) para = para.slice(0, -1) + text;
    else para += ` ${text}`;
    prev = l;
  }
  flush();
  // Consecutive list items form one list.
  return out.reduce((md, block, i) => (i === 0 ? block : `${md}${block.startsWith("- ") && out[i - 1].startsWith("- ") ? "\n" : "\n\n"}${block}`), "");
}

export function classify(a: { chars: number; imageCoverage: number; paths: number; invisibleText: boolean; garbled: boolean }): PageKind {
  const hasText = a.chars >= MIN_TEXT_CHARS && !a.garbled;
  if (a.invisibleText && hasText) return "scan";
  if (hasText) return a.imageCoverage >= FIGURE_COVERAGE ? "text+figures" : "text";
  if (a.imageCoverage >= SCAN_COVERAGE) return "scan";
  if (a.imageCoverage > 0.02) return "figures";
  if (a.paths >= VECTOR_OPS) return "vector";
  return a.chars > 0 && !a.garbled ? "text" : "blank";
}

/** Figures are cut from a rendering at this scale (≈ 180 dpi), with a small margin (points). */
const FIGURE_SCALE = 2.5;
const FIGURE_MARGIN = 4;
const MAX_FIGURES_PER_PAGE = 12;
const MAX_FIGURES = 300;

/** Renders a page and cuts out regions as WebP images. */
async function cutFigures(page: PdfPage, regions: FigureRegion[]): Promise<Buffer[]> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(FIGURE_SCALE, 5000 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
  const out: Buffer[] = [];
  for (const r of regions) {
    const [ax, ay] = viewport.convertToViewportPoint(r.x0 - FIGURE_MARGIN, r.y0 - FIGURE_MARGIN) as [number, number];
    const [bx, by] = viewport.convertToViewportPoint(r.x1 + FIGURE_MARGIN, r.y1 + FIGURE_MARGIN) as [number, number];
    const sx = Math.max(0, Math.floor(Math.min(ax, bx)));
    const sy = Math.max(0, Math.floor(Math.min(ay, by)));
    const sw = Math.min(canvas.width - sx, Math.ceil(Math.abs(bx - ax)));
    const sh = Math.min(canvas.height - sy, Math.ceil(Math.abs(by - ay)));
    const crop = createCanvas(Math.max(1, sw), Math.max(1, sh));
    crop.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    out.push(await crop.encode("webp", 85));
  }
  return out;
}

const figureFile = (page: number, k: number) => `figures/p${String(page).padStart(3, "0")}-${k}.webp`;

/** PDF → Markdown, one part per page, with the analysis of each page and its figures cut out as images. */
export async function convertPdf(data: Uint8Array): Promise<Conversion> {
  const pdf = await openPdf(data);
  const warnings: string[] = [];
  const files: Record<string, Uint8Array> = {};
  const pages: { lines: Line[]; analysis: PageAnalysis; figures: McpFigure[] }[] = [];
  let figureCount = 0;
  let skippedFigures = 0;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const lines = await pageLines(page);
      const text = lines.map((l) => l.text).join("\n");
      const ops = await analyseOperators(page);
      const garbled = isGarbled(text);
      const chars = text.replace(/\s/g, "").length;
      let kind = classify({ chars, imageCoverage: ops.imageCoverage, paths: ops.paths, invisibleText: ops.invisibleText, garbled });
      const needsImage = (kind === "scan" && !ops.invisibleText) || kind === "figures" || kind === "vector" || (garbled && chars > 0);
      // Pages with text: cut out their figures (pages without text get a whole-page image instead).
      const figures: McpFigure[] = [];
      if (kind === "text" || kind === "text+figures") {
        let regions = findFigures(ops.rects, ops.view, lines);
        if (regions.length > MAX_FIGURES_PER_PAGE) {
          skippedFigures += regions.length - MAX_FIGURES_PER_PAGE;
          regions = regions.slice(0, MAX_FIGURES_PER_PAGE);
        }
        if (figureCount + regions.length > MAX_FIGURES) {
          skippedFigures += figureCount + regions.length - MAX_FIGURES;
          regions = regions.slice(0, Math.max(0, MAX_FIGURES - figureCount));
        }
        if (regions.length) {
          const images = await cutFigures(page, regions);
          regions.forEach((r, i) => {
            const image = figureFile(n, i + 1);
            files[image] = images[i];
            const round = (v: number) => Math.round(v * 10) / 10;
            figures.push({ id: `p${n}-${i + 1}`, page: n, caption: r.caption, kind: r.kind, bbox: [round(r.x0), round(r.y0), round(r.x1), round(r.y1)], image });
          });
          figureCount += regions.length;
          if (kind === "text") kind = "text+figures";
        }
      }
      pages.push({ lines, figures, analysis: { kind, chars, imageCoverage: Math.round(ops.imageCoverage * 100) / 100, vector: ops.paths >= VECTOR_OPS, invisibleText: ops.invisibleText, garbled, needsImage } });
      page.cleanup();
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
  if (skippedFigures) warnings.push(`${skippedFigures} more figure region(s) were not cut out (limit ${MAX_FIGURES_PER_PAGE} per page, ${MAX_FIGURES} per document).`);
  // Body font size: the most common line size across the document.
  const bodySize = median(pages.flatMap((p) => p.lines.filter((l) => l.text.length > 40).map((l) => Math.round(l.size * 2) / 2)));
  const parts: ConvertedPart[] = pages.map(({ lines, analysis, figures }, i) => {
    const n = i + 1;
    let markdown = analysis.garbled ? "" : linesToMarkdown(lines, bodySize);
    if (analysis.invisibleText) markdown = `_Text from the OCR layer of a scanned page: it may contain recognition errors._\n\n${markdown}`;
    if (analysis.needsImage) markdown = `${imageOnlyNote("page", n, analysis.kind)}${markdown && !analysis.garbled ? `\n\n${markdown}` : ""}`;
    if (analysis.kind === "blank") markdown = "_Blank page._";
    if (figures.length) {
      const list = figures.map((f) => `- \`${f.id}\` — ${f.caption ?? `_(no caption; ${f.kind === "image" ? "image" : f.kind === "drawing" ? "drawing / chart" : "image with drawings"})_`}`);
      markdown += `\n\n**Figures on this page** (look at them with read_reference_figures):\n\n${list.join("\n")}`;
    }
    return { n, markdown, ...analysis, figures };
  });
  const count = (k: PageKind) => parts.filter((p) => p.kind === k).length;
  if (count("scan")) warnings.push(`${count("scan")} scanned page(s)${parts.some((p) => p.invisibleText) ? " (some with a scanner OCR layer)" : ""}.`);
  if (parts.some((p) => p.garbled)) warnings.push(`Unreadable text layer (broken font encoding) on page(s) ${parts.filter((p) => p.garbled).map((p) => p.n).join(", ")}: use the page images.`);
  return { unit: "page", parts, warnings, files, converter: `pdfjs-dist ${(await pdfjs()).version}` };
}

/** Renders pages as WebP images about `width` pixels wide. Returns page number → image bytes. */
export async function renderPdfPages(data: Uint8Array, pages: number[], width = 1100): Promise<Map<number, Buffer>> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const pdf = await openPdf(data);
  const out = new Map<number, Buffer>();
  try {
    for (const n of pages) {
      if (n < 1 || n > pdf.numPages) continue;
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, width / base.width) });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
      out.set(n, await canvas.encode("webp", 82));
      page.cleanup();
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
  return out;
}

export async function pdfPageCount(data: Uint8Array): Promise<number> {
  const pdf = await openPdf(data);
  const n = pdf.numPages;
  await pdf.loadingTask.destroy();
  return n;
}
