import { z } from "zod";
import { RefError } from "../refs.js";
import { WRITE, projectParam, refParam, run, type ToolContext } from "./common.js";

const pathsParam = z.array(z.string().min(1)).min(1).describe('Paths inside references/, as in list_references (e.g. "papers/spec.pdf")');
const clean = (p: string) => p.replace(/^\/+/, "").replace(/^references\//, "");

/** Associating reference files with whole sections and sub-blocks. */
export function registerAttachmentTools({ server, api, open }: ToolContext) {
  const setFiles = async (project: string, target: string, paths: string[], op: "add" | "remove") => {
    const nb = await open(project);
    const r = await nb.resolve(target);
    if (r.kind === "comment") throw new RefError("Attach reference files to a section or a sub-block, not a comment.");
    const block = await nb.block(r.entry.id);
    const current = (r.kind === "section" ? block.references : block.subBlocks[r.index - 1].references) ?? [];
    const wanted = paths.map(clean);
    const next = op === "add" ? [...new Set([...current, ...wanted])] : current.filter((p) => !wanted.includes(p));
    const url = r.kind === "section" ? `${nb.base}/blocks/${r.entry.id}/references` : `${nb.base}/blocks/${r.entry.id}/subblocks/${r.ref.id}/references`;
    const res = await api.json<{ paths: string[] }>("PUT", url, { paths: next });
    const label = r.kind === "section" ? nb.num(r.entry) : nb.subRef(r.entry, r.index);
    return `${label} now has these reference files: ${res.paths.length ? res.paths.join(", ") : "none"}.`;
  };

  server.registerTool(
    "attach_reference",
    {
      title: "Attach reference files",
      description:
        "Associates reference files (from list_references) with a whole section or sub-block, e.g. the spec or dataset it is based on. To link a file inside Markdown text use [name](../../../references/<path>) with edit_subblock_text.",
      inputSchema: { project: projectParam, target: refParam("Section or sub-block"), paths: pathsParam },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run(async ({ project, target, paths }) => setFiles(project, target, paths, "add")),
  );

  server.registerTool(
    "add_image_from_reference",
    {
      title: "Add an image from the references",
      description:
        "Adds an image sub-block to a section from an image reference file, or from a figure cut out of a reference PDF (figure ids like \"p3-1\" come from read_reference / read_reference_figures). The image is copied into the section, its caption defaults to the figure's caption, and the source file is attached to the sub-block.",
      inputSchema: {
        project: projectParam,
        section: refParam("Section"),
        path: z.string().min(1).describe('Image file or document inside references/, e.g. "papers/paper.pdf"'),
        figure: z.string().regex(/^p\d+-\d+$/).optional().describe('Figure id of the document, e.g. "p3-1"'),
        caption: z.string().max(2000).optional().describe("Caption (default: the figure's caption)"),
        alt: z.string().max(500).optional().describe("Alternative text describing the image"),
        title: z.string().max(200).optional().describe("Sub-block title"),
        position: z.number().int().positive().optional().describe("1-based position among the section's sub-blocks (default: last)"),
      },
      annotations: WRITE,
    },
    run(async ({ project, section, path, figure, caption, alt, title, position }) => {
      const nb = await open(project);
      const r = await nb.resolve(section);
      if (r.kind !== "section") throw new RefError("Give a section (e.g. §2.1) to add the image to.");
      const sub = await api.json<{ id: string; content: { caption: string } }>("POST", `${nb.base}/blocks/${r.entry.id}/images/from-reference`, {
        path: clean(path),
        ...(figure ? { figure } : {}),
        ...(caption !== undefined ? { caption } : {}),
        ...(alt !== undefined ? { alt } : {}),
        ...(title ? { title } : {}),
        ...(position ? { position: position - 1 } : {}),
      });
      const fresh = await open(project);
      const entry = fresh.data.blocks.find((b) => b.id === r.entry.id)!;
      const index = (await fresh.block(entry.id)).subBlocks.findIndex((s) => s.id === sub.id) + 1;
      return `Added ${fresh.subRef(entry, index)} (image from references/${clean(path)}${figure ? `, figure ${figure}` : ""})${sub.content.caption ? ` with caption "${sub.content.caption}"` : ""}; the source is attached to it.`;
    }),
  );

  server.registerTool(
    "detach_reference",
    {
      title: "Detach reference files",
      description: "Removes reference files associated with a section or sub-block (the files and links in the text are not touched).",
      inputSchema: { project: projectParam, target: refParam("Section or sub-block"), paths: pathsParam },
      annotations: { ...WRITE, idempotentHint: true },
    },
    run(async ({ project, target, paths }) => setFiles(project, target, paths, "remove")),
  );
}
