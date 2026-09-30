import { BIB_TYPES, type BibEntry, type BibUsage, type ImportBibResult } from "@sourcebook/shared";
import { z } from "zod";
import { RefError } from "../refs.js";
import { DESTRUCTIVE, READ, WRITE, projectParam, refParam, run, type ToolContext } from "./common.js";

const typeIds = BIB_TYPES.map((t) => t.id) as [string, ...string[]];
const keyParam = z.string().min(1).describe('Entry key, e.g. "knuth1984" (see list_bibliography); "bib:" prefix allowed');
const cleanKey = (k: string) => k.replace(/^bib:/, "");

const fields = {
  type: z.enum(typeIds).describe(`Entry type: ${BIB_TYPES.map((t) => `${t.id} (${t.label})`).join(", ")}`),
  name: z.string().min(1).max(200).describe('Short label shown as citation text, e.g. "Knuth 1984"'),
  authors: z.string().max(2000).optional().describe('Authors or creators, e.g. "Knuth, Donald E.; Lamport, Leslie"'),
  year: z.string().max(20).optional(),
  venue: z.string().max(500).optional().describe("Journal, conference, publisher, website, repository host…"),
  title: z.string().max(1000).optional(),
  abstract: z.string().max(20000).optional(),
  description: z.string().max(20000).optional().describe("Why this source matters for the project"),
  doi: z.string().max(300).optional(),
  url: z.string().max(2000).optional(),
  textCitation: z.string().max(5000).optional(),
  bibtex: z.string().max(50000).optional(),
};

function formatEntry(e: BibEntry): string {
  const out = [`bib:${e.key} — ${e.name} (${e.type})`];
  const add = (label: string, v?: string) => v && out.push(`${label}: ${v}`);
  add("title", e.title);
  add("authors", e.authors);
  add("year", e.year);
  add("venue", e.venue);
  add("doi", e.doi);
  add("url", e.url);
  add("description", e.description);
  add("abstract", e.abstract);
  add("text citation", e.textCitation);
  if (e.bibtex) out.push("bibtex:", e.bibtex);
  out.push(`Cite in Markdown as [${e.name}](bib:${e.key})`);
  return out.join("\n");
}

export function registerBibliographyReadTools({ server, api, open }: ToolContext) {
  server.registerTool(
    "list_bibliography",
    {
      title: "List bibliography",
      description: "Lists the project's bibliography entries (key, type, name, title, year), optionally filtered by text or type.",
      inputSchema: { project: projectParam, query: z.string().optional(), type: z.enum(typeIds).optional() },
      annotations: READ,
    },
    run(async ({ project, query, type }) => {
      const nb = await open(project);
      const q = new URLSearchParams({ ...(query ? { q: query } : {}), ...(type ? { type } : {}) });
      const list = await api.json<BibEntry[]>("GET", `${nb.base}/bibliography?${q}`);
      if (!list.length) return query || type ? "No matching bibliography entries." : "The bibliography is empty.";
      return [`${list.length} entr${list.length === 1 ? "y" : "ies"}:`, ...list.map((e) => `- bib:${e.key} · ${e.type} · ${e.name}${e.title ? ` — ${e.title}` : ""}${e.year ? ` (${e.year})` : ""}`)].join("\n");
    }),
  );

  server.registerTool(
    "read_bib_entry",
    {
      title: "Read a bibliography entry",
      description: "All fields of a bibliography entry (including BibTeX) and where it is used: associated sections/sub-blocks and sub-blocks citing it in their text.",
      inputSchema: { project: projectParam, key: keyParam },
      annotations: READ,
    },
    run(async ({ project, key }) => {
      const nb = await open(project);
      const k = cleanKey(key);
      const e = await api.json<BibEntry>("GET", `${nb.base}/bibliography/${encodeURIComponent(k)}`);
      const usages = await api.json<BibUsage[]>("GET", `${nb.base}/bibliography/${encodeURIComponent(k)}/usages`);
      const used = usages.length
        ? usages.map((u) => `- ${u.ref} "${u.title}" — ${u.kind === "text" ? "cited in the text" : `associated with the whole ${u.kind === "section" ? "section" : "sub-block"}`}`).join("\n")
        : "- not used yet";
      return `${formatEntry(e)}\n\nUsed in:\n${used}`;
    }),
  );

  server.registerTool(
    "export_bibtex",
    {
      title: "Export BibTeX",
      description: "The whole bibliography as a .bib file content, ready for LaTeX.",
      inputSchema: { project: projectParam },
      annotations: READ,
    },
    run(async ({ project }) => {
      const nb = await open(project);
      return (await api.text(`${nb.base}/bibliography.bib`)).text || "The bibliography is empty.";
    }),
  );
}

