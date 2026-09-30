# Sourcebook

Sourcebook is a local, single-user, block-based Markdown notebook. It is the human-owned "source"
document where ideas, structure and design decisions are authored before development happens elsewhere.
It never executes code: it edits content and persists it as plain Markdown/source files plus exported assets.

## Requirements
- Node.js ≥ 22 and pnpm (`corepack enable`)

## Development
```bash
pnpm install
pnpm dev          # server on :4000 (workspace ~/Sourcebook) + Vite client on http://localhost:5173
pnpm test         # vitest in all packages
pnpm typecheck
```
The workspace folder holds all projects and templates. Default `~/Sourcebook`; override with
`--workspace /path` (e.g. `pnpm --filter @sourcebook/server exec tsx src/index.ts --workspace /path`) or
`SOURCEBOOK_WORKSPACE`. Missing folders are created automatically.

## Layout
```
packages/shared   zod schemas, shared types, sub-block registry contract + core type definitions
packages/server   Fastify REST API, filesystem stores, remark (validation + combined Markdown)
packages/client   React + Vite UI: home (projects/templates), outline (dnd-kit), TipTap, mermaid, Excalidraw, KaTeX
packages/mcp      MCP server for LLM assistants (tools, resources, prompts; stdio binary + library used by /mcp)
```

## On-disk format
```
~/Sourcebook/
  projects/
    payment-service/            one project = one folder (the id is the folder name)
      project.json              name, description, createdAt, createdFrom?
      notebook.json             ordered index: id, title, parentId, order, folder
      references/               project input files of any type, user-defined folders (read-only in the app)
        .mcp/<file path>/       generated for the assistant: content.md, manifest.json, pages/p001.webp…
      bibliography.json         citable sources (key, type, name, authors, year, venue, title, DOI, link, BibTeX…)
      blocks/
        001-introduction/
          block.json            id, title, parentId, order, objective?, ordered sub-block refs
          subblocks/01-markdown.md
          subblocks/01-markdown.comments.json   comments on that sub-block (threads + replies)
        002-architecture/
          subblocks/01-mermaid.mmd, 01-mermaid.png, 01-mermaid.svg
          subblocks/02-drawing.excalidraw, 02-drawing.png
        003-data-model/         (nested under 002; numbering is depth-first)
          assets/<id>.png       uploaded images
          subblocks/01-image.md ![alt](../assets/<id>.png "caption")
          subblocks/02-code.py  code sub-block: the extension carries the language
  templates/
    design-doc/                 same format as a project
```

## REST API

### Workspace
| Method | Path | |
|---|---|---|
| GET / POST | `/api/projects` · `/api/templates` | list (most recently modified first) / create `{ name, description?, from?: { kind, id } }` — `from` copies a project or template (comments excluded) |
| GET / PATCH / DELETE | `/api/{projects,templates}/:projectId` | summary · `{ name?, description? }` · delete the folder |
| GET | `/api/templates/:projectId/archive.zip` | template as ZIP: `sourcebook-template.json` manifest + the template folder (comments excluded) |
| POST | `/api/templates/import?dryRun=1&name=…` | multipart `file` (ZIP). Validated completely first: 400 `{ error, details: { errors[], warnings[] } }` if invalid; `dryRun` returns a preview `{ name, sections, subBlocks, references, warnings }` without importing |
| GET / PUT | `/api/settings/mcp` | `{ http: { enabled }, stdio: { enabled }, readOnly }` + connection parameters (URL, stdio command/args/cwd/env) |
| GET / PUT | `/api/user` | current user profile `{ name, username }` (stored in `~/.config/sourcebook/user.json`) |
| GET | `/api/types` | registered sub-block types |

### Inside a project or template
All paths below are relative to `/api/projects/:projectId` or `/api/templates/:projectId`
(written `…` below). Templates are edited exactly like projects.

