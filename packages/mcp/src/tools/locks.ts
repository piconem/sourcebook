import type { SubBlockLock } from "@sourcebook/shared";
import { READ, WRITE, projectParam, refParam, run, signature, type ToolContext } from "./common.js";

export function registerLockTools({ server, api, open }: ToolContext) {
  server.registerTool(
    "lock_subblock",
    {
      title: "Take a sub-block",
      description:
        "Locks a sub-block while you work on it: until you release it (unlock_subblock), nobody else can change or delete it (comments stay open). Take it before a longer piece of work, release it as soon as you are done. Fails if someone else holds it.",
      inputSchema: { project: projectParam, subblock: refParam("Sub-block") },
      annotations: WRITE,
    },
    run(async ({ project, subblock }) => {
      const nb = await open(project);
      const r = await nb.resolveSubBlock(subblock);
      await api.json<SubBlockLock>("POST", `${nb.base}/blocks/${r.entry.id}/subblocks/${r.ref.id}/lock`);
      return `You hold ${nb.subRef(r.entry, r.index)} (id ${r.ref.id}). Release it with unlock_subblock when you are done.`;
    }),
  );

  server.registerTool(
    "unlock_subblock",
    {
      title: "Release a sub-block",
      description: "Releases a sub-block you locked. Locks of others are released by them, by the user their agent works for, or by the owner of Sourcebook.",
      inputSchema: { project: projectParam, subblock: refParam("Sub-block") },
      annotations: WRITE,
    },
    run(async ({ project, subblock }) => {
      const nb = await open(project);
      const r = await nb.resolveSubBlock(subblock);
      await api.json("DELETE", `${nb.base}/blocks/${r.entry.id}/subblocks/${r.ref.id}/lock`);
      return `Released ${nb.subRef(r.entry, r.index)}.`;
    }),
  );

  server.registerTool(
    "list_locks",
    {
      title: "List locked sub-blocks",
      description: "Sub-blocks of a project currently taken by someone (person or agent), with since when.",
      inputSchema: { project: projectParam },
      annotations: READ,
    },
    run(async ({ project }) => {
      const nb = await open(project);
      const { locks } = await api.json<{ locks: SubBlockLock[] }>("GET", `${nb.base}/locks`);
      if (!locks.length) return "No locked sub-blocks.";
      return locks
        .map((l) => {
          const entry = nb.data.blocks.find((b) => b.id === l.blockId);
          const index = entry ? entry.subBlocks.findIndex((s) => s.id === l.subBlockId) + 1 : 0;
          return `- ${entry && index ? nb.subRef(entry, index) : l.subBlockId} — ${signature(l.holder)} since ${l.since}`;
        })
        .join("\n");
    }),
  );
}
