import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Author } from "@sourcebook/shared";
import { z } from "zod";
import { ApiError, type SourcebookApi } from "../api.js";
import { NotebookView } from "../notebook.js";
import { RefError, parseProject } from "../refs.js";

export interface ToolContext {
  server: McpServer;
  api: SourcebookApi;
  /** Author of comments written by the assistant. */
  author: Author;
  readOnly: boolean;
  open(project: string): Promise<NotebookView>;
}

export const projectParam = z
  .string()
  .describe('Project to work on: a project id (e.g. "payment-service"), "projects/<id>" or "templates/<id>". See list_workspace.');
export const refParam = (what: string) =>
  z.string().describe(`${what}: an outline reference like §2.1 / §2.1#3 / §2.1#3:L10-14, an id, or a sourcebook:// URI (see get_outline).`);

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const details = e.details as { errors?: string[]; currentRev?: number } | undefined;
    const extra = details?.errors?.length ? `\n- ${details.errors.join("\n- ")}` : details?.currentRev !== undefined ? ` (current rev ${details.currentRev})` : "";
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

export const openProject = (api: SourcebookApi) => (project: string) => NotebookView.load(api, parseProject(project));

export const READ = { readOnlyHint: true, openWorldHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