| Method | Path | |
|---|---|---|
| GET | `…/notebook` | structure from notebook.json |
| GET | `…/markdown` | whole notebook as one Markdown document |
| GET | `…/export` | `{ fileName, markdown, files }` — document + referenced local files |
| GET | `…/export.zip` | the document plus every referenced file, same relative paths |
| POST | `…/blocks` | `{ title, parentId?, position? }` |
| GET / PATCH / DELETE | `…/blocks/:id` | PATCH `{ title?, parentId?, objective? }` |
| GET | `…/blocks/:id/deletion-impact` | nested blocks and asset files a DELETE would remove |
| PATCH | `…/blocks/reorder` | `{ blocks: [{ id, parentId }] }` — all blocks, depth-first |
| POST | `…/blocks/:id/subblocks` | `{ type, content?, props?, position? }` |
| PATCH | `…/blocks/:blockId/subblocks/:subBlockId` | `{ content?, title?, objective?, props?, exports?: [{ ext, mimeType, dataBase64 }], expectedRev? }` — 409 if the revision changed |
| POST | `…/blocks/:blockId/subblocks/:subBlockId/edit` | `{ edits: [{ find, replace, all? } \| { lines: { first, last }, text }], expectedRev? }` — atomic text edits of the source |
| GET | `…/events` | Server-Sent Events: `{ type, blockId?, subBlockId?, rev?, origin }` after every change |
| PATCH | `…/blocks/:blockId/subblocks/reorder` | `{ order: [subBlockId…] }` |
| DELETE | `…/blocks/:blockId/subblocks/:subBlockId?deleteAssets=true` | → `{ deletedAssets, keptAssets }` |
| POST | `…/assets?blockId=…` | multipart `file` → `{ path, url }` |
| DELETE | `…/blocks/:id/assets/:name` | 409 while still referenced by a sub-block |
| GET | `…/blocks/:id/files/*` | files inside a block folder |
| GET | `…/blocks/:blockId/subblocks/:subBlockId/comments` | `{ comments }`, oldest first, each with `replies` |
| POST | `…/comments` | `{ text, author?, anchor? }` — author defaults to the user profile; for Markdown/Code `anchor` is either `{ lines: { first, last } }` (source lines of the file) or a quote `{ unit: "text"\|"lines", exact, prefix?, suffix?, start? }` |
| PATCH | `…/comments/:commentId` | `{ anchor }` re-attach (lines or quote), or `{ anchor: null }` for a general comment |
| POST | `…/comments/:commentId/replies` | `{ text, author? }` |
| DELETE | `…/comments/:commentId` · `…/comments/:commentId/replies/:replyId` | |
| GET | `…/references` | tree of `references/` |
| GET | `…/references/file/*` | a reference, inline (`?download=1` to download) |
| POST | `…/references/upload?dir=…` | multipart, one or more `file` fields (≤ 100 MB each) |
| POST | `…/references/folders` | `{ path }` |
| PATCH | `…/references/rename` | `{ path, newName }` |
| DELETE | `…/references?path=…` | file or folder (recursive) |
| POST | `…/references/zip` | `{ paths, base? }` → streamed ZIP (folders included recursively) |
| POST | `…/references/delete` | `{ paths }` → `{ deleted }` — attachments of deleted files are removed |
| POST | `…/references/mcp/convert` | `{ paths, force? }` → `{ results: [{ path, status, parts?, pageImages?, imageOnlyParts?, error? }] }` — converts documents (folders expanded) to Markdown for the assistant now (otherwise automatic) |
| GET / DELETE | `…/references/mcp?path=…` | converted content `{ info, manifest, markdown }` · delete the generated files |
| POST | `…/references/mcp/pages` | `{ path, pages: "all" \| [n…] }` — render PDF page images |
| GET | `…/references/mcp/page?path=…&n=…` | a rendered page image (WebP) |
| GET | `…/references/mcp/figure?path=…&id=p3-1` | a figure cut out of a PDF page (WebP) |
| GET | `…/references/images` | `{ images: [{ path, name, size }], documents: [{ path, name, figures }] }` — image files and document figures usable in image sub-blocks |
| POST | `…/blocks/:id/assets/from-reference` | `{ path, figure?, attachTo? }` → `{ path, url, alt, caption }` — copies an image reference or a figure into the block's assets (attaching the source file to sub-block `attachTo`) |
| POST | `…/blocks/:id/images/from-reference` | `{ path, figure?, caption?, alt?, title?, position? }` — a new image sub-block from an image reference or a figure, with the source attached |
| PUT | `…/references/mcp/transcription` | `{ path, page, markdown, by? }` — replace a page's text with a transcription |
| GET | `…/references/usages?path=…` | where a file (or the files of a folder) is attached or linked: `[{ path, kind: section\|subblock\|text, blockId, subBlockId?, ref, title }]` |
| PUT | `…/blocks/:id/references` · `…/blocks/:blockId/subblocks/:subBlockId/references` | `{ paths }` — reference files attached to the whole section / sub-block (400 on missing files). Renaming a file or folder updates attachments and Markdown links |
| GET / POST | `…/bibliography` | list (`?q=&type=`) / create `{ type, name, key?, authors?, year?, venue?, title?, abstract?, description?, doi?, url?, textCitation?, bibtex?, generate? }` — without `key` one is derived (or taken from `bibtex`); `generate: true` fills a missing BibTeX and text citation |
| GET / PATCH / DELETE | `…/bibliography/:key` | PATCH any field, `key` to rename (updates every `bib:` link and association) · DELETE → 409 `{ details: { usages } }` if used, `?force=true` removes the associations |
| GET | `…/bibliography/:key/usages` | `[{ kind: section\|subblock\|text, blockId, subBlockId?, ref, title }]` |
| POST | `…/bibliography/import` | `{ bibtex, onDuplicate: skip\|replace }` → `{ created, replaced, skipped, errors }` |
| POST | `…/bibliography/generate` | fields → `{ bibtex, textCitation }` (nothing saved) |
| GET | `…/bibliography.bib` | all entries as BibTeX |
| PUT | `…/blocks/:id/citations` · `…/blocks/:blockId/subblocks/:subBlockId/citations` | `{ keys }` — sources associated with the whole section / sub-block (400 on unknown keys) |

