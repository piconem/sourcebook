import {
  outlineNumbers,
  withDepth,
  type Block,
  type CommentView,
  type Project,
  type SubBlock,
  type SubBlockRef,
} from "@sourcebook/shared";
import type { SourcebookApi } from "./api.js";
import { RefError, parseRef, projectLabel, projectPath, uriOf, type LineRange, type ParsedRef, type ProjectRef } from "./refs.js";

type Entry = Project["blocks"][number];

export type Resolved =
  | { kind: "section"; entry: Entry }
  | { kind: "subblock"; entry: Entry; ref: SubBlockRef; index: number; lines?: LineRange }
  | { kind: "comment"; entry: Entry; ref: SubBlockRef; index: number; comment: CommentView; replyId?: string };

/** Types whose content is plain source text the assistant can read and write. */
export const TEXT_TYPES = ["markdown", "code", "mermaid", "equation"] as const;
export type TextType = (typeof TEXT_TYPES)[number];

/** Source text of a sub-block (what line numbers and text edits refer to), or null for non-text types. */
export function sourceText(sub: { type: string; content: unknown }): string | null {
  const c = sub.content as Record<string, unknown>;
  switch (sub.type) {
    case "markdown":
      return String(c.markdown ?? "");
    case "code":
    case "mermaid":
      return String(c.code ?? "");
    case "equation":
      return String(c.latex ?? "");
    default:
      return null;
  }
}

/** Content object for a text type from its source text. */
export function contentFor(type: string, text: string, opts: { language?: string; existing?: unknown } = {}): unknown {
  switch (type) {
    case "markdown":
      return { markdown: text };
    case "code":
      return { language: opts.language ?? (opts.existing as { language?: string } | undefined)?.language ?? "plaintext", code: text };
    case "mermaid":
      return { code: text };
    case "equation":
      return { latex: text };
    default:
      throw new RefError(`${type} sub-blocks cannot be written as text (supported: ${TEXT_TYPES.join(", ")}).`);
  }
}

export function withLineNumbers(text: string, from = 1, to = Number.POSITIVE_INFINITY): string {
  const lines = text.replace(/\n$/, "").split("\n");
  const width = String(Math.min(lines.length, to)).length;
  return lines
    .map((l, i) => [i + 1, l] as const)
    .filter(([n]) => n >= from && n <= to)
    .map(([n, l]) => `${String(n).padStart(width)} | ${l}`)
    .join("\n");
}

const lineCount = (text: string) => (text === "" ? 0 : text.replace(/\n$/, "").split("\n").length);

/** Short, human description of non-text sub-blocks. */
function describeNonText(sub: { type: string; content: unknown }): string {
  const c = sub.content as Record<string, unknown>;
  if (sub.type === "image") {
    return c.src ? `Image ${c.src}${c.alt ? ` — alt: "${c.alt}"` : ""}${c.caption ? ` — caption: "${c.caption}"` : ""}` : "Empty image (no file uploaded yet)";
  }
  if (sub.type === "drawing") {
    const elements = ((c.elements as { isDeleted?: boolean; type?: string; text?: string }[]) ?? []).filter((e) => !e.isDeleted);
    const texts = elements.filter((e) => e.type === "text" && e.text).map((e) => `"${e.text}"`);
    return `Excalidraw drawing with ${elements.length} element(s)${texts.length ? `; texts: ${texts.join(", ")}` : ""}`;
  }
  return `${sub.type} sub-block`;
}

/**
 * A loaded project/template with its outline numbering, able to resolve references and to format
 * sections and sub-blocks for the assistant.
 */
export class NotebookView {
  readonly numbers: Map<string, string>;
  readonly depth: Map<string, number>;
  private blockCache = new Map<string, Promise<Block>>();

  private constructor(
    readonly api: SourcebookApi,
    readonly project: ProjectRef,
    readonly data: Project,
  ) {
    const flat = withDepth(data.blocks);
    this.numbers = outlineNumbers(flat);
    this.depth = new Map(flat.map((f) => [f.id, f.depth]));
  }

  static async load(api: SourcebookApi, project: ProjectRef): Promise<NotebookView> {
    return new NotebookView(api, project, await api.json<Project>("GET", `${projectPath(project)}/notebook`));
  }

  get base() {
    return projectPath(this.project);
  }

  block(id: string): Promise<Block> {
    let b = this.blockCache.get(id);
    if (!b) this.blockCache.set(id, (b = this.api.json<Block>("GET", `${this.base}/blocks/${id}`)));
    return b;
  }

  entryByNumber(number: string): Entry {
    const e = this.data.blocks.find((b) => this.numbers.get(b.id) === number);
    if (!e) throw new RefError(`There is no section §${number} in ${projectLabel(this.project)} (it has ${this.data.blocks.length} sections; call get_outline).`);
    return e;
  }

