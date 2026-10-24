import {
  assistantView,
  mcpKindOf,
  parsePartRange,
  type McpContent,
  type McpInfo,
  type ReferenceNode,
} from "@sourcebook/shared";
import { z } from "zod";
import { projectLabel } from "../refs.js";
import { READ, WRITE, agentParam, projectParam, run, runContent, type ToolContext } from "./common.js";

/** Characters of text returned per call (the rest is available with `parts`). */
const MAX_TEXT = 200_000;
/** Page images returned per call. */
const MAX_PAGES = 8;

const cleanPath = (p: string) => p.replace(/^\/+/, "").replace(/^references\//, "");
const pathParam = z.string().min(1).describe('Path inside references/, as in list_references, e.g. "papers/spec.pdf"');
const enc = (p: string) => encodeURIComponent(p);

/** Short description of how the assistant can read a file. */
export function mcpLabel(info: McpInfo | undefined): string {
  if (!info) return "";
  const n = info.parts ?? 0;
  const units = info.unit && info.unit !== "document" ? `${n} ${info.unit}${n === 1 ? "" : "s"}` : "";
  switch (info.status) {
    case "native":
      return info.kind === "image" ? "image" : "text";
    case "ready":
      return `Markdown${units ? `, ${units}` : ""}${info.figures ? `, ${info.figures} figure${info.figures === 1 ? "" : "s"} (read_reference_figures)` : ""}${info.imageOnlyParts ? `; ${info.imageOnlyParts} only as images (read_reference_pages)` : ""}`;
    case "stale":
      return "changed since its conversion: being converted again";
    case "pending":
    case "converting":
      return "being converted to Markdown";
    case "failed":
      return `conversion failed (${info.error ?? "unknown error"})`;
    case "unsupported":
      return "cannot be read";
  }
}

export function registerReferenceReadTools({ server, api, open }: ToolContext) {
  server.registerTool(
    "list_references",
    {
      title: "List reference files",
      description:
        "Lists the project's reference files (specs, papers, data… in references/) as a folder tree, with size and how each can be read: text, image, or Markdown converted from PDF/Office/OpenDocument/EPUB… (with the number of pages/slides/sheets).",
      inputSchema: { project: projectParam },
      annotations: READ,
    },
    run(async ({ project }) => {
      const nb = await open(project);
      const tree = await api.json<ReferenceNode>("GET", `${nb.base}/references`);
      const out: string[] = [];
      const walk = (n: ReferenceNode, depth: number) => {
        for (const c of n.children ?? []) {
          out.push(`${"  ".repeat(depth)}${c.kind === "dir" ? `${c.name}/` : `${c.name} (${c.size ?? 0} bytes) — path "${c.path}" — ${mcpLabel(c.mcp)}`}`);
          if (c.kind === "dir") walk(c, depth + 1);
        }
      };
      walk(tree, 0);
      return out.length ? `references/ of ${projectLabel(nb.project)}:\n${out.join("\n")}` : "No reference files.";
    }),
  );

  server.registerTool(
    "read_reference",
    {
      title: "Read a reference file",
      description:
        "Reads a reference file by its path from list_references. Text files are returned as they are; images are returned as images; documents (PDF, Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, HTML, Jupyter, email, ZIP) are returned as Markdown converted by Sourcebook, split into pages/slides/sheets — pass parts (e.g. \"3-5\") to read only some. Pages that are scans or diagrams are marked: read them with read_reference_pages.",
      inputSchema: {
        project: projectParam,
        path: pathParam,
        parts: z.string().optional().describe('Converted documents: pages/slides/sheets/chapters to read, e.g. "2", "1-3", "1,4,7-9"'),
      },
      annotations: READ,
    },
    runContent(async ({ project, path, parts }) => {
      const nb = await open(project);
      const clean = cleanPath(path);
      const kind = mcpKindOf(clean);
      if (kind === "text") {
        const { text } = await api.text(`${nb.base}/references/file/${clean.split("/").map(enc).join("/")}`);
        return [{ type: "text", text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n\n[truncated: first ${MAX_TEXT} of ${text.length} characters]` : text }];
      }
      if (kind === "image") {
        const img = await api.bytes(`${nb.base}/references/mcp/image?path=${enc(clean)}`);
        return [
          { type: "text", text: `references/${clean} (image):` },
          { type: "image", data: img.base64, mimeType: img.contentType || "image/webp" },
        ];
      }
      if (kind === "unsupported") {
        return [{ type: "text", text: `references/${clean} is in a format Sourcebook cannot convert; its content cannot be read (the user can open it in the References view).` }];
      }
      // Converted document: convert now if needed (up-to-date conversions are reused).
      const { results } = await api.json<{ results: (McpInfo & { path: string })[] }>("POST", `${nb.base}/references/mcp/convert`, { paths: [clean] });
      const info = results[0];
      if (!info) throw new Error(`references/${clean} not found`);
      if (info.status === "failed") return [{ type: "text", text: `references/${clean} could not be converted to Markdown: ${info.error}` }];
      const content = await api.json<McpContent>("GET", `${nb.base}/references/mcp?path=${enc(clean)}`);
      let selected: number[] | undefined;
      if (parts) {
        selected = parsePartRange(parts, content.manifest.parts.length) ?? undefined;
        if (!selected?.length) throw new Error(`Invalid parts "${parts}": use numbers between 1 and ${content.manifest.parts.length}, e.g. "1-3" or "2,5"`);
      }
      const text = assistantView(clean, content, selected);
      return [
        {
          type: "text",
          text:
            text.length > MAX_TEXT
              ? `${text.slice(0, MAX_TEXT)}\n\n[truncated: first ${MAX_TEXT} of ${text.length} characters — read the rest with parts]`
              : text,
        },
      ];
    }),
  );

  server.registerTool(
    "read_reference_pages",
    {
      title: "See pages of a reference PDF",
      description: `Returns pages of a reference PDF as images (up to ${MAX_PAGES} per call), for scans, figures, tables, formulas or diagrams the Markdown cannot show. Images are rendered on first request.`,
      inputSchema: { project: projectParam, path: pathParam, pages: z.string().describe('Pages, e.g. "3", "2-4", "1,5"') },
      annotations: READ,
    },
    runContent(async ({ project, path, pages }) => {
      const nb = await open(project);
      const clean = cleanPath(path);
      if (mcpKindOf(clean) === "image") return [{ type: "text", text: `references/${clean} is an image: read it with read_reference.` }];
      if (!/\.pdf$/i.test(clean)) return [{ type: "text", text: `Page images are available for PDF files; read references/${clean} with read_reference.` }];
      const { manifest } = await api.json<{ manifest: McpContent["manifest"] }>("POST", `${nb.base}/references/mcp/pages`, { path: clean, pages: [] });
      const wanted = parsePartRange(pages, manifest.parts.length);
      if (!wanted?.length) throw new Error(`Invalid pages "${pages}": the PDF has ${manifest.parts.length} pages`);
      const chosen = wanted.slice(0, MAX_PAGES);
      await api.json("POST", `${nb.base}/references/mcp/pages`, { path: clean, pages: chosen });
      const content: Awaited<ReturnType<Parameters<typeof runContent>[0]>> = [];
      for (const n of chosen) {
        const img = await api.bytes(`${nb.base}/references/mcp/page?path=${enc(clean)}&n=${n}`);
        const part = manifest.parts.find((p) => p.n === n);
        content.push({ type: "text", text: `Page ${n} of references/${clean}${part?.kind ? ` (${part.kind})` : ""}:` });
        content.push({ type: "image", data: img.base64, mimeType: img.contentType || "image/webp" });
      }
      if (wanted.length > chosen.length) content.push({ type: "text", text: `Showing ${chosen.length} of ${wanted.length} pages: ask for the next ones separately.` });
      return content;
    }),
  );
}

/** Figures returned per call. */
const MAX_FIGURES = 10;

export function registerReferenceFigureTool({ server, api, open }: ToolContext) {
  server.registerTool(
    "read_reference_figures",
    {
      title: "See figures of a reference PDF",
      description: `Returns figures (images, charts, diagrams, graphic tables) cut out of a reference PDF, with their captions — up to ${MAX_FIGURES} per call. The converted text (read_reference) lists each page's figures with their ids.`,
      inputSchema: {
        project: projectParam,
        path: pathParam,
        figures: z.string().optional().describe('Figure ids from read_reference, e.g. "p3-1" or "p3-1,p5-2"'),
        pages: z.string().optional().describe('Or all figures of some pages, e.g. "3-5"'),
      },
      annotations: READ,
    },
    runContent(async ({ project, path, figures, pages }) => {
      const nb = await open(project);
      const clean = cleanPath(path);
      if (!/\.pdf$/i.test(clean)) return [{ type: "text", text: `Figures are extracted from PDF files; read references/${clean} with read_reference.` }];
      await api.json("POST", `${nb.base}/references/mcp/convert`, { paths: [clean] });
      const { manifest } = await api.json<McpContent>("GET", `${nb.base}/references/mcp?path=${enc(clean)}`);
      const all = manifest.parts.flatMap((p) => p.figures ?? []);
      if (!all.length) return [{ type: "text", text: `No figures were found in references/${clean}. Pages without text can be seen with read_reference_pages.` }];
      let chosen = all;
      if (figures) {
        const ids = figures.split(/[\s,]+/).filter(Boolean);
        const unknown = ids.filter((id) => !all.some((f) => f.id === id));
        if (unknown.length) throw new Error(`Unknown figure(s) ${unknown.join(", ")}; available: ${all.map((f) => f.id).join(", ")}`);
        chosen = all.filter((f) => ids.includes(f.id));
      } else if (pages) {
        const wanted = parsePartRange(pages, manifest.parts.length);
        if (!wanted) throw new Error(`Invalid pages "${pages}"`);
        chosen = all.filter((f) => wanted.includes(f.page));
      }
      const content: Awaited<ReturnType<Parameters<typeof runContent>[0]>> = [];
      for (const f of chosen.slice(0, MAX_FIGURES)) {
        const img = await api.bytes(`${nb.base}/references/mcp/figure?path=${enc(clean)}&id=${f.id}`);
        content.push({ type: "text", text: `Figure ${f.id} (page ${f.page}) of references/${clean}${f.caption ? ` — ${f.caption}` : " (no caption)"}` });
        content.push({ type: "image", data: img.base64, mimeType: img.contentType || "image/webp" });
      }
      if (!content.length) content.push({ type: "text", text: `No figures on those pages; figures are on pages ${[...new Set(all.map((f) => f.page))].join(", ")}.` });
      if (chosen.length > MAX_FIGURES) content.push({ type: "text", text: `Showing ${MAX_FIGURES} of ${chosen.length} figures: ask for the others by id.` });
      return content;
    }),
  );
}

export function registerReferenceWriteTools({ server, api, open, as }: ToolContext) {
  server.registerTool(
    "move_references",
    {
      title: "Move reference files",
      description:
        "Moves reference files and/or folders into another folder of references/ (keeping their names). Associations with sections/sub-blocks and links in the text follow. Fails without moving anything if a name already exists there.",
      inputSchema: {
        project: projectParam,
        paths: z.array(pathParam).min(1).max(500),
        to: z.string().describe('Destination folder inside references/ (it must exist), "" for references/ itself'),
      },
      annotations: WRITE,
    },
    run(async ({ project, paths, to }) => {
      const nb = await open(project);
      const { moved } = await api.json<{ moved: { from: string; to: string }[] }>("POST", `${nb.base}/references/move`, {
        paths: paths.map(cleanPath),
        dir: cleanPath(to).replace(/\/+$/, ""),
      });
      return moved.length ? moved.map((m) => `Moved references/${m.from} → references/${m.to}`).join("\n") : "Nothing moved: already in that folder.";
    }),
  );

  server.registerTool(
    "save_reference_transcription",
    {
      title: "Save the transcription of a page",
      description:
        "After reading a page image (read_reference_pages) of a scan or diagram, saves its content as Markdown so later reads (and search) get the text. Replaces the text of that page in the converted document; the file itself is not modified.",
      inputSchema: {
        project: projectParam,
        path: pathParam,
        page: z.number().int().positive().describe("Page (or slide/sheet) number"),
        markdown: z.string().min(1).describe("Faithful transcription of the page (tables as Markdown tables, formulas in LaTeX, figures described briefly)"),
        agent: agentParam,
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run(async ({ project, path, page, markdown, agent }) => {
      const author = as(agent);
      const nb = await open(project);
      const clean = cleanPath(path);
      await api.json("PUT", `${nb.base}/references/mcp/transcription`, { path: clean, page, markdown, by: author.name });
      return `Saved the transcription of page ${page} of references/${clean}.`;
    }),
  );
}
