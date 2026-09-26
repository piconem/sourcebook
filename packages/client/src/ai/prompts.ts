/**
 * "Ask AI": builds a ready-to-paste request for an LLM connected to Sourcebook through MCP, pointing at an
 * exact element (document, section, sub-block, selection, comment thread or reference file).
 */
import type { NotebookKind } from "@sourcebook/shared";

export interface AiProject {
  kind: NotebookKind;
  id: string;
  name: string;
}

interface SubBlockInfo {
  /** Outline reference, e.g. "§2.1#3". */
  ref: string;
  id: string;
  type: string;
  title?: string;
}

export type AiTarget =
  | { kind: "document" }
  | { kind: "section"; number: string; id: string; title: string }
  | ({ kind: "subblock" } & SubBlockInfo)
  | ({ kind: "selection"; lines?: { first: number; last: number }; quote?: string } & SubBlockInfo)
  | ({ kind: "comment"; commentId: string; author: string; excerpt: string } & SubBlockInfo)
  | { kind: "reference"; path: string };

export type AiMode = "brainstorm" | "critique" | "build" | "improve" | "comment" | "custom";

export const MODES: { id: AiMode; label: string; hint: string; writes: boolean }[] = [
  { id: "brainstorm", label: "Brainstorming", hint: "Ideas, alternatives, open questions — no changes", writes: false },
  { id: "critique", label: "Critique", hint: "A critical review with prioritised issues — no changes", writes: false },
  { id: "build", label: "Build / Fill", hint: "Create or complete the content together", writes: true },
  { id: "improve", label: "Improve / Rewrite", hint: "Rewrite for clarity and correctness, with your approval", writes: true },
  { id: "comment", label: "Comment", hint: "Leave precise comments (or answer a thread)", writes: true },
  { id: "custom", label: "Custom prompt", hint: "Your own request about exactly this part", writes: false },
];

const TEXT_TYPES = new Set(["markdown", "code"]);
const EDITABLE_TYPES = new Set(["markdown", "code", "mermaid", "equation"]);

/** Which modes make sense for a target (see the table in docs/decisions.md). */
export function modesFor(target: AiTarget): AiMode[] {
  switch (target.kind) {
    case "document":
      return ["brainstorm", "critique", "build", "comment", "custom"];
    case "section":
      return ["brainstorm", "critique", "build", "improve", "comment", "custom"];
    case "subblock":
      return EDITABLE_TYPES.has(target.type)
        ? ["brainstorm", "critique", "build", "improve", "comment", "custom"]
        : ["brainstorm", "critique", "comment", "custom"];
    case "selection":
      return ["brainstorm", "critique", "build", "improve", "comment", "custom"];
    case "comment":
      return ["comment", "custom"];
    case "reference":
      return ["brainstorm", "critique", "custom"];
  }
}

/** Why a mode is not usable right now (null when it is). */
export function modeBlocked(mode: AiMode, opts: { readOnly: boolean }): string | null {
  const m = MODES.find((x) => x.id === mode)!;
  if (m.writes && opts.readOnly) return "The assistant has read-only access (Settings → AI assistant).";
  return null;
}

const projectArg = (p: AiProject) => (p.kind === "templates" ? `templates/${p.id}` : p.id);
const uri = (p: AiProject, what: string, id: string) => `sourcebook://${p.kind}/${p.id}/${what}/${id}`;
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const linesLabel = (l: { first: number; last: number }) => `L${l.first}${l.last !== l.first ? `-${l.last}` : ""}`;

/** Short reference string identifying the target for the MCP tools. */
export function referenceFor(p: AiProject, t: AiTarget): string {
  const where = `${p.kind === "templates" ? "template" : "project"} "${projectArg(p)}"`;
  switch (t.kind) {
    case "document":
      return `Sourcebook ${where} (whole document) · sourcebook://${p.kind}/${p.id}/outline`;
    case "section":
      return `Sourcebook ${where} · section §${t.number} "${t.title}" · id ${t.id} · ${uri(p, "sections", t.id)}`;
    case "subblock":
      return `Sourcebook ${where} · sub-block ${t.ref} (${t.type}${t.title ? ` "${t.title}"` : ""}) · id ${t.id} · ${uri(p, "subblocks", t.id)}`;
    case "selection":
      return t.lines
        ? `Sourcebook ${where} · lines ${t.ref}:${linesLabel(t.lines)} · sub-block id ${t.id} · ${uri(p, "subblocks", t.id)}#${linesLabel(t.lines)}`
        : `Sourcebook ${where} · text in ${t.ref}: "${truncate(t.quote ?? "", 200)}" · sub-block id ${t.id} · ${uri(p, "subblocks", t.id)}`;
    case "comment":
      return `Sourcebook ${where} · comment ${t.commentId} on ${t.ref} · ${uri(p, "comments", t.commentId)}`;
    case "reference":
      return `Sourcebook ${where} · reference file "references/${t.path}"`;
  }
}

