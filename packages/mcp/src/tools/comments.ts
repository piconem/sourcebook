import type { CommentView } from "@sourcebook/shared";
import { z } from "zod";
import type { NotebookView } from "../notebook.js";
import { RefError, parseRef, type LineRange } from "../refs.js";
import { DESTRUCTIVE, WRITE, projectParam, refParam, run, type ToolContext } from "./common.js";

/** Anchor for the API from lines (source lines of the file) or a quote. */
async function anchorFor(nb: NotebookView, subblock: string, lines?: LineRange, quote?: string) {
  const r = await nb.resolveSubBlock(subblock);
  const range = lines ?? r.lines;
  if (range && quote) throw new RefError("Pass either lines or quote, not both.");
  const unit = r.ref.type === "code" ? "lines" : "text";
  const anchor = range ? { lines: range } : quote ? { unit, exact: quote } : undefined;
  if (anchor && !["markdown", "code"].includes(r.ref.type)) {
    throw new RefError(`${r.ref.type} sub-blocks only take comments on the whole sub-block (omit lines/quote).`);
  }
  return { r, anchor };
}

const commentRef = z.string().describe('Comment or reply id (shown as [comment <id>] by list_comments), or "§2.1#3!c<id>"');

export function registerCommentTools({ server, api, open, author }: ToolContext) {
  const whereOf = (nb: NotebookView, entry: Parameters<NotebookView["formatComment"]>[0], index: number, c: CommentView) =>
    nb.formatComment(entry, index, c).split("\n")[0];

  server.registerTool(
    "add_comment",
    {
      title: "Comment",
      description:
        "Adds a comment (as the assistant) to a sub-block: on the whole sub-block, on source lines (lines, or a reference like §2.1#3:L4-6) or on a quoted piece of text (quote). Lines of Markdown sub-blocks are lines of the .md source as shown by read_subblock.",
      inputSchema: {
        project: projectParam,
        subblock: refParam("Sub-block (optionally with :Lx-y)"),
        text: z.string().min(1).max(10000),
        lines: z.object({ first: z.number().int().min(1), last: z.number().int().min(1) }).optional(),
        quote: z.string().min(1).max(5000).optional().describe("Exact text to attach the comment to"),
      },
      annotations: WRITE,
    },
    run(async ({ project, subblock, text, lines, quote }) => {
      const nb = await open(project);
      const { r, anchor } = await anchorFor(nb, subblock, lines, quote);
      const c = await api.json<CommentView>("POST", `${nb.base}/blocks/${r.entry.id}/subblocks/${r.ref.id}/comments`, { text, author, ...(anchor ? { anchor } : {}) });
      return `Added ${whereOf(nb, r.entry, r.index, c)}.`;
    }),
  );

  server.registerTool(
    "reply_to_comment",
    {
      title: "Reply to a comment",
      description: "Replies (as the assistant) to a comment thread.",
      inputSchema: { project: projectParam, comment: commentRef, text: z.string().min(1).max(10000) },
      annotations: WRITE,
    },
    run(async ({ project, comment, text }) => {
      const nb = await open(project);
      const found = await resolveComment(nb, comment);
      await api.json("POST", `${nb.base}/blocks/${found.entry.id}/subblocks/${found.ref.id}/comments/${found.comment.id}/replies`, { text, author });
      return `Replied to comment ${found.comment.id} by ${found.comment.author.name} on ${nb.subRef(found.entry, found.index)}.`;
    }),
  );

  server.registerTool(
    "reanchor_comment",
    {
      title: "Re-attach a comment",
      description: "Attaches a comment to other lines or text (e.g. a DETACHED one after rewriting), or makes it a comment on the whole sub-block (general=true).",
      inputSchema: {
        project: projectParam,
        comment: commentRef,
        lines: z.object({ first: z.number().int().min(1), last: z.number().int().min(1) }).optional(),
        quote: z.string().min(1).max(5000).optional(),
        general: z.boolean().optional(),
      },
      annotations: WRITE,
    },
    run(async ({ project, comment, lines, quote, general }) => {
      const nb = await open(project);
      const found = await resolveComment(nb, comment);
      if (!general && !lines && !quote) throw new RefError("Pass lines, quote, or general=true.");
      const { anchor } = general ? { anchor: null } : await anchorFor(nb, found.ref.id, lines, quote);
      const c = await api.json<CommentView>("PATCH", `${nb.base}/blocks/${found.entry.id}/subblocks/${found.ref.id}/comments/${found.comment.id}`, { anchor });
      return `Comment ${c.id} is now ${whereOf(nb, found.entry, found.index, c).replace(/^\[comment \S+\] /, "on ")}.`;
    }),
  );

  server.registerTool(
    "resolve_comment",
    {
      title: "Resolve a comment thread",
      description: "Marks a comment thread as resolved (nothing left to do), e.g. after making the change it asked for; reopen=true opens it again.",
      inputSchema: { project: projectParam, comment: commentRef, reopen: z.boolean().optional() },
      annotations: WRITE,
    },
    run(async ({ project, comment, reopen }) => {
      const nb = await open(project);
      const found = await resolveComment(nb, comment);
      const url = `${nb.base}/blocks/${found.entry.id}/subblocks/${found.ref.id}/comments/${found.comment.id}`;
      if (reopen) await api.json("POST", `${url}/reopen`);
      else await api.json("POST", `${url}/resolve`, { author });
      return `${reopen ? "Reopened" : "Resolved"} comment ${found.comment.id} by ${found.comment.author.name} on ${nb.subRef(found.entry, found.index)}.`;
    }),
  );

  server.registerTool(
    "delete_comment",
    {
      title: "Delete a comment or reply",
      description: "Deletes a reply, or a whole comment thread with its replies. Ask the user before deleting comments written by other people.",
      inputSchema: { project: projectParam, comment: commentRef },
      annotations: DESTRUCTIVE,
    },
    run(async ({ project, comment }) => {
      const nb = await open(project);
      const found = await resolveComment(nb, comment);
      await api.json("DELETE", `${nb.base}/blocks/${found.entry.id}/subblocks/${found.ref.id}/comments/${found.comment.id}${found.replyId ? `/replies/${found.replyId}` : ""}`);
      return found.replyId ? `Deleted reply ${found.replyId}.` : `Deleted comment ${found.comment.id} and its ${found.comment.replies.length} repl(ies).`;
    }),
  );
}

async function resolveComment(nb: NotebookView, input: string) {
  const parsed = parseRef(input);
  if (parsed.kind === "outline" && parsed.commentId) {
    const r = await nb.resolve(parsed);
    if (r.kind === "comment") return r;
  }
  if (parsed.kind === "id") {
    const r = await nb.resolve(parsed);
    if (r.kind === "comment") return r;
  }
  throw new RefError(`"${input}" is not a comment. Use the id shown by list_comments.`);
}
