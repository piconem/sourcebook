import type { BibEntry, ProjectSummary } from "@sourcebook/shared";
import { z } from "zod";
import { sourceText } from "../notebook.js";
import { projectLabel } from "../refs.js";
import { READ, projectParam, refParam, run, type ToolContext } from "./common.js";


export function registerReadTools({ server, api, open }: ToolContext) {
  server.registerTool(
    "list_workspace",
    {
      title: "List projects and templates",
      description: "Lists Sourcebook projects and/or templates with id, name, number of sections and last modification. Start here to find the project to work on.",
      inputSchema: { kind: z.enum(["projects", "templates", "all"]).default("all").describe("Which collection to list") },
      annotations: READ,
    },
    run(async ({ kind }) => {
      const kinds = kind === "all" ? (["projects", "templates"] as const) : ([kind] as const);
      const out: string[] = [];
      for (const k of kinds) {
        const list = await api.json<ProjectSummary[]>("GET", `/api/${k}`);
        out.push(`${k === "projects" ? "Projects" : "Templates"} (${list.length}):`);
        for (const p of list) {
          out.push(`- ${k}/${p.id} — "${p.name}" · ${p.sections} sections · modified ${p.updatedAt}${p.description ? ` · ${p.description}` : ""}${p.createdFrom ? ` · from ${p.createdFrom.kind === "templates" ? "template" : "project"} "${p.createdFrom.name}"` : ""}`);
        }
        if (!list.length) out.push("  (none)");
        out.push("");
      }
      return out.join("\n").trim();
    }),
  );

  server.registerTool(
    "get_outline",
    {
      title: "Project outline",
      description:
        "Numbered outline of a project/template: sections (§1, §1.1…) with objectives and their sub-blocks (#1, #2…) with type, title, size, comment count, revision and id. Use these references in every other tool and when talking with the user. Call again after structural changes: numbers shift when sections move, ids never change.",
      inputSchema: { project: projectParam, previews: z.boolean().default(true).describe("Show the first line of each text sub-block") },
      annotations: READ,
    },
    run(async ({ project, previews }) => (await open(project)).outline({ previews })),
  );

  server.registerTool(
    "read_section",
    {
      title: "Read a section",
      description: "Reads a section: title, objective, sub-sections and the full content of each of its sub-blocks.",
      inputSchema: { project: projectParam, section: refParam("Section"), lineNumbers: z.boolean().default(false).describe("Prefix source lines with their numbers") },
      annotations: READ,
    },
    run(async ({ project, section, lineNumbers }) => {
      const nb = await open(project);
      return nb.formatSection(await nb.resolveSection(section), { lineNumbers });
    }),
  );

  server.registerTool(
    "read_subblock",
    {
      title: "Read a sub-block",
      description:
        "Reads one sub-block's source (Markdown, code, Mermaid, LaTeX; JSON for question and choice) with line numbers — the numbers used by edit_subblock_text and line comments. Images and drawings are described. A line range (§2.1#3:L10-20) limits the output.",
      inputSchema: { project: projectParam, subblock: refParam("Sub-block"), lineNumbers: z.boolean().default(true) },
      annotations: READ,
    },
    run(async ({ project, subblock, lineNumbers }) => {
      const nb = await open(project);
      const r = await nb.resolveSubBlock(subblock);
      const sub = (await nb.block(r.entry.id)).subBlocks[r.index - 1];
      return nb.formatSubBlock(r.entry, sub, r.index, { lineNumbers, lines: r.lines });
    }),
  );

  server.registerTool(
    "read_document",
    {
      title: "Read the whole document",
      description: "The whole project compiled into one Markdown document (sections as headings, objectives as HTML comments). Good for a global review; use read_section/read_subblock for precise references.",
      inputSchema: { project: projectParam },
      annotations: READ,
    },
    run(async ({ project }) => {
      const nb = await open(project);
      return (await api.text(`${nb.base}/markdown`)).text;
    }),
  );

  server.registerTool(
    "search",
    {
      title: "Search text",
      description: "Finds text in section titles, objectives and sub-block sources. Results carry precise references (§2.1#3:L12).",
      inputSchema: {
        project: projectParam,
        query: z.string().min(1).describe("Text to find (case-insensitive), or a regular expression if regex=true"),
        regex: z.boolean().default(false),
        limit: z.number().int().min(1).max(500).default(100),
      },
      annotations: READ,
    },
    run(async ({ project, query, regex, limit }) => {
      const nb = await open(project);
      let re: RegExp;
      try {
        re = regex ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      } catch (e) {
        throw new Error(`Invalid regular expression: ${(e as Error).message}`);
      }
      const hits: string[] = [];
      for (const entry of nb.data.blocks) {
        if (re.test(entry.title)) hits.push(`${nb.num(entry)} (section title) ${entry.title}`);
        const block = await nb.block(entry.id);
        if (block.objective && re.test(block.objective)) hits.push(`${nb.num(entry)} (objective) ${block.objective}`);
        for (const [i, sub] of block.subBlocks.entries()) {
          if (sub.title && re.test(sub.title)) hits.push(`${nb.subRef(entry, i + 1)} (title) ${sub.title}`);
          const text = sourceText(sub);
          text?.split("\n").forEach((line, n) => {
            if (re.test(line)) hits.push(`${nb.subRef(entry, i + 1)}:L${n + 1}  ${line.trim().slice(0, 160)}`);
          });
        }
      }
      for (const e of await api.json<BibEntry[]>("GET", `${nb.base}/bibliography`)) {
        const field = (["name", "title", "authors", "venue", "description", "key"] as const).find((f) => e[f] && re.test(e[f]!));
        if (field) hits.push(`bib:${e.key} (bibliography ${field}) ${e.name}${e.title ? ` — ${e.title}` : ""}`);
      }
      if (!hits.length) return `No matches for ${JSON.stringify(query)} in ${projectLabel(nb.project)}.`;
      return `${hits.length} match(es)${hits.length > limit ? `, first ${limit}` : ""}:\n${hits.slice(0, limit).join("\n")}`;
    }),
  );

  server.registerTool(
    "list_comments",
    {
      title: "List comments",
      description:
        "Comment threads (with replies) of a sub-block, of a section, or of the whole project: author, time, the quoted text and where it is now (§x#n:Lk), or DETACHED if the text is gone. Only open threads unless include_resolved is set (resolved ones are marked RESOLVED).",
      inputSchema: {
        project: projectParam,
        target: z.string().optional().describe("Optional section or sub-block reference; omit for the whole project"),
        include_resolved: z.boolean().optional().describe("Also list resolved threads"),
      },
      annotations: READ,
    },
    run(async ({ project, target, include_resolved }) => {
      const nb = await open(project);
      const r = target ? await nb.resolve(target) : null;
      const out: string[] = [];
      for (const t of await nb.threads(include_resolved ? "all" : "open")) {
        if (r && r.entry.id !== t.blockId) continue;
        if (r && r.kind !== "section" && r.ref.id !== t.subBlockId) continue;
        const entry = nb.data.blocks.find((b) => b.id === t.blockId);
        if (entry) out.push(nb.formatComment(entry, t.subBlockIndex, t.comment));
      }
      return out.length ? out.join("\n\n") : "No comments.";
    }),
  );
}
