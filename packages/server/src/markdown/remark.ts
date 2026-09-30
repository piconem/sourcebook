import { existsSync } from "node:fs";
import { basename, join, posix } from "node:path";
import type { Heading, Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { generateTextCitation, type ValidationResult } from "@sourcebook/shared";
import type { BibliographyStore } from "../store/BibliographyStore.js";

/** Name of the BibTeX file added to export archives. */
export const BIB_EXPORT_FILE = "bibliography.bib";
import { BLOCKS_DIR, SUBBLOCKS_DIR, type NotebookStore } from "../store/NotebookStore.js";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const stringifier = unified().use(remarkStringify, { bullet: "-", emphasis: "_" }).use(remarkGfm).use(remarkMath);

export const parseMarkdown = (md: string): Root => parser.parse(md);
export const stringifyMarkdown = (tree: Root): string => stringifier.stringify(tree);

/** Structural checks on a Markdown sub-block, performed on the mdast rather than raw text. */
export function validateMarkdown(md: string): ValidationResult {
  const errors: string[] = [];
  const walk = (node: RootContent | Root) => {
    if (node.type === "html" && /<script\b/i.test(node.value)) errors.push("Inline <script> is not allowed");
    if ("children" in node) (node.children as RootContent[]).forEach(walk);
  };
  walk(parseMarkdown(md));
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Objective as an HTML comment: kept in the file, hidden when rendered. Sequences that would end
 * the comment early are broken up.
 */
export function objectiveComment(text: string): RootContent {
  const safe = text.trim().replace(/--+/g, (m) => m.split("").join(" ")).replace(/-$/, "- ");
  const body = safe.includes("\n") ? `\n${safe}\n` : ` ${safe} `;
  return { type: "html", value: `<!-- Objective:${body}-->` };
}

/** "Attachments: [a.pdf](references/a.pdf), …" for reference files associated with a section or sub-block. */
function attachments(paths: string[] | undefined): RootContent[] {
  if (!paths?.length) return [];
  const children: RootContent[] = [{ type: "emphasis", children: [{ type: "text", value: "Attachments:" }] }, { type: "text", value: " " }];
  paths.forEach((p, i) => {
    if (i) children.push({ type: "text", value: ", " });
    const url = `references/${p.split("/").map(encodeURIComponent).join("/")}`;
    children.push({ type: "link", url, children: [{ type: "text", value: p.split("/").pop()! }] } as RootContent);
  });
  return [{ type: "paragraph", children } as RootContent];
}

const clampDepth = (d: number) => Math.min(6, Math.max(1, d)) as Heading["depth"];

function shiftHeadings(nodes: RootContent[], by: number) {
  for (const node of nodes) {
    if (node.type === "heading") node.depth = clampDepth(node.depth + by);
    if ("children" in node) shiftHeadings(node.children as RootContent[], by);
  }
}

export interface CompiledProject {
  /** Suggested file name, e.g. "my-project.md". */
  fileName: string;
  markdown: string;
  /** Project-relative paths of local files referenced by the document (images, exports). */
  files: string[];
  /** Files produced for the export only (e.g. the bibliography as .bib). */
  generated: string[];
}

/** Local, project-relative image targets that exist on disk. */
function collectLocalFiles(tree: Root, root: string): string[] {
  const files = new Set<string>();
  const walk = (node: Root | RootContent) => {
    if ((node.type === "image" || node.type === "link" || node.type === "definition") && isLocal(node.url)) {
      const path = posix.normalize(decodeURI(node.url.split(/[?#]/)[0]));
      if (!path.startsWith("..") && existsSync(join(root, path))) files.add(path);
    }
    if ("children" in node) (node.children as RootContent[]).forEach(walk);
  };
  walk(tree);
  return [...files].sort();
}

/** Rewrites local link/image targets of a fragment from `baseDir`-relative to project-relative. */
function rebaseLocalUrls(nodes: RootContent[], baseDir: string) {
  for (const node of nodes) {
    if ((node.type === "image" || node.type === "link" || node.type === "definition") && isLocal(node.url)) {
      const [path, suffix = ""] = node.url.split(/(?=[?#])/);
      if (path) node.url = posix.normalize(posix.join(baseDir, path)) + suffix;
    }
    if ("children" in node) rebaseLocalUrls(node.children as RootContent[], baseDir);
  }
}

const isLocal = (url: string) => !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("/") && !url.startsWith("#");

/**
 * Compiles the whole notebook into one Markdown document: one heading per Block (depth follows
 * nesting), each sub-block's fragment parsed into mdast with its headings shifted below the
 * section heading. Non-text sub-blocks reference their exported artifacts.
 */
export async function compileProject(store: NotebookStore, bib?: BibliographyStore): Promise<CompiledProject> {
  const project = store.getProject();
  // Bibliography keys in order of first use (bib: links in text, associated sections/sub-blocks).
  const cited: string[] = [];
  const cite = (key: string) => !cited.includes(key) && cited.push(key);
  const linkCitations = (nodes: RootContent[]) => {
    for (const node of nodes) {
      if (node.type === "link" && node.url.startsWith("bib:")) {
        const key = node.url.slice(4);
        cite(key);
        node.url = `#ref-${key}`;
      }
      if ("children" in node) linkCitations(node.children as RootContent[]);
    }
  };
  const root: Root = {
    type: "root",
    children: [{ type: "heading", depth: 1, children: [{ type: "text", value: project.name }] }],
  };
  for (const entry of project.blocks) {
    const block = await store.getBlock(entry.id);
    const sectionDepth = clampDepth(store.depth(entry.id) + 2);
    root.children.push({ type: "heading", depth: sectionDepth, children: [{ type: "text", value: block.title }] });
    if (block.objective) root.children.push(objectiveComment(block.objective));
    block.citations?.forEach(cite);
    root.children.push(...attachments(block.references));
    const blockDir = `${BLOCKS_DIR}/${entry.folder}`;
    for (const sub of block.subBlocks) {
      const def = store.registry.get(sub.type);
      if (!def) continue;
      const fragment = def.toMarkdown(sub.content, { ref: sub, blockDir, subBlocksDir: `${blockDir}/${SUBBLOCKS_DIR}` });
      const tree = parseMarkdown(fragment);
      // A titled sub-block becomes a sub-heading; its own headings nest below it.
      let contentDepth: number = sectionDepth;
      if (sub.title) {
        contentDepth = clampDepth(sectionDepth + 1);
        root.children.push({
          type: "heading",
          depth: contentDepth as Heading["depth"],
          children: [{ type: "text", value: sub.title }],
        });
      }
      if (sub.objective) root.children.push(objectiveComment(sub.objective));
      shiftHeadings(tree.children, contentDepth);
      rebaseLocalUrls(tree.children, `${blockDir}/${SUBBLOCKS_DIR}`);
      linkCitations(tree.children);
      sub.citations?.forEach(cite);
      root.children.push(...tree.children, ...attachments(sub.references));
    }
  }
  const entries = bib ? await bib.list() : [];
  if (cited.length) {
    root.children.push({ type: "heading", depth: 2, children: [{ type: "text", value: "References" }] });
    for (const key of cited) {
      const e = entries.find((x) => x.key === key);
      const text = e ? e.textCitation?.trim() || generateTextCitation(e) : `${key} (not in the bibliography)`;
      // Parsed as Markdown so URLs and emphasis in the citation stay live (not escaped text).
      const para = parseMarkdown(text).children.find((n) => n.type === "paragraph");
      const inline = para && "children" in para ? para.children : [{ type: "text" as const, value: text }];
      root.children.push({ type: "paragraph", children: [{ type: "html", value: `<a id="ref-${key}"></a>` }, ...inline] });
    }
  }
  return {
    fileName: `${basename(store.root)}.md`,
    markdown: stringifyMarkdown(root),
    files: collectLocalFiles(root, store.root),
    generated: entries.length ? [BIB_EXPORT_FILE] : [],
  };
}
