# Sourcebook

Sourcebook is a local, single-user, block-based Markdown notebook. It is the human-owned "source"
document where ideas, structure and design decisions are authored before development happens elsewhere.
It never executes code: it edits content and persists it as plain Markdown/source files plus exported assets.

## Requirements
- Node.js ≥ 22 and pnpm (`corepack enable`)
- Nothing else: document conversion for the assistant runs in Node; the only native part (`@napi-rs/canvas`, used to
  render PDF pages and figures) is a prebuilt binary that `pnpm install` downloads for your platform

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
        .mcp/<file path>/       generated for the assistant (hidden, rebuilt automatically):
                                content.md, manifest.json, pages/p001.webp… (page images), figures/p003-1.webp… (PDF figures)
      bibliography.json         citable sources (key, type, name, authors, year, venue, title, DOI, link, BibTeX…)
      notifications.json        change notifications received from applications / assistants (not copied with the project)
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
          subblocks/03-question.json   { "question", "answer" }
          subblocks/04-choice.json     { "question", "mode": "single"|"multiple", "options": [{ "id", "text" }], "selected": [ids], "note" }
  templates/
    software-project/           same format as a project
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
| GET | `…/events` | Server-Sent Events: `{ type, blockId?, subBlockId?, rev?, origin }` after every change; `type: "notifications"` when notifications change, `type: "reload"` (with `author`, `message?`, `notificationIds`) for reload requests |
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
| POST | `…/comments/:commentId/resolve` · `…/comments/:commentId/reopen` | resolve (`{ author? }`, default the user profile) / reopen a thread; resolved threads carry `resolution: { by, at }` |
| GET | `…/comments?status=open\|resolved\|all` | `{ threads: [{ blockId, sectionTitle, subBlockId, subBlockIndex, subBlockType, subBlockTitle?, comment }] }` — every thread of the project, in document order |
| GET | `…/notifications` | `{ notifications }`, newest first: `{ id, createdAt, author, summary, targets: [{ blockId, subBlockId?, commentId?, note?, label }], read }` |
| POST | `…/notifications` | `{ summary, targets: [{ blockId, subBlockId?, commentId?, note? }], author?, requestReload? }` — notifies the user of a change (targets: sections, sub-blocks or comments; 400 if one does not exist); `requestReload: true` also asks open editors to reload |
| POST | `…/notifications/:id/read` · `…/notifications/read-all` | mark as read → `{ notifications }` |
| DELETE | `…/notifications` | clear the list |
| POST | `…/reload-request` | `{ message?, notificationIds?, author? }` — asks open editors to reload, listing those notifications (default: the unread ones) |
| GET | `…/references` | tree of `references/`; each file has `mcp: { status, kind, unit?, parts?, pageImages?, figures?, imageOnlyParts?, error? }` (see below) and documents still to convert are queued |
| GET | `…/references/file/*` | a reference, inline (`?download=1` to download) |
| POST | `…/references/upload?dir=…` | multipart, one or more `file` fields (≤ 100 MB each) |
| POST | `…/references/folders` | `{ path }` |
| PATCH | `…/references/rename` | `{ path, newName }` |
| DELETE | `…/references?path=…` | file or folder (recursive) |
| POST | `…/references/zip` | `{ paths, base? }` → streamed ZIP (folders included recursively) |
| POST | `…/references/delete` | `{ paths }` → `{ deleted }` — attachments of deleted files are removed |
| POST | `…/references/mcp/convert` | `{ paths, force? }` → `{ results: [{ path, status, kind, unit?, parts?, pageImages?, figures?, imageOnlyParts?, error? }] }` — converts documents (folders expanded) to Markdown for the assistant now (otherwise automatic) |
| GET / DELETE | `…/references/mcp?path=…` | converted content `{ info, manifest, markdown }` · delete the generated files |
| POST | `…/references/mcp/pages` | `{ path, pages: "all" \| [n…] }` — render PDF page images |
| GET | `…/references/mcp/page?path=…&n=…` | a rendered page image (WebP) |
| GET | `…/references/mcp/figure?path=…&id=p3-1` | a figure cut out of a PDF page (WebP) |
| GET | `…/references/mcp/image?path=…` | an image reference scaled for the assistant (longest side ≤ 1568 px, WebP) |
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