/** Human description used inside the prompt. */
function describe(t: AiTarget): string {
  switch (t.kind) {
    case "document":
      return "the whole document";
    case "section":
      return `section §${t.number} "${t.title}"`;
    case "subblock":
      return `sub-block ${t.ref} (${t.type}${t.title ? `, "${t.title}"` : ""})`;
    case "selection":
      return t.lines ? `lines ${linesLabel(t.lines)} of sub-block ${t.ref}` : `the passage "${truncate(t.quote ?? "", 200)}" in sub-block ${t.ref}`;
    case "comment":
      return `the comment thread ${t.commentId} by ${t.author} on ${t.ref} ("${truncate(t.excerpt, 120)}")`;
    case "reference":
      return `the reference file references/${t.path}`;
  }
}

/** How the assistant should read the target first. */
function readStep(p: AiProject, t: AiTarget): string {
  const project = `project "${projectArg(p)}"`;
  switch (t.kind) {
    case "document":
      return `Read it with get_outline and read_document (${project}).`;
    case "section":
      return `Read it with read_section (${project}, section "§${t.number}" — id ${t.id}) and get_outline for context.`;
    case "subblock":
      return `Read it with read_subblock (${project}, subblock "${t.id}") and read_section for its context.`;
    case "selection":
      return t.lines
        ? `Read it with read_subblock (${project}, subblock "${t.id}:${linesLabel(t.lines)}"), and the whole sub-block for context.`
        : `Read the sub-block with read_subblock (${project}, subblock "${t.id}") and find the quoted passage.`;
    case "comment":
      return `Read it with list_comments (${project}, target "${t.id}") and read the sub-block with read_subblock.`;
    case "reference":
      return `Read it with read_reference (${project}, path "${t.path}"), and get_outline to relate it to the project.`;
  }
}

function modeInstructions(mode: AiMode, t: AiTarget): string {
  const what = describe(t);
  const commentHow =
    t.kind === "subblock" && !TEXT_TYPES.has(t.type)
      ? "with add_comment on the whole sub-block"
      : t.kind === "selection"
        ? t.lines
          ? `with add_comment anchored to those lines`
          : `with add_comment using the quoted passage as quote`
        : "with add_comment, attached to the precise lines or quoted text they refer to (not to whole sub-blocks unless needed)";
  switch (mode) {
    case "brainstorm":
      return `Let's brainstorm about ${what}. Propose ideas, alternatives, missing aspects and open questions, grouped and prioritised, each with a short rationale. Do not modify anything in Sourcebook; ask me before turning any idea into content.`;
    case "critique":
      return `Critically review ${what}: check it against its objective and the rest of the document for clarity, correctness, completeness, consistency and risks. Answer with a prioritised list of issues, each with its precise location (§x#n:Lk) and a suggested fix. Do not change the content.`;
    case "build":
      return t.kind === "document"
        ? `Help me build out the document: find placeholders ("[…]", guidance in italics) and empty sections with search and get_outline, ask me the questions you need, then write the content with edit_subblock_text or add_subblock. Proceed one section at a time and tell me what you changed with references.`
        : t.kind === "section"
          ? `Help me build out ${what}: from its objective and the surrounding sections, propose the content (text, diagrams, code…), ask me for missing information, then create or complete its sub-blocks with add_subblock and edit_subblock_text. Tell me what you changed with references.`
          : `Complete ${what}: replace placeholders and expand it according to its objective and context. Ask me what you need to know first, then apply precise edits with edit_subblock_text (pass expectedRev) and summarise the changes.`;
    case "improve":
      return `Improve ${what} for clarity, concision and correctness, keeping its meaning and my intent${t.kind === "selection" ? "; change only that part" : ""}. Show me the proposed rewrite first; after my approval apply it with edit_subblock_text (precise edits, pass expectedRev) and summarise what changed.`;
    case "comment":
      return t.kind === "comment"
        ? `Discuss ${what} with me: explain the point it raises and propose an answer or a change. After my confirmation reply with reply_to_comment and, if we agreed on a change, apply it with edit_subblock_text.`
        : `Review ${what} and record your remarks as comments ${commentHow}. Do not change the content. Then list the comments you added with their references.`;
    case "custom":
      return `Regarding ${what}:`;
  }
}

/** The full request to paste into the LLM chat. */
export function buildPrompt(p: AiProject, t: AiTarget, mode: AiMode, notes: string): string {
  const custom = notes.trim();
  const lines = [
    `Using the Sourcebook MCP server, work on ${p.kind === "templates" ? "template" : "project"} "${p.name}" (project "${projectArg(p)}").`,
    `Target: ${referenceFor(p, t)}`,
    readStep(p, t),
    "",
    modeInstructions(mode, t),
  ];
  if (mode === "custom") lines.push(custom || "[write your request here]");
  else if (custom) lines.push("", `Additional instructions: ${custom}`);
  return lines.join("\n");
}
