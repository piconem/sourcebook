import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectSummary } from "@sourcebook/shared";
import type { SourcebookApi } from "./api.js";
import { NotebookView } from "./notebook.js";
import type { ProjectRef } from "./refs.js";

/**
 * Resources clients can attach to the conversation: a project's outline and document, and single
 * sections/sub-blocks by their stable URIs (sourcebook://projects/<id>/subblocks/<subBlockId>).
 */
export function registerResources(server: McpServer, api: SourcebookApi) {
  const project = (vars: Record<string, string | string[]>): ProjectRef => ({
    kind: String(vars.kind) === "templates" ? "templates" : "projects",
    id: String(vars.projectId),
  });
  const listProjects = async () => {
    const out: { uri: string; name: string; description?: string; mimeType: string }[] = [];
    for (const kind of ["projects", "templates"] as const) {
      for (const p of await api.json<ProjectSummary[]>("GET", `/api/${kind}`)) {
        out.push({ uri: `sourcebook://${kind}/${p.id}/outline`, name: `${p.name} (${kind === "projects" ? "project" : "template"})`, description: p.description || undefined, mimeType: "text/plain" });
      }
    }
    return { resources: out };
  };

  server.registerResource(
    "outline",
    new ResourceTemplate("sourcebook://{kind}/{projectId}/outline", { list: listProjects }),
    { title: "Project outline", description: "Numbered outline of a Sourcebook project or template", mimeType: "text/plain" },
    async (uri, vars) => ({
      contents: [{ uri: uri.href, mimeType: "text/plain", text: await (await NotebookView.load(api, project(vars))).outline({ previews: true }) }],
    }),
  );

  server.registerResource(
    "document",
    new ResourceTemplate("sourcebook://{kind}/{projectId}/document", { list: undefined }),
    { title: "Whole document", description: "A project compiled into one Markdown document", mimeType: "text/markdown" },
    async (uri, vars) => {
      const p = project(vars);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: (await api.text(`/api/${p.kind}/${p.id}/markdown`)).text }] };
    },
  );

  server.registerResource(
    "section",
    new ResourceTemplate("sourcebook://{kind}/{projectId}/sections/{blockId}", { list: undefined }),
    { title: "Section", description: "A section with all its sub-blocks", mimeType: "text/plain" },
    async (uri, vars) => {
      const nb = await NotebookView.load(api, project(vars));
      const entry = await nb.resolveSection(String(vars.blockId));
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: await nb.formatSection(entry, { lineNumbers: false }) }] };
    },
  );

  server.registerResource(
    "subblock",
    new ResourceTemplate("sourcebook://{kind}/{projectId}/subblocks/{subBlockId}", { list: undefined }),
    { title: "Sub-block", description: "One sub-block with numbered source lines", mimeType: "text/plain" },
    async (uri, vars) => {
      const nb = await NotebookView.load(api, project(vars));
      const r = await nb.resolveSubBlock(String(vars.subBlockId));
      const sub = (await nb.block(r.entry.id)).subBlocks[r.index - 1];
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: nb.formatSubBlock(r.entry, sub, r.index, { lineNumbers: true }) }] };
    },
  );
}
