import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { UsernameSchema, type Author } from "@sourcebook/shared";
import { z } from "zod";
import { ApiError, type SourcebookApi } from "../api.js";
import { NotebookView } from "../notebook.js";
import { RefError, parseProject } from "../refs.js";

export interface ToolContext {
  server: McpServer;
  api: SourcebookApi;
  /** Default author of what the assistant signs (comments, notifications…): this connection's agent. */
  author: Author;
  /** The author for one call: `agent` when the call names one, else the connection's agent. */
  as(agent?: AgentInput): Author;
  readOnly: boolean;
  open(project: string): Promise<NotebookView>;
}

export const projectParam = z
  .string()
  .describe('Project to work on: a project id (e.g. "payment-service"), "projects/<id>" or "templates/<id>". See list_workspace.');
export const refParam = (what: string) =>
  z.string().describe(`${what}: an outline reference like §2.1 / §2.1#3 / §2.1#3:L10-14, an id, or a sourcebook:// URI (see get_outline).`);

export interface AgentInput {
  id: string;
  name: string;
}

/**
 * Identity of the agent acting in a call, for when several assistants work on the same project: each one signs
 * its comments and notifications with its own id and name. Optional: the connection's agent is the default.
 */
export const agentParam = z
  .object({
    id: z.string().min(1).max(39).describe('Stable handle of the agent, e.g. "reviewer" or "claude-writer" (lower-case letters, digits, ".", "-", "_")'),
    name: z.string().trim().min(1).max(100).describe('Display name, e.g. "Reviewer (Claude)"'),
  })
  .optional()
  .describe("Who is acting, when several agents work on the project: signs comments/notifications with this identity. Omit to use this connection's agent (see whoami).");

/** Author from an agent identity; the id becomes the username ("Claude Writer" → "claude-writer"). */
export function agentAuthor(agent: AgentInput): Author {
  const username = agent.id
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 39);
  if (!UsernameSchema.safeParse(username).success) throw new RefError(`Invalid agent id "${agent.id}": use lower-case letters, digits, ".", "-" or "_".`);
  return { name: agent.name.trim(), username, kind: "assistant" };
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const details = e.details as { errors?: string[]; currentRev?: number; usages?: { ref: string; kind: string; title: string }[] } | undefined;
    const extra = details?.errors?.length
      ? `\n- ${details.errors.join("\n- ")}`
      : details?.usages?.length
        ? `\n${details.usages.map((u) => `- ${u.ref} "${u.title}" (${u.kind === "text" ? "cited in text" : `associated ${u.kind}`})`).join("\n")}`
        : details?.currentRev !== undefined
          ? ` (current rev ${details.currentRev})`
          : "";
    return `Sourcebook error${e.status ? ` ${e.status}` : ""}: ${e.message}${extra}`;
  }
  if (e instanceof RefError) return e.message;
  return (e as Error).message ?? String(e);
}

/** Wraps a tool body: returns its text, or an isError result with a readable explanation. */
export function run<A>(fn: (args: A) => Promise<string>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return { content: [{ type: "text", text: await fn(args) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: errorText(e) }] };
    }
  };
}

/** Like run(), for tools that return several content items (text and images). */
export function runContent<A>(fn: (args: A) => Promise<CallToolResult["content"]>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return { content: await fn(args) };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: errorText(e) }] };
    }
  };
}

export const openProject = (api: SourcebookApi) => (project: string) => NotebookView.load(api, parseProject(project));

export const READ = { readOnlyHint: true, openWorldHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
