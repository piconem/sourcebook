import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { APP_VERSION, type Author } from "@sourcebook/shared";
import type { SourcebookApi } from "./api.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { agentAuthor, openProject, type AgentInput, type ToolContext } from "./tools/common.js";
import { registerBibliographyReadTools, registerBibliographyWriteTools } from "./tools/bibliography.js";
import { registerAttachmentTools } from "./tools/attachments.js";
import { registerReferenceFigureTool, registerReferenceReadTools, registerReferenceWriteTools } from "./tools/references.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerIdentityTool } from "./tools/identity.js";
import { registerReadTools } from "./tools/read.js";
import { registerNotificationReadTools, registerNotificationTools } from "./tools/notifications.js";
import { registerWriteTools } from "./tools/write.js";

export interface SourcebookMcpOptions {
  /** Only register read-only tools. */
  readOnly?: boolean;
  /** Agent of this connection: author of its comments and notifications unless a call names another agent. */
  author?: { name: string; username: string };
}

/** Identity headers of the /mcp endpoint (an agent per connection); query parameters agent_id / agent_name work too. */
export const AGENT_ID_HEADER = "x-sourcebook-agent-id";
export const AGENT_NAME_HEADER = "x-sourcebook-agent-name";

export const DEFAULT_AUTHOR = { name: "Claude (assistant)", username: "claude" };

const INSTRUCTIONS = `Sourcebook is the user's workspace of design documents (projects) and reusable structures (templates).
A project is an outline of sections (§1, §1.1, …); each section holds ordered sub-blocks (#1, #2, …) of type markdown, code, mermaid, equation, image, drawing, question (a question and its answer) or choice (multiple choice: options, single/multiple selection, selected options and a note; their source is JSON), and may have an objective (why it exists). Sub-blocks can have comment threads, possibly attached to lines or text.

How to work:
- Start with list_workspace, then get_outline for the project the user means. Refer to elements as §2.1 (section), §2.1#3 (sub-block), §2.1#3:L10-14 (lines), and quote these references to the user so they can find them. Outline numbers change when sections move; ids (shown in outputs) never do.
- Read before writing: read_subblock shows numbered source lines and the revision (rev). Prefer edit_subblock_text for targeted changes; pass expectedRev when the user may be editing the same sub-block (a conflict error means: re-read and retry).
- The user sees your changes live in Sourcebook. Explain what you changed with references. Ask before deleting anything.
- After a group of changes, call notify_changes once with a short summary and the parts involved (sections, sub-blocks, comments): the user gets a notification linking to each part. When the group is complete and the user should reload, pass request_reload=true (or call request_reload).
- Comment threads can be resolved (resolve_comment) once handled; list_comments shows open threads unless include_resolved is set.
- Comments and notifications you write are signed with your agent identity (see whoami). When several agents work with the user on the same project, each must use its own identity: pass agent {id, name} (e.g. {"id":"reviewer","name":"Reviewer"}) to the tools that sign (add_comment, reply_to_comment, resolve_comment, notify_changes, request_reload, save_reference_transcription), always the same one — or configure the connection with SOURCEBOOK_MCP_AGENT_ID / SOURCEBOOK_MCP_AGENT_NAME (stdio) or agent_id / agent_name in the /mcp URL (HTTP). Before picking an identity, call list_participants: ids and names already used by someone else in the project (and the local user's username) are refused.
- When asked to review, comment on precise lines/quotes rather than rewriting the user's text.
- Templates are edited like projects with project "templates/<id>"; create_project can start from a template.
- Each project has a bibliography (list_bibliography, read_bib_entry, add_bib_entry, import_bibtex…). Entries have a key (e.g. knuth1984). Cite an entry inside Markdown text as a link [Name](bib:key) — insert it with edit_subblock_text; associate an entry with a whole section or sub-block with cite / uncite. Never invent sources: add entries only from information the user gave or confirmed.
- Reference files (list_references): read_reference returns text files as they are, images as images, and documents (PDF, Office, OpenDocument, EPUB, HTML, email, ZIP…) as Markdown converted by Sourcebook, split into pages/slides/sheets (pass parts for long documents). Pages that are scans, figures or diagrams are marked in the text: look at them with read_reference_pages; figures (images, charts, diagrams) of PDFs are cut out and listed on their page — see them with read_reference_figures. After reading one you may store its text with save_reference_transcription.
- Reference files can be linked in Markdown text as [name](../../../references/<path, URL-encoded>) or associated with a whole section or sub-block with attach_reference / detach_reference.`;

/** The Sourcebook MCP server (tools, resources, prompts) on top of a SourcebookApi. */
export function createSourcebookMcpServer(api: SourcebookApi, opts: SourcebookMcpOptions = {}): McpServer {
  const server = new McpServer({ name: "sourcebook", version: APP_VERSION }, { instructions: INSTRUCTIONS });
  const author = { ...(opts.author ?? DEFAULT_AUTHOR), kind: "assistant" as const };
  const ctx: ToolContext = {
    server,
    api,
    readOnly: !!opts.readOnly,
    author,
    as: (agent?: AgentInput) => (agent ? agentAuthor(agent) : author),
    open: openProject(api),
  };
  registerReadTools(ctx);
  registerIdentityTool(ctx);
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
  const id = env.SOURCEBOOK_MCP_AGENT_ID || env.SOURCEBOOK_MCP_AUTHOR_USERNAME;
  const name = env.SOURCEBOOK_MCP_AGENT_NAME || env.SOURCEBOOK_MCP_AUTHOR_NAME;
  return {
    readOnly: ["1", "true", "yes"].includes(String(env.SOURCEBOOK_MCP_READONLY ?? "").toLowerCase()),
    author: withAgent(DEFAULT_AUTHOR, id, name),
  };
}

/**
 * `base` with the agent identity given by a connection (id and/or name; a missing name defaults to the id).
 * Throws on an invalid id.
 */
export function withAgent(base: { name: string; username: string }, id?: string, name?: string): { name: string; username: string } {
  if (!id && !name) return base;
  const { username } = id ? agentAuthor({ id, name: name || id }) : base;
  return { name: name?.trim() || (id ?? base.name), username };
}