export function registerBibliographyWriteTools({ server, api, open }: ToolContext) {
  server.registerTool(
    "add_bib_entry",
    {
      title: "Add a bibliography entry",
      description:
        "Adds a source (paper, book, website, software, dataset, video…). Missing BibTeX and text citation are generated from the fields unless generate=false. The key is derived from author/year/title when not given. Only add sources the user provided or confirmed.",
      inputSchema: { project: projectParam, key: z.string().optional(), ...fields, generate: z.boolean().default(true) },
      annotations: WRITE,
    },
    run(async ({ project, ...body }) => {
      const nb = await open(project);
      const e = await api.json<BibEntry>("POST", `${nb.base}/bibliography`, body);
      return `Added bib:${e.key} — ${e.name}. Cite it in Markdown as [${e.name}](bib:${e.key}), or associate it with cite.`;
    }),
  );

  server.registerTool(
    "update_bib_entry",
    {
      title: "Update a bibliography entry",
      description: "Changes fields of an entry. newKey renames it and updates every citation and association. generate=true fills missing BibTeX/text citation.",
      inputSchema: {
        project: projectParam,
        key: keyParam,
        newKey: z.string().optional(),
        type: fields.type.optional(),
        name: fields.name.optional(),
        authors: fields.authors,
        year: fields.year,
        venue: fields.venue,
        title: fields.title,
        abstract: fields.abstract,
        description: fields.description,
        doi: fields.doi,
        url: fields.url,
        textCitation: fields.textCitation,
        bibtex: fields.bibtex,
        generate: z.boolean().optional(),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run(async ({ project, key, newKey, ...rest }) => {
      const nb = await open(project);
      const body = Object.fromEntries(Object.entries({ ...rest, ...(newKey ? { key: cleanKey(newKey) } : {}) }).filter(([, v]) => v !== undefined));
      if (!Object.keys(body).length) throw new RefError("Nothing to update.");
      const e = await api.json<BibEntry>("PATCH", `${nb.base}/bibliography/${encodeURIComponent(cleanKey(key))}`, body);
      return `Updated bib:${e.key}${newKey ? ` (renamed from ${cleanKey(key)}; citations updated)` : ""}.`;
    }),
  );

  server.registerTool(
    "import_bibtex",
    {
      title: "Import BibTeX",
      description: "Imports one or more BibTeX entries (e.g. pasted by the user). Existing keys are skipped unless replace=true.",
      inputSchema: { project: projectParam, bibtex: z.string().min(1), replace: z.boolean().default(false) },
      annotations: WRITE,
    },
    run(async ({ project, bibtex, replace }) => {
      const nb = await open(project);
      const r = await api.json<ImportBibResult>("POST", `${nb.base}/bibliography/import`, { bibtex, onDuplicate: replace ? "replace" : "skip" });
      return [
        r.created.length && `Created: ${r.created.join(", ")}`,
        r.replaced.length && `Replaced: ${r.replaced.join(", ")}`,
        r.skipped.length && `Skipped (already present): ${r.skipped.join(", ")}`,
        r.errors.length && `Errors:\n- ${r.errors.join("\n- ")}`,
      ].filter(Boolean).join("\n") || "Nothing imported.";
    }),
  );

  const setAssociation = async (project: string, target: string, keys: string[], op: "add" | "remove") => {
    const nb = await open(project);
    const r = await nb.resolve(target);
    if (r.kind === "comment") throw new RefError("Associate sources with a section or a sub-block, not a comment.");
    const wanted = keys.map(cleanKey);
    const current = r.kind === "section" ? ((await nb.block(r.entry.id)).citations ?? []) : ((await nb.block(r.entry.id)).subBlocks[r.index - 1].citations ?? []);
    const next = op === "add" ? [...new Set([...current, ...wanted])] : current.filter((k) => !wanted.includes(k));
    const url = r.kind === "section" ? `${nb.base}/blocks/${r.entry.id}/citations` : `${nb.base}/blocks/${r.entry.id}/subblocks/${r.ref.id}/citations`;
    const res = await api.json<{ keys: string[] }>("PUT", url, { keys: next });
    const label = r.kind === "section" ? nb.num(r.entry) : nb.subRef(r.entry, r.index);
    return `${label} is now associated with: ${res.keys.length ? res.keys.join(", ") : "no sources"}.`;
  };

  server.registerTool(
    "cite",
    {
      title: "Associate sources",
      description: "Associates bibliography entries with a whole section or sub-block (to show it is based on them). To cite inside the text use a Markdown link [Name](bib:key) with edit_subblock_text.",
      inputSchema: { project: projectParam, target: refParam("Section or sub-block"), keys: z.array(z.string()).min(1) },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run(async ({ project, target, keys }) => setAssociation(project, target, keys, "add")),
  );

  server.registerTool(
    "uncite",
    {
      title: "Remove associated sources",
      description: "Removes the association of bibliography entries from a section or sub-block (citations in the text are not touched).",
      inputSchema: { project: projectParam, target: refParam("Section or sub-block"), keys: z.array(z.string()).min(1) },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run(async ({ project, target, keys }) => setAssociation(project, target, keys, "remove")),
  );

  server.registerTool(
    "delete_bib_entry",
    {
      title: "Delete a bibliography entry",
      description: "Deletes an entry. If it is used, it fails and lists where, unless force=true (associations are removed; links in the text stay and become dangling). Ask the user first.",
      inputSchema: { project: projectParam, key: keyParam, force: z.boolean().default(false) },
      annotations: DESTRUCTIVE,
    },
    run(async ({ project, key, force }) => {
      const nb = await open(project);
      const r = await api.json<{ removedAssociations: number }>("DELETE", `${nb.base}/bibliography/${encodeURIComponent(cleanKey(key))}?force=${force}`);
      return `Deleted bib:${cleanKey(key)}${r.removedAssociations ? ` and ${r.removedAssociations} association(s)` : ""}.`;
    }),
  );
}