**Change notifications.** An application or script that changes a project tells the user what it did with one
notification per group of changes (a short summary plus the sections, sub-blocks or comments involved). They appear
in the bell menu at the top right of the editor (unread count, author, summary, links to each part); opening one
marks it read, "Mark all as read" and "Clear" manage the list. At the end of a group of changes, a reload request
shows the user a dialog with the message and those notifications, and offers to reload the page (pending edits are
saved first).

```bash
# Tell the user what changed, then ask open editors to reload
curl -X POST localhost:4000/api/projects/checkout/notifications -H 'content-type: application/json' \
  -d '{"summary": "Updated the API section", "targets": [{"blockId": "'$BLOCK'", "subBlockId": "'$SUB'", "note": "new endpoints"}]}'
curl -X POST localhost:4000/api/projects/checkout/reload-request -H 'content-type: application/json' \
  -d '{"message": "Refactoring of §2 complete"}'
```

**Links.** The URL follows what is shown: `#/projects/<id>/s/<sectionId>` (a section),
`…/b/<subBlockId>` (a sub-block), `…/c/<commentId>` (a comment thread, opened in the comments column). Ids are used,
so links survive moving sections; the ↗ buttons of sections and sub-blocks copy them.

```bash
# Create a project from a template, then comment lines 12-14 of one of its code sub-blocks
curl -X POST localhost:4000/api/projects -H 'content-type: application/json' \
  -d '{"name": "Checkout", "from": {"kind": "templates", "id": "software-project"}}'
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

### Reference files and the assistant
Every file in References is made readable by the assistant:
- **Text** (Markdown, code, CSV, JSON, BibTeX, LaTeX, SVG…) is read as it is; **images** (PNG, JPG, GIF, WebP) are
  passed as images (scaled down when large).
- **Documents** — PDF, Word (`.docx`, `.doc`), PowerPoint (`.pptx`), Excel (`.xlsx`), OpenDocument (`.odt/.odp/.ods`),
  RTF, EPUB, HTML, Jupyter, email (`.eml/.msg`) and ZIP — are **converted to Markdown automatically**, locally in Node
  (no Python, LibreOffice or online service), split into pages/slides/sheets/chapters. Conversion starts on upload,
  when a file copied into the folder by hand is first listed, and again when a file changes; it runs in a background
  worker thread, so you can keep working, and the view updates when it finishes.
- **PDF pages** are analysed: pages without usable text (scans, drawings, unreadable text layers) are also rendered as
  images; **figures** of text pages (images, charts, diagrams, with their captions) are cut out as images. The
  assistant looks at them with `read_reference_pages` / `read_reference_figures` and can save what it read on a
  scanned page with `save_reference_transcription`.
- Old binary formats (`.ppt`, `.xls`) and other unknown formats are not readable.

In **References**, the **Assistant ready** column (a badge on cards in the grid) says **Yes**, **No** or
**Converting** (details in the tooltip); the header counts "N of M files readable by the assistant" and can show only
the files not readable yet. For converted documents a **folder icon** opens the conversion details: the Markdown
(rendered or source), the figures, the pages (image next to its text), exactly what the assistant receives (with a
token estimate) and technical details (pages analysis, warnings, hash). From there, or from the context menu, a
document can be converted again, its page images rendered, or its generated files deleted.

**Images from references in image sub-blocks**: "From references…" in an image sub-block picks an image file or a
figure of a document (searchable by caption); "Insert into a section…" (figure details, image files) adds it as a new
image sub-block. The image is copied into the section, its caption defaults to the figure's, and the source file is
attached to the sub-block (📎).

**References** you can use in the conversation (the 🔗 buttons in the editor copy them):
`§2.1` section · `§2.1#3` 3rd sub-block of §2.1 · `§2.1#3:L10-14` its source lines · `§2.1#3 "quoted text"` ·
ids and `sourcebook://projects/<id>/subblocks/<id>` URIs.

