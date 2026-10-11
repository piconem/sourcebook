import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Author } from "@sourcebook/shared";
import type { SourcebookApi } from "./api.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { openProject, type ToolContext } from "./tools/common.js";
import { registerBibliographyReadTools, registerBibliographyWriteTools } from "./tools/bibliography.js";
import { registerAttachmentTools } from "./tools/attachments.js";
import { registerReferenceFigureTool, registerReferenceReadTools, registerReferenceWriteTools } from "./tools/references.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerReadTools } from "./tools/read.js";
import { registerNotificationReadTools, registerNotificationTools } from "./tools/notifications.js";
import { registerWriteTools } from "./tools/write.js";

export interface SourcebookMcpOptions {
  /** Only register read-only tools. */
  readOnly?: boolean;
  /** Author of the assistant's comments. */
  author?: { name: string; username: string };
}

export const DEFAULT_AUTHOR = { name: "Claude (assistant)", username: "claude" };

const INSTRUCTIONS = `Sourcebook is the user's workspace of design documents (projects) and reusable structures (templates).
A project is an outline of sections (§1, §1.1, …); each section holds ordered sub-blocks (#1, #2, …) of type markdown, code, mermaid, equation, image, drawing, question (a question and its answer) or choice (multiple choice: options, single/multiple selection, selected options and a note; their source is JSON), and may have an objective (why it exists). Sub-blocks can have comment threads, possibly attached to lines or text.

How to work:
- Start with list_workspace, then get_outline for the project the user means. Refer to elements as §2.1 (section), §2.1#3 (sub-block), §2.1#3:L10-14 (lines), and quote these references to the user so they can find them. Outline numbers change when sections move; ids (shown in outputs) never do.
- Read before writing: read_subblock shows numbered source lines and the revision (rev). Prefer edit_subblock_text for targeted changes; pass expectedRev when the user may be editing the same sub-block (a conflict error means: re-read and retry).
- The user sees your changes live in Sourcebook. Explain what you changed with references. Ask before deleting anything.
- After a group of changes, call notify_changes once with a short summary and the parts involved (sections, sub-blocks, comments): the user gets a notification linking to each part. When the group is complete and the user should reload, pass request_reload=true (or call request_reload).
- Comment threads can be resolved (resolve_comment) once handled; list_comments shows open threads unless include_resolved is set.
- Comments you write are signed as the assistant. When asked to review, comment on precise lines/quotes rather than rewriting the user's text.
- Templates are edited like projects with project "templates/<id>"; create_project can start from a template.
- Each project has a bibliography (list_bibliography, read_bib_entry, add_bib_entry, import_bibtex…). Entries have a key (e.g. knuth1984). Cite an entry inside Markdown text as a link [Name](bib:key) — insert it with edit_subblock_text; associate an entry with a whole section or sub-block with cite / uncite. Never invent sources: add entries only from information the user gave or confirmed.
- Reference files (list_references): read_reference returns text files as they are, images as images, and documents (PDF, Office, OpenDocument, EPUB, HTML, email, ZIP…) as Markdown converted by Sourcebook, split into pages/slides/sheets (pass parts for long documents). Pages that are scans, figures or diagrams are marked in the text: look at them with read_reference_pages; figures (images, charts, diagrams) of PDFs are cut out and listed on their page — see them with read_reference_figures. After reading one you may store its text with save_reference_transcription.
- Reference files can be linked in Markdown text as [name](../../../references/<path, URL-encoded>) or associated with a whole section or sub-block with attach_reference / detach_reference.`;

/** The Sourcebook MCP server (tools, resources, prompts) on top of a SourcebookApi. */
export function createSourcebookMcpServer(api: SourcebookApi, opts: SourcebookMcpOptions = {}): McpServer {
  const server = new McpServer({ name: "sourcebook", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const ctx: ToolContext = {
    server,
    api,
    readOnly: !!opts.readOnly,
    author: { ...(opts.author ?? DEFAULT_AUTHOR), kind: "assistant" },
    open: openProject(api),
  };
  registerReadTools(ctx);
  registerBibliographyReadTools(ctx);
  registerReferenceReadTools(ctx);
  registerReferenceFigureTool(ctx);
  registerNotificationReadTools(ctx);
  if (!ctx.readOnly) {
    registerWriteTools(ctx);
    registerCommentTools(ctx);
    registerBibliographyWriteTools(ctx);
    registerAttachmentTools(ctx);
    registerReferenceWriteTools(ctx);
    registerNotificationTools(ctx);
  }
  registerResources(server, api);
  registerPrompts(server);
  return server;
}

/** Options from environment variables (shared by the stdio binary and the /mcp endpoint). */
export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): SourcebookMcpOptions {
  return {
    readOnly: ["1", "true", "yes"].includes(String(env.SOURCEBOOK_MCP_READONLY ?? "").toLowerCase()),
    author: {
      name: env.SOURCEBOOK_MCP_AUTHOR_NAME || DEFAULT_AUTHOR.name,
      username: env.SOURCEBOOK_MCP_AUTHOR_USERNAME || DEFAULT_AUTHOR.username,
    },
  };
}
