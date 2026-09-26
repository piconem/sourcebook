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
```

## On-disk format
```
~/Sourcebook/
  projects/
    payment-service/            one project = one folder (the id is the folder name)
      project.json              name, description, createdAt, createdFrom?
      notebook.json             ordered index: id, title, parentId, order, folder
      references/               project input files of any type, user-defined folders (read-only in the app)
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
| PATCH | `…/blocks/:blockId/subblocks/:subBlockId` | `{ content?, title?, objective?, props?, exports?: [{ ext, mimeType, dataBase64 }] }` |
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
| POST | `…/references/delete` | `{ paths }` → `{ deleted }` |

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

## Adding a sub-block type
1. `packages/shared/src/types/<type>.ts`: a `SubBlockTypeCore` (zod content schema, source extension,
   serialize/deserialize, `toMarkdown`, optional `sourceExtFor`, `assetsOf`, `commentAnchor`), added to `coreTypes`.
2. `packages/client/src/subblocks/index.ts`: register it with its React `component`
   (and optional `exportArtifacts`).

No block, reorder or REST code changes are needed.

See `docs/decisions.md` for implementation choices and known limitations.