**Tools**: `list_workspace`, `get_outline`, `read_section`, `read_subblock`, `read_document`, `search`, `list_references`,
`read_reference` (text as it is, images as images, documents as converted Markdown, by `parts`), `read_reference_pages`
(PDF pages as images), `read_reference_figures` (figures cut out of PDFs, with captions), `list_comments` (open threads;
`include_resolved` for all), `list_notifications` · `save_reference_transcription` · `create_project`, `create_template`, `create_section`, `add_subblock`,
`update_section`, `update_subblock`, `edit_subblock_text` (find/replace or line ranges, atomic), `move_section`,
`move_subblock` · `add_image_from_reference` (an image file or a PDF figure as an image sub-block) · `add_comment`,
`reply_to_comment`, `reanchor_comment`, `resolve_comment` · `notify_changes` (summary + parts involved, as
`§2.1` / `§2.1#3` / comment references; `request_reload` option), `request_reload` · `attach_reference` / `detach_reference`
(reference files of a whole section or sub-block) · bibliography: `list_bibliography`,
`read_bib_entry`, `export_bibtex`, `add_bib_entry`, `update_bib_entry`, `import_bibtex`, `cite` / `uncite` (associate
sources with a section or sub-block; in text the assistant writes `[Name](bib:key)` with `edit_subblock_text`) ·
destructive (the client asks first): `delete_section`, `delete_subblock`, `delete_comment`, `delete_bib_entry`. Prompts: `review-section`, `fill-placeholders`, `discuss-comments`.

Examples: *"Show me the outline of the payment-service project"*, *"Rewrite §2.1#1 more concisely"*,
*"Comment §3.2#2:L4-6: the timeout is not handled"*, *"Answer the open comments in §4"*,
*"Create a project from the thesis template and fill in the introduction with me"*,
*"Add this BibTeX to the bibliography and cite it in §2.1#1 where we discuss the protocol"*,
*"Handle the open comments in §2, resolve them, then notify me and ask me to reload"*.

Question (`question`) and multiple-choice (`choice`) sub-blocks are read and written by the assistant as their JSON
source (see On-disk format); a multiple-choice sub-block in `single` mode accepts at most one selected option.

## Example templates
`python3 scripts/create-example-templates.py [--replace] [--only <id>…]` creates them through the REST API of a running
server: **Software Project**, Scientific Paper, Research Project Proposal, Thesis.

**Software Project** is meant to be worked on alone or with an AI assistant. It starts with _Prompts_ (a ready-to-paste
briefing for an AI assistant, in English and Italian: MCP tools / REST API, structure, behaviour) and _Instructions_ (conventions,
IDs such as FR-xx / Q-xx / ADR-xxx / T-xx, section status, rules for the assistant, glossary), then Vision & Objectives,
Requirements, Open Questions (question and multiple-choice blocks), Decisions (ADR), Architecture, Design (patterns,
sequence and class diagrams, interfaces, error handling), Data Models, Project Structure & Packages, Cross-cutting
Concerns, Testing, Deployment & Operations, Documentation, Development Plan, Issues/Bugs/Tech Debt and Risks. The ADR
section opens with an index of all decisions; each ADR has a status block (🟡 Proposed · 🟢 Approved · 🔴 Rejected),
context, a question block, the options considered (multiple choice with a note) and the consequences.

## Adding a sub-block type
1. `packages/shared/src/types/<type>.ts`: a `SubBlockTypeCore` (zod content schema, source extension,
   serialize/deserialize, `toMarkdown`, optional `sourceExtFor`, `assetsOf`, `commentAnchor`), added to `coreTypes`.
2. `packages/client/src/subblocks/index.ts`: register it with its React `component`
   (and optional `exportArtifacts`).

No block, reorder or REST code changes are needed.

See `docs/decisions.md` for implementation choices and known limitations.
