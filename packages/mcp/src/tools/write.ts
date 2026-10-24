import type { NotebookEntry, ProjectSummary, SubBlock } from "@sourcebook/shared";
import { z } from "zod";
import { NotebookView, TEXT_TYPES, contentFor, sourceText } from "../notebook.js";
import { RefError, parseProject } from "../refs.js";
import { DESTRUCTIVE, WRITE, projectParam, refParam, run, type ToolContext } from "./common.js";

const typeParam = z
  .enum(TEXT_TYPES)
  .describe(
    'Sub-block type: markdown (rich text), code (with language), mermaid (diagram source), equation (LaTeX), question (JSON {"question","answer"}), choice (multiple choice, JSON {"question","mode":"single"|"multiple","options":[{"id","text"}],"selected":[ids],"note"}), csv (a data set as CSV text: first line = header; one record per line, so line numbers = rows + 1)',
  );
const positionParam = (what: string) => z.number().int().min(1).optional().describe(`1-based position among the ${what}; omit to append at the end`);

export function registerWriteTools({ server, api, open }: ToolContext) {
  // ---------------------------------------------------------------- projects & templates
  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description: "Creates a new project, empty or as a copy of a template (sections, objectives, sub-blocks and references; not comments).",
      inputSchema: {
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        fromTemplate: z.string().optional().describe('Template id (see list_workspace), e.g. "thesis"'),
      },
      annotations: WRITE,
    },
    run(async ({ name, description, fromTemplate }) => {
      const p = await api.json<ProjectSummary>("POST", "/api/projects", {
        name,
        description,
        ...(fromTemplate ? { from: { kind: "templates", id: parseProject(fromTemplate).id } } : {}),
      });
      return `Created projects/${p.id} "${p.name}" with ${p.sections} section(s)${p.createdFrom ? ` from template "${p.createdFrom.name}"` : ""}. Use project "${p.id}".`;
    }),
  );

  server.registerTool(
    "create_template",
    {
      title: "Create a template",
      description: "Creates a new template, empty or as a copy of an existing project (comments are not copied). Templates are edited with the same tools, using project \"templates/<id>\".",
      inputSchema: {
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        fromProject: z.string().optional().describe("Project id to copy"),
      },
      annotations: WRITE,
    },
    run(async ({ name, description, fromProject }) => {
      const t = await api.json<ProjectSummary>("POST", "/api/templates", {
        name,
        description,
        ...(fromProject ? { from: { kind: "projects", id: parseProject(fromProject).id } } : {}),
      });
      return `Created templates/${t.id} "${t.name}" with ${t.sections} section(s). Use project "templates/${t.id}".`;
    }),
  );

  // ---------------------------------------------------------------- sections
  server.registerTool(
    "create_section",
    {
      title: "Create a section",
      description: "Adds a section (or a sub-section under `parent`) with an optional objective explaining why it exists.",
      inputSchema: {
        project: projectParam,
        title: z.string().min(1).max(200),
        parent: z.string().optional().describe("Parent section reference (e.g. §2) for a sub-section; omit for a top-level section"),
        position: positionParam("siblings"),
        objective: z.string().max(20000).optional(),
      },
      annotations: WRITE,
    },
    run(async ({ project, title, parent, position, objective }) => {
      const nb = await open(project);
      const parentEntry = parent ? await nb.resolveSection(parent) : null;
      const created = await api.json<NotebookEntry>("POST", `${nb.base}/blocks`, {
        title,
        parentId: parentEntry?.id ?? null,
        ...(position ? { position: position - 1 } : {}),
      });
      if (objective) await api.json("PATCH", `${nb.base}/blocks/${created.id}`, { objective });
      const after = await NotebookView.load(api, nb.project);
      const entry = after.data.blocks.find((b) => b.id === created.id)!;
      return `Created ${after.sectionLabel(entry)}${parentEntry ? ` under ${nb.num(parentEntry)}` : ""}. Add content with add_subblock.`;
    }),
  );

  server.registerTool(
    "update_section",
    {
      title: "Update a section",
      description: "Renames a section and/or sets its objective (an empty objective removes it).",
      inputSchema: { project: projectParam, section: refParam("Section"), title: z.string().min(1).max(200).optional(), objective: z.string().max(20000).optional() },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run(async ({ project, section, title, objective }) => {
      if (title === undefined && objective === undefined) throw new RefError("Nothing to update: pass title and/or objective.");
      const nb = await open(project);
      const entry = await nb.resolveSection(section);
      await api.json("PATCH", `${nb.base}/blocks/${entry.id}`, { ...(title ? { title } : {}), ...(objective !== undefined ? { objective } : {}) });
      return `Updated ${nb.num(entry)} (id ${entry.id})${title ? `: title "${title}"` : ""}${objective !== undefined ? (objective ? "; objective set" : "; objective removed") : ""}.`;
    }),
  );

  server.registerTool(
    "move_section",
    {
      title: "Move a section",
      description: "Moves a section (with its sub-sections) under another parent and/or to another position. Outline numbers change; ids stay.",
      inputSchema: {
        project: projectParam,
        section: refParam("Section to move"),
        parent: z.string().optional().describe('New parent section reference, or "root" for top level; omit to keep the current parent'),
        position: positionParam("new siblings"),
      },
      annotations: WRITE,
    },
    run(async ({ project, section, parent, position }) => {
      const nb = await open(project);
      const entry = await nb.resolveSection(section);
      const blocks = nb.data.blocks;
      const subtree = new Set<string>([entry.id]);
      for (const b of blocks) if (b.parentId && subtree.has(b.parentId)) subtree.add(b.id); // depth-first order
      const newParent = parent === undefined ? entry.parentId : parent === "root" ? null : (await nb.resolveSection(parent)).id;
      if (newParent && subtree.has(newParent)) throw new RefError("A section cannot be moved inside itself.");
      const children = new Map<string | null, string[]>();
      for (const b of blocks) if (b.id !== entry.id) children.set(b.parentId, [...(children.get(b.parentId) ?? []), b.id]);
      const siblings = children.get(newParent) ?? [];
      siblings.splice(position ? Math.min(position - 1, siblings.length) : siblings.length, 0, entry.id);
      children.set(newParent, siblings);
      const placement: { id: string; parentId: string | null }[] = [];
      const visit = (p: string | null) => (children.get(p) ?? []).forEach((id) => (placement.push({ id, parentId: p }), visit(id)));
      visit(null);
      await api.json("PATCH", `${nb.base}/blocks/reorder`, { blocks: placement });
      const after = await NotebookView.load(api, nb.project);
      return `Moved "${entry.title}" (id ${entry.id}) from ${nb.num(entry)} to ${after.num(entry)}.`;
    }),
  );

  server.registerTool(
    "delete_section",
    {
      title: "Delete a section",
      description: "Permanently deletes a section with all its sub-sections, sub-blocks, files and comments. Ask the user before using it.",
      inputSchema: { project: projectParam, section: refParam("Section to delete") },
      annotations: DESTRUCTIVE,
    },
    run(async ({ project, section }) => {
      const nb = await open(project);
      const entry = await nb.resolveSection(section);
      const nested = nb.data.blocks.filter((b) => nb.numbers.get(b.id)!.startsWith(`${nb.numbers.get(entry.id)}.`)).length;
      await api.json("DELETE", `${nb.base}/blocks/${entry.id}`);
      return `Deleted ${nb.sectionLabel(entry)}${nested ? ` and ${nested} sub-section(s)` : ""}. Numbers of the following sections have shifted.`;
    }),
  );

  // ---------------------------------------------------------------- sub-blocks
  server.registerTool(
    "add_subblock",
    {
      title: "Add a sub-block",
      description:
        "Adds a content sub-block to a section: markdown, code (set language), mermaid, equation (LaTeX), question (question + answer), choice (multiple choice) or csv (a data set). Question and choice content is JSON, csv content is CSV text (see type). Optional title and objective.",
      inputSchema: {
        project: projectParam,
        section: refParam("Target section"),
        type: typeParam,
        content: z.string().describe("Source text: Markdown, code, Mermaid diagram, LaTeX, JSON for question/choice, CSV for csv"),
        language: z.string().optional().describe('For code: language id, e.g. "python", "typescript", "sql"'),
        title: z.string().max(200).optional(),
        objective: z.string().max(20000).optional(),
        position: positionParam("section's sub-blocks"),
      },
      annotations: WRITE,
    },
    run(async ({ project, section, type, content, language, title, objective, position }) => {
      const nb = await open(project);
      const entry = await nb.resolveSection(section);
      const created = await api.json<SubBlock>("POST", `${nb.base}/blocks/${entry.id}/subblocks`, {
        type,
        content: contentFor(type, content, { language }),
        ...(title ? { title } : {}),
        ...(objective ? { objective } : {}),
        ...(position ? { position: position - 1 } : {}),
      });
      const after = await NotebookView.load(api, nb.project);
      const e = after.data.blocks.find((b) => b.id === entry.id)!;
      const index = e.subBlocks.findIndex((s) => s.id === created.id) + 1;
      return `Added ${after.subLabel(e, created, index)} to ${after.sectionLabel(e)}.`;
    }),
  );

  server.registerTool(
    "update_subblock",
    {
      title: "Replace a sub-block",
      description:
        "Replaces a sub-block's whole content and/or sets its title/objective (empty string removes them). For small changes prefer edit_subblock_text. Pass expectedRev (from read_subblock) to avoid overwriting edits made meanwhile by the user.",
      inputSchema: {
        project: projectParam,
        subblock: refParam("Sub-block"),
        content: z.string().optional().describe("New full source text"),
        language: z.string().optional().describe("For code sub-blocks: change the language"),
        title: z.string().max(200).optional(),
        objective: z.string().max(20000).optional(),
        expectedRev: z.number().int().min(0).optional(),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run(async ({ project, subblock, content, language, title, objective, expectedRev }) => {
      const nb = await open(project);
      const r = await nb.resolveSubBlock(subblock);
      const current = (await nb.block(r.entry.id)).subBlocks[r.index - 1];
      const newContent =
        content !== undefined ? contentFor(current.type, content, { language, existing: current.content })
        : language !== undefined && current.type === "code" ? contentFor("code", sourceText(current) ?? "", { language })
        : undefined;
      if (newContent === undefined && title === undefined && objective === undefined) throw new RefError("Nothing to update: pass content, language, title and/or objective.");
      const updated = await api.json<SubBlock>("PATCH", `${nb.base}/blocks/${r.entry.id}/subblocks/${r.ref.id}`, {
        ...(newContent !== undefined ? { content: newContent } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(objective !== undefined ? { objective } : {}),
        ...(expectedRev !== undefined ? { expectedRev } : {}),
      });
      return `Updated ${nb.subLabel(r.entry, updated, r.index)} — now rev ${updated.rev ?? 0}.`;
    }),
  );

  server.registerTool(
    "edit_subblock_text",
    {
      title: "Edit text precisely",
      description:
        "Applies precise edits to a sub-block's source, atomically and in order: {find, replace} (the text must occur exactly once unless all=true — include enough context) or {lines:{first,last}, text} to replace source lines (text \"\" deletes them; last = first-1 inserts before `first`). Line numbers are those shown by read_subblock. Nothing changes if any edit fails.",
      inputSchema: {
        project: projectParam,
        subblock: refParam("Sub-block"),
        edits: z
          .array(
            z.union([
              z.object({ find: z.string().min(1), replace: z.string(), all: z.boolean().optional() }),
              z.object({ lines: z.object({ first: z.number().int().min(1), last: z.number().int().min(0) }), text: z.string() }),
            ]),
          )
          .min(1),
        expectedRev: z.number().int().min(0).optional(),
      },
      annotations: WRITE,
    },
    run(async ({ project, subblock, edits, expectedRev }) => {
      const nb = await open(project);
      const r = await nb.resolveSubBlock(subblock);
      const updated = await api.json<SubBlock>("POST", `${nb.base}/blocks/${r.entry.id}/subblocks/${r.ref.id}/edit`, { edits, expectedRev });
      const text = sourceText(updated) ?? "";
      return `Applied ${edits.length} edit(s) to ${nb.subLabel(r.entry, updated, r.index)} — now rev ${updated.rev ?? 0}, ${text.replace(/\n$/, "").split("\n").length} lines.`;
    }),
  );

  server.registerTool(
    "move_subblock",
    {
      title: "Move a sub-block",
      description: "Moves a sub-block to another position within its section.",
      inputSchema: { project: projectParam, subblock: refParam("Sub-block"), position: z.number().int().min(1).describe("New 1-based position") },
      annotations: WRITE,
    },
    run(async ({ project, subblock, position }) => {
      const nb = await open(project);
      const r = await nb.resolveSubBlock(subblock);
      const ids = r.entry.subBlocks.map((s) => s.id).filter((id) => id !== r.ref.id);
      ids.splice(Math.min(position - 1, ids.length), 0, r.ref.id);
      await api.json("PATCH", `${nb.base}/blocks/${r.entry.id}/subblocks/reorder`, { order: ids });
      return `Moved ${r.ref.type} (id ${r.ref.id}) from ${nb.subRef(r.entry, r.index)} to ${nb.subRef(r.entry, ids.indexOf(r.ref.id) + 1)}.`;
    }),
  );

  server.registerTool(
    "delete_subblock",
    {
      title: "Delete a sub-block",
      description: "Permanently deletes a sub-block (its files and comments). Ask the user before using it.",
      inputSchema: { project: projectParam, subblock: refParam("Sub-block to delete"), deleteAssets: z.boolean().default(false).describe("Also delete image files only it uses") },
      annotations: DESTRUCTIVE,
    },
    run(async ({ project, subblock, deleteAssets }) => {
      const nb = await open(project);
      const r = await nb.resolveSubBlock(subblock);
      await api.json("DELETE", `${nb.base}/blocks/${r.entry.id}/subblocks/${r.ref.id}?deleteAssets=${deleteAssets}`);
      return `Deleted ${nb.subLabel(r.entry, r.ref, r.index)}; the following sub-blocks of ${nb.num(r.entry)} moved up by one.`;
    }),
  );

}