  // ---- labels ----
  num(entry: { id: string }) {
    return `§${this.numbers.get(entry.id)}`;
  }
  sectionLabel(entry: Entry) {
    return `${this.num(entry)} "${entry.title}" (id ${entry.id})`;
  }
  subRef(entry: Entry, index: number) {
    return `${this.num(entry)}#${index}`;
  }
  subLabel(entry: Entry, ref: SubBlockRef, index: number) {
    return `${this.subRef(entry, index)} ${ref.type}${ref.title ? ` "${ref.title}"` : ""} (id ${ref.id})`;
  }
  sectionUri(entry: Entry) {
    return uriOf(this.project, "sections", entry.id);
  }
  subUri(ref: SubBlockRef) {
    return uriOf(this.project, "subblocks", ref.id);
  }

  // ---- resolution ----
  async resolve(input: string | ParsedRef): Promise<Resolved> {
    const parsed = typeof input === "string" ? parseRef(input) : input;
    if (parsed.project && (parsed.project.kind !== this.project.kind || parsed.project.id !== this.project.id)) {
      throw new RefError(`The reference points to ${projectLabel(parsed.project)}, not ${projectLabel(this.project)}: pass project "${projectLabel(parsed.project)}".`);
    }
    if (parsed.kind === "outline") {
      const entry = this.entryByNumber(parsed.number);
      if (parsed.subIndex === undefined) return { kind: "section", entry };
      const ref = entry.subBlocks[parsed.subIndex - 1];
      if (!ref) throw new RefError(`${this.num(entry)} has ${entry.subBlocks.length} sub-block(s); there is no #${parsed.subIndex}.`);
      if (parsed.commentId) return this.findComment(parsed.commentId, ref.id);
      return { kind: "subblock", entry, ref, index: parsed.subIndex, lines: parsed.lines };
    }
    const entry = this.data.blocks.find((b) => b.id === parsed.id);
    if (entry) {
      if (parsed.lines) throw new RefError("Line ranges apply to sub-blocks, not sections.");
      return { kind: "section", entry };
    }
    for (const e of this.data.blocks) {
      const i = e.subBlocks.findIndex((s) => s.id === parsed.id);
      if (i >= 0) return { kind: "subblock", entry: e, ref: e.subBlocks[i], index: i + 1, lines: parsed.lines };
    }
    return this.findComment(parsed.id);
  }

  async resolveSection(input: string): Promise<Entry> {
    const r = await this.resolve(input);
    if (r.kind !== "section") throw new RefError(`"${input}" is not a section (it is a ${r.kind}); use a reference like §2.1.`);
    return r.entry;
  }

  async resolveSubBlock(input: string) {
    const r = await this.resolve(input);
    if (r.kind !== "subblock") throw new RefError(`"${input}" is not a sub-block (it is a ${r.kind}); use a reference like §2.1#3.`);
    return r;
  }

  /** Finds a comment or reply by id (optionally within one sub-block). */
  async findComment(id: string, inSubBlock?: string): Promise<Extract<Resolved, { kind: "comment" }>> {
    for (const entry of this.data.blocks) {
      const block = await this.block(entry.id);
      for (const [i, sub] of block.subBlocks.entries()) {
        if (inSubBlock && sub.id !== inSubBlock) continue;
        if (!sub.commentCount) continue;
        const comments = await this.comments(entry.id, sub.id);
        for (const c of comments) {
          const reply = c.replies.find((r) => r.id === id);
          if (c.id === id || reply) return { kind: "comment", entry, ref: entry.subBlocks[i], index: i + 1, comment: c, replyId: reply?.id };
        }
      }
    }
    throw new RefError(`Nothing with id "${id}" in ${projectLabel(this.project)} (no section, sub-block or comment). Call get_outline or list_comments.`);
  }

  comments(blockId: string, subBlockId: string) {
    return this.api
      .json<{ comments: CommentView[] }>("GET", `${this.base}/blocks/${blockId}/subblocks/${subBlockId}/comments`)
      .then((r) => r.comments);
  }

  // ---- formatting ----
  /** The outline: every section (numbered, with objective) and a summary line per sub-block. */
  async outline(opts: { previews: boolean }): Promise<string> {
    const subBlocks = this.data.blocks.reduce((n, b) => n + b.subBlocks.length, 0);
    const lines = [
      `${this.project.kind === "templates" ? "Template" : "Project"} "${this.data.name}" — ${projectLabel(this.project)} — ${this.data.blocks.length} sections, ${subBlocks} sub-blocks`,
      "",
    ];
    if (!this.data.blocks.length) lines.push("(no sections yet — create_section adds one)");
    for (const entry of this.data.blocks) {
      const indent = "  ".repeat(this.depth.get(entry.id) ?? 0);
      const block = await this.block(entry.id);
      lines.push(`${indent}${this.num(entry)} ${entry.title}  (id ${entry.id})`);
      if (block.objective) lines.push(`${indent}   objective: ${block.objective}`);
      for (const [i, sub] of block.subBlocks.entries()) lines.push(`${indent}   ${this.subSummary(entry, sub, i + 1, opts.previews)}`);
    }
    return lines.join("\n");
  }

