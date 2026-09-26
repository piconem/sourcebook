import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Ready-made conversation starters for common collaborative tasks. */
export function registerPrompts(server: McpServer) {
  const user = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

  server.registerPrompt(
    "review-section",
    {
      title: "Review a section",
      description: "Critical review of a section against its objective, leaving comments on specific lines",
      argsSchema: { project: z.string(), section: z.string().describe("e.g. §2.1") },
    },
    ({ project, section }) =>
      user(
        `Review section ${section} of Sourcebook project "${project}". Read it with read_section (and get_outline for context). ` +
          `Check that it fulfils its objective, is clear, consistent with the rest of the document and technically correct. ` +
          `Leave precise comments with add_comment on the relevant lines or quoted text (not on the whole sub-block unless needed), ` +
          `then summarise the main issues for me. Do not change the content yourself.`,
      ),
  );

  server.registerPrompt(
    "fill-placeholders",
    {
      title: "Fill template placeholders",
      description: "Replace [placeholders] and guidance text with real content, together with the user",
      argsSchema: { project: z.string(), section: z.string().optional().describe("Limit to one section, e.g. §3") },
    },
    ({ project, section }) =>
      user(
        `Help me fill in the placeholders of Sourcebook project "${project}"${section ? `, section ${section}` : ""}. ` +
          `Use search to find "[...]" placeholders and italic guidance. For each section, ask me the questions you need, ` +
          `then write the content with edit_subblock_text (precise edits) and show me what you changed with its reference (§x#n).`,
      ),
  );

  server.registerPrompt(
    "discuss-comments",
    {
      title: "Go through the comments",
      description: "Walk through open comment threads, answer them and apply agreed changes",
      argsSchema: { project: z.string() },
    },
    ({ project }) =>
      user(
        `Let's go through the comments of Sourcebook project "${project}". List them with list_comments. For each thread: ` +
          `explain it briefly, propose an answer or a change, and after my confirmation reply with reply_to_comment and/or edit the content. ` +
          `Mention detached comments (their text changed) and offer to re-attach them.`,
      ),
  );
}
