import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { APP_VERSION, UsernameSchema, type Author } from "@sourcebook/shared";
import { agentContext, type SourcebookApi } from "./api.js";
import { z } from "zod";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { openProject, type ToolContext } from "./tools/common.js";
import { RefError } from "./refs.js";
import { registerBibliographyReadTools, registerBibliographyWriteTools } from "./tools/bibliography.js";
import { registerAttachmentTools } from "./tools/attachments.js";
import { registerReferenceFigureTool, registerReferenceReadTools, registerReferenceWriteTools } from "./tools/references.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerIdentityTool } from "./tools/identity.js";
import { registerLockTools } from "./tools/locks.js";
import { registerReadTools } from "./tools/read.js";
import { registerNotificationReadTools, registerNotificationTools } from "./tools/notifications.js";
import { registerWriteTools } from "./tools/write.js";

export interface SourcebookMcpOptions {
  /** Only register read-only tools. */
  readOnly?: boolean;
  /**
   * The agent signing comments and notifications. With accounts: the agent of the token, as the server reports it
   * (GET /api/auth/me). Single-user mode: the connection's identity.
   */
  author?: Author;
}

/** Single-user mode: identity headers of the /mcp endpoint; query parameters agent_id / agent_name work too. */
export const AGENT_ID_HEADER = "x-sourcebook-agent-id";
export const AGENT_NAME_HEADER = "x-sourcebook-agent-name";

export const DEFAULT_AUTHOR = { name: "Claude (assistant)", username: "claude" };

const agentParam = z
  .string()
  .optional()
  .describe('Which of your user\'s agents acts in this call (its id, see whoami), e.g. "reviewer". Omit to act as the default agent.');

const INSTRUCTIONS = `Sourcebook is the user's workspace of design documents (projects) and reusable structures (templates).
A project is an outline of sections (§1, §1.1, …); each section holds ordered sub-blocks (#1, #2, …) of type markdown, code, mermaid, equation, image, drawing, question (a question and its answer), choice (multiple choice: options, single/multiple selection, selected options and a note; their source is JSON) or csv (a reference data set: CSV text whose first line is the header, line N+1 = row N; comment on rows with lines), and may have an objective (why it exists). Sub-blocks can have comment threads, possibly attached to lines or text.

How to work:
- Start with list_workspace, then get_outline for the project the user means. Refer to elements as §2.1 (section), §2.1#3 (sub-block), §2.1#3:L10-14 (lines), and quote these references to the user so they can find them. Outline numbers change when sections move; ids (shown in outputs) never do.
- Read before writing: read_subblock shows numbered source lines and the revision (rev). Prefer edit_subblock_text for targeted changes; pass expectedRev when the user may be editing the same sub-block (a conflict error means: re-read and retry).
- The user sees your changes live in Sourcebook. Explain what you changed with references. Ask before deleting anything.
- After a group of changes, call notify_changes once with a short summary and the parts involved (sections, sub-blocks, comments): the user gets a notification linking to each part. When the group is complete and the user should reload, pass request_reload=true (or call request_reload).
- Comment threads can be resolved (resolve_comment) once handled; list_comments shows open threads unless include_resolved is set.
- You connect with the access token of a Sourcebook user and act as one of that user's agents: your comments, notifications and locks are signed with the agent's name and the user's (see whoami). Every tool takes an optional agent (an agent id): when several agents share this connection (e.g. a writer and a reviewer), each passes its own id in every call; without it, the user's default agent acts. A role without an identity yet can be registered with register_agent. You can do what the user can: some projects may be read-only (you can still comment). list_participants shows the people and agents of a project.
- Several people and agents may work on the same project. Before a longer piece of work on a sub-block, take it with lock_subblock and release it with unlock_subblock when you are done: meanwhile nobody else can change it. A sub-block locked by someone else cannot be changed (error 423, naming the holder): work elsewhere or ask the user. list_locks shows who holds what.
- When asked to review, comment on precise lines/quotes rather than rewriting the user's text.
- Templates are edited like projects with project "templates/<id>"; create_project can start from a template.
- Each project has a bibliography (list_bibliography, read_bib_entry, add_bib_entry, import_bibtex…). Entries have a key (e.g. knuth1984). Cite an entry inside Markdown text as a link [Name](bib:key) — insert it with edit_subblock_text; associate an entry with a whole section or sub-block with cite / uncite. Never invent sources: add entries only from information the user gave or confirmed.
- Reference files (list_references): read_reference returns text files as they are, images as images, and documents (PDF, Office, OpenDocument, EPUB, HTML, email, ZIP…) as Markdown converted by Sourcebook, split into pages/slides/sheets (pass parts for long documents). Pages that are scans, figures or diagrams are marked in the text: look at them with read_reference_pages; figures (images, charts, diagrams) of PDFs are cut out and listed on their page — see them with read_reference_figures. After reading one you may store its text with save_reference_transcription.
- Reference files can be linked in Markdown text as [name](../../../references/<path, URL-encoded>) or associated with a whole section or sub-block with attach_reference / detach_reference.`;

/** The Sourcebook MCP server (tools, resources, prompts) on top of a SourcebookApi. */
export function createSourcebookMcpServer(api: SourcebookApi, opts: SourcebookMcpOptions = {}): McpServer {
  const server = new McpServer({ name: "sourcebook", version: APP_VERSION }, { instructions: INSTRUCTIONS });
  const author: Author = { kind: "assistant", ...(opts.author ?? DEFAULT_AUTHOR) };
  // Every tool takes an optional `agent`: the identity (one of the user's agents) acting in that call.
  const register = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: { inputSchema?: Record<string, unknown> }, cb: (...args: unknown[]) => unknown) =>
    register(name, { ...config, inputSchema: { ...(config.inputSchema ?? {}), agent: agentParam } } as never, ((args: { agent?: string }, extra: unknown) =>
      agentContext.run(args?.agent || undefined, () => cb(args, extra))) as never)) as typeof server.registerTool;
  const ctx: ToolContext = {
    server,
    api,
    readOnly: !!opts.readOnly,
    author,
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
    registerLockTools(ctx);
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
  return { name: name?.trim() || (id ?? base.name), username: id ? agentUsername(id) : base.username };
}

/** "Claude Writer" → "claude-writer"; throws on an id that cannot be a username. */
export function agentUsername(id: string): string {
  const username = id
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 39);
  if (!UsernameSchema.safeParse(username).success) throw new RefError(`Invalid agent id "${id}": use lower-case letters, digits, ".", "-" or "_".`);
  return username;
}