  subSummary(entry: Entry, sub: SubBlock, index: number, preview: boolean): string {
    const text = sourceText(sub);
    const bits = [`#${index} ${sub.type}${sub.type === "code" ? `/${(sub.content as { language?: string }).language}` : ""}`];
    if (sub.title) bits.push(`"${sub.title}"`);
    bits.push(text !== null ? `${lineCount(text)} line${lineCount(text) === 1 ? "" : "s"}` : describeNonText(sub));
    if (sub.commentCount) bits.push(`💬 ${sub.commentCount}`);
    bits.push(`rev ${sub.rev ?? 0}`, `id ${sub.id}`);
    let line = bits.join(" · ");
    if (sub.objective) line += `\n${" ".repeat(6)}objective: ${sub.objective}`;
    if (preview && text) {
      const first = text.split("\n").find((l) => l.trim()) ?? "";
      line += `\n${" ".repeat(6)}> ${first.length > 100 ? `${first.slice(0, 100)}…` : first}`;
    }
    return line;
  }

  /** Full view of one sub-block. */
  formatSubBlock(entry: Entry, sub: SubBlock, index: number, opts: { lineNumbers: boolean; lines?: LineRange }): string {
    const header = [
      `${this.subLabel(entry, sub, index)} in ${this.sectionLabel(entry)}`,
      `uri: ${this.subUri(sub)} · rev ${sub.rev ?? 0}${sub.type === "code" ? ` · language ${(sub.content as { language?: string }).language}` : ""}${sub.commentCount ? ` · ${sub.commentCount} comment thread(s) (list_comments)` : ""}`,
    ];
    if (sub.objective) header.push(`objective: ${sub.objective}`);
    const text = sourceText(sub);
    if (text === null) return [...header, "", describeNonText(sub)].join("\n");
    const from = opts.lines?.first ?? 1;
    const to = opts.lines?.last ?? Number.POSITIVE_INFINITY;
    const body = opts.lineNumbers || opts.lines ? withLineNumbers(text, from, to) : text.replace(/\n$/, "");
    const range = opts.lines ? ` (lines ${from}-${Math.min(to, lineCount(text))} of ${lineCount(text)})` : ` (${lineCount(text)} lines)`;
    return [...header, "", `--- ${sub.type} source${range} ---`, body || "(empty)", "--- end ---"].join("\n");
  }

  async formatSection(entry: Entry, opts: { lineNumbers: boolean }): Promise<string> {
    const block = await this.block(entry.id);
    const children = this.data.blocks.filter((b) => b.parentId === entry.id);
    const out = [`${this.sectionLabel(entry)} — uri: ${this.sectionUri(entry)}`];
    if (block.objective) out.push(`objective: ${block.objective}`);
    if (children.length) out.push(`sub-sections: ${children.map((c) => `${this.num(c)} ${c.title}`).join(", ")}`);
    out.push(`${block.subBlocks.length} sub-block(s)`);
    for (const [i, sub] of block.subBlocks.entries()) out.push("", this.formatSubBlock(entry, sub, i + 1, { lineNumbers: opts.lineNumbers }));
    return out.join("\n");
  }

  formatComment(entry: Entry, index: number, c: CommentView): string {
    const where = c.anchor
      ? c.resolved
        ? `${this.subRef(entry, index)}:L${c.resolved.lines.first}${c.resolved.lines.last !== c.resolved.lines.first ? `-${c.resolved.lines.last}` : ""}`
        : `${this.subRef(entry, index)} (DETACHED: the quoted text is gone)`
      : `${this.subRef(entry, index)} (whole sub-block)`;
    const who = (a: CommentView["author"]) => `${a.name} (@${a.username}${a.kind === "assistant" ? ", assistant" : ""})`;
    const out = [`[comment ${c.id}] ${where} — ${who(c.author)}, ${c.createdAt}`];
    if (c.anchor) out.push(`  quote: "${c.anchor.exact.length > 200 ? `${c.anchor.exact.slice(0, 200)}…` : c.anchor.exact}"`);
    out.push(...c.text.split("\n").map((l) => `  ${l}`));
    for (const r of c.replies) {
      out.push(`  ↳ [reply ${r.id}] ${who(r.author)}, ${r.createdAt}`);
      out.push(...r.text.split("\n").map((l) => `     ${l}`));
    }
    return out.join("\n");
  }
}
