import type { ChangeTarget, Notification } from "@sourcebook/shared";
import { z } from "zod";
import type { NotebookView } from "../notebook.js";
import { READ, WRITE, projectParam, run, type ToolContext } from "./common.js";

/** API target for a reference to a section, a sub-block or a comment. */
async function targetFor(nb: NotebookView, ref: string, note?: string): Promise<ChangeTarget> {
  const r = await nb.resolve(ref);
  const base = { blockId: r.entry.id, ...(note ? { note } : {}) };
  if (r.kind === "section") return base;
  if (r.kind === "subblock") return { ...base, subBlockId: r.ref.id };
  return { ...base, subBlockId: r.ref.id, commentId: r.comment.id };
}

const format = (n: Notification) =>
  [
    `[notification ${n.id}] ${n.read ? "read" : "UNREAD"} — ${n.author.name} (@${n.author.username}), ${n.createdAt}`,
    `  ${n.summary}`,
    ...n.targets.map((t) => `  - ${t.label}${t.note ? `: ${t.note}` : ""}`),
  ].join("\n");

export function registerNotificationReadTools({ server, open }: ToolContext) {
  server.registerTool(
    "list_notifications",
    {
      title: "List change notifications",
      description: "Change notifications received by a project (newest first): who sent them, the summary, the parts involved and whether the user has read them.",
      inputSchema: { project: projectParam },
      annotations: READ,
    },
    run(async ({ project }) => {
      const nb = await open(project);
      const { notifications } = await nb.api.json<{ notifications: Notification[] }>("GET", `${nb.base}/notifications`);
      return notifications.length ? notifications.map(format).join("\n\n") : "No notifications.";
    }),
  );
}

export function registerNotificationTools({ server, api, open, author }: ToolContext) {
  server.registerTool(
    "notify_changes",
    {
      title: "Notify the user of changes",
      description:
        "Tells the user what you changed: one notification with a short summary and the parts involved (sections, sub-blocks or comments), shown in Sourcebook's notification menu with links to each part. Send one per coherent group of changes, after making them. request_reload=true also asks open editors to reload (use it at the end of a group of changes).",
      inputSchema: {
        project: projectParam,
        summary: z.string().min(1).max(300).describe("Short description of the change, e.g. \"Rewrote the API section and answered 2 comments\""),
        changes: z
          .array(
            z.object({
              ref: z.string().describe("Section (§2.1), sub-block (§2.1#3), comment (§2.1#3!c<id> or comment id) or an id"),
              note: z.string().max(500).optional().describe("What changed there, in a few words"),
            }),
          )
          .max(50)
          .describe("Parts involved (most specific: a sub-block or a comment)"),
        request_reload: z.boolean().optional(),
      },
      annotations: WRITE,
    },
    run(async ({ project, summary, changes, request_reload }) => {
      const nb = await open(project);
      const targets: ChangeTarget[] = [];
      for (const c of changes) targets.push(await targetFor(nb, c.ref, c.note));
      const n = await api.json<Notification>("POST", `${nb.base}/notifications`, { author, summary, targets, requestReload: !!request_reload });
      return `Sent notification ${n.id}${n.targets.length ? ` about ${n.targets.map((t) => t.label).join(", ")}` : ""}${request_reload ? "; open editors were asked to reload" : ""}.`;
    }),
  );

  server.registerTool(
    "request_reload",
    {
      title: "Ask open editors to reload",
      description:
        "Asks the user's open Sourcebook editors to reload, showing your message and the notifications describing the changes (default: the unread ones). Call it once at the end of a group of changes (after notify_changes).",
      inputSchema: { project: projectParam, message: z.string().max(500).optional() },
      annotations: WRITE,
    },
    run(async ({ project, message }) => {
      const nb = await open(project);
      const r = await api.json<{ notificationIds: string[] }>("POST", `${nb.base}/reload-request`, { author, ...(message ? { message } : {}) });
      return `Asked open editors to reload (${r.notificationIds.length} notification(s) listed).`;
    }),
  );
}