Citations in Markdown text are links `[Name](bib:key)`. The combined export turns them into links to a final
**References** section (text citations of every cited or associated source) and the ZIP adds `bibliography.bib`.

Anchored comments are returned with `resolved: { lines: { first, last } }` — where their text is now in the
source file — or `resolved: null` when the text is gone (detached).

```bash
# Create a project from a template, then comment lines 12-14 of one of its code sub-blocks
curl -X POST localhost:4000/api/projects -H 'content-type: application/json' \
  -d '{"name": "Checkout", "from": {"kind": "templates", "id": "design-doc"}}'
curl -X POST localhost:4000/api/projects/checkout/blocks/$BLOCK/subblocks/$SUB/comments \
  -H 'content-type: application/json' \
  -d '{"text": "Handle the timeout here", "anchor": {"lines": {"first": 12, "last": 14}}}'
```

## Working with an AI assistant (MCP)
`packages/mcp` is an [MCP](https://modelcontextprotocol.io) server that lets an LLM assistant read and edit
projects and templates with you — sections, sub-blocks, lines, comments and references — through the same REST API
(same validation; your open editor updates live). The Sourcebook server must be running (`pnpm dev`).

Open **Settings (avatar) → AI assistant (MCP)** to enable or disable each transport, give the assistant read-only
access, and copy the exact URL / command / JSON for your LLM client (computed for your machine). Settings are stored
in `~/.config/sourcebook/settings.json` and enforced by the server: requests from a disabled transport, and MCP
writes in read-only mode, are refused.

**stdio** (the client starts the process):
```bash
claude mcp add sourcebook -- pnpm --silent --dir "/path/to/sourcebook" --filter @sourcebook/mcp exec tsx src/stdio.ts
```
**HTTP** (built into the Sourcebook server, local requests only):
```bash
claude mcp add --transport http sourcebook http://127.0.0.1:4000/mcp
```
Claude Desktop (`claude_desktop_config.json`):
```json
{ "mcpServers": { "sourcebook": { "command": "pnpm", "args": ["--silent", "--dir", "/path/to/sourcebook", "--filter", "@sourcebook/mcp", "exec", "tsx", "src/stdio.ts"] } } }
```
Environment: `SOURCEBOOK_URL` (stdio, default `http://127.0.0.1:4000`), `SOURCEBOOK_MCP_READONLY=1` (reading tools only),
`SOURCEBOOK_MCP_AUTHOR_NAME` / `SOURCEBOOK_MCP_AUTHOR_USERNAME` (author of the assistant's comments, default
"Claude (assistant)" / `claude`).

**Ask AI**: the ✨💬 button on the document, sections, sub-blocks, selected text/code lines, comment threads and
reference files prepares a ready-to-paste request (brainstorming, critique, build/fill, improve/rewrite, comment, or
your own prompt) that points the assistant at exactly that element.

**Reference documents**: files the assistant cannot read as they are — PDF, Word (`.docx`, `.doc`), PowerPoint
(`.pptx`), Excel (`.xlsx`), OpenDocument (`.odt/.odp/.ods`), RTF, EPUB, HTML, Jupyter, email (`.eml/.msg`) and ZIP —
are converted to Markdown automatically (in Node, locally), split into pages/slides/sheets. PDF pages without usable
text (scans, figures, diagrams) are also rendered as images, which the assistant reads with `read_reference_pages`
and can transcribe back into the text; figures of PDF pages (images, charts, diagrams) are cut out with their captions
(`read_reference_figures`). Conversions run in a background worker thread. The References view shows an "Assistant" status per file and lets you inspect,
reconvert or delete the generated content.

**References** you can use in the conversation (the 🔗 buttons in the editor copy them):
`§2.1` section · `§2.1#3` 3rd sub-block of §2.1 · `§2.1#3:L10-14` its source lines · `§2.1#3 "quoted text"` ·
ids and `sourcebook://projects/<id>/subblocks/<id>` URIs.

**Tools**: `list_workspace`, `get_outline`, `read_section`, `read_subblock`, `read_document`, `search`, `list_references`,
`read_reference` (text as it is, images as images, documents as converted Markdown, by `parts`), `read_reference_pages`
(PDF pages as images), `read_reference_figures` (figures cut out of PDFs, with captions), `list_comments` · `save_reference_transcription` · `create_project`, `create_template`, `create_section`, `add_subblock`,
`update_section`, `update_subblock`, `edit_subblock_text` (find/replace or line ranges, atomic), `move_section`,
`move_subblock` · `add_image_from_reference` (an image file or a PDF figure as an image sub-block) · `add_comment`,
`reply_to_comment`, `reanchor_comment` · `attach_reference` / `detach_reference`
(reference files of a whole section or sub-block) · bibliography: `list_bibliography`,
`read_bib_entry`, `export_bibtex`, `add_bib_entry`, `update_bib_entry`, `import_bibtex`, `cite` / `uncite` (associate
sources with a section or sub-block; in text the assistant writes `[Name](bib:key)` with `edit_subblock_text`) ·
destructive (the client asks first): `delete_section`, `delete_subblock`, `delete_comment`, `delete_bib_entry`. Prompts: `review-section`, `fill-placeholders`, `discuss-comments`.

Examples: *"Show me the outline of the payment-service project"*, *"Rewrite §2.1#1 more concisely"*,
*"Comment §3.2#2:L4-6: the timeout is not handled"*, *"Answer the open comments in §4"*,
*"Create a project from the thesis template and fill in the introduction with me"*,
*"Add this BibTeX to the bibliography and cite it in §2.1#1 where we discuss the protocol"*.

## Adding a sub-block type
1. `packages/shared/src/types/<type>.ts`: a `SubBlockTypeCore` (zod content schema, source extension,
   serialize/deserialize, `toMarkdown`, optional `sourceExtFor`, `assetsOf`, `commentAnchor`), added to `coreTypes`.
2. `packages/client/src/subblocks/index.ts`: register it with its React `component`
   (and optional `exportArtifacts`).

No block, reorder or REST code changes are needed.

See `docs/decisions.md` for implementation choices and known limitations.
