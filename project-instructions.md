# Sourcebook — Block-Based Markdown Notebook Tool

**Project name: Sourcebook.** Use this name for the repo, the npm package (e.g. `sourcebook` or a scoped equivalent if taken), the CLI binary (`npx sourcebook ./my-project`), and in any generated docs/README.

The name reflects the tool's purpose: it is where the user retains ownership of ideas, structure, and design decisions — the authoritative "source" document — while actual implementation/development happens separately (e.g. with an AI coding agent) guided by what is authored here. Sourcebook is not a code execution environment and does not build software itself; it is the human-controlled planning/authoring layer that precedes and informs development.

## Overview

Build a local, single-user web application inspired by the structure of Jupyter notebooks, but for **documentation/knowledge authoring instead of code execution**. The tool does **not execute any code** — it only renders/edits content. The entire project is ultimately persisted as a set of Markdown files plus graphical assets on disk.

The app opens a single folder at launch (no multi-project switching, no auth, no multi-user support in this phase).

---

## Core Concepts

### Block
- The top-level unit of the document, analogous to a Jupyter "cell" but representing a **section**.
- Each Block has:
  - A unique `id`
  - A `title`
  - A progressive `order` number (auto-recalculated when reordered)
  - Optional nesting (sections/subsections — Blocks can have parent/child relationships to represent a document outline)
- Each Block is persisted as an **independent unit on disk** (its own folder), not merged into a single monolithic file.
- Blocks can be created, renamed, reordered (via drag & drop in the UI), nested, and deleted.

### Sub-block
- Each Block contains an ordered list of Sub-blocks, each with a specific type:
  1. **Markdown** — rich text, WYSIWYG editing where possible, backed by real Markdown source.
  2. **Mermaid** — a Mermaid diagram. V1 scope: **text editing only, with a live rendered preview** (no visual/graphical diagram editor in this phase — explicitly deferred).
  3. **Image** — an image reference, rendered immediately inline in the block (not just embedded inside a Markdown paragraph).
  4. **Drawing** — a freehand/diagram drawing powered by **Excalidraw** (`@excalidraw/excalidraw`, MIT license). Stores both the editable source (`.excalidraw` JSON) and an exported raster/vector version (PNG/SVG).
  5. **Equation** — a LaTeX equation with a text editor (raw LaTeX) shown side-by-side with a live rendered preview (KaTeX).
- Sub-blocks within a Block are also orderable.
- The set of sub-block types must be **extensible**: adding a new type should mean registering a new entry in a registry, not modifying core logic.

---

## Architecture Decisions (already made — follow these, do not re-litigate)

- **Frontend**: React + TypeScript.
- **Rich-text editor**: **TipTap** (MIT license), used only for the Markdown sub-block type. Do **not** use BlockNote — it introduces a competing block-management model (its own block array, slash menu, side menu) that would overlap with our own Block/Sub-block management layer. Keep TipTap scoped strictly to WYSIWYG editing of a single Markdown sub-block's content.
- **Block/sub-block ordering & structure UI** (drag & drop of Blocks and Sub-blocks, nesting, numbering): implement with **`dnd-kit`**, driven by our own application state / REST API — independent of the TipTap editor instance.
- **Markdown parsing/serialization**: use the **`unified` / `remark`** ecosystem (mdast) to treat Markdown as a manipulable AST rather than raw text. Use this both for splitting/merging sections and for validating structure server-side.
- **Backend**: **Node.js + TypeScript** (Express or Fastify — pick one and be consistent). Chosen over Python specifically because of the `remark`/`unified` synergy for AST-based Markdown manipulation, and to share types between frontend and backend in a single TypeScript monorepo.
- **Diagrams**: `mermaid.js` (MIT) for rendering. Text-only editing in this phase (textarea + live preview). No graphical diagram editor yet — do not build one; leave an extension point instead.
- **Drawing**: `@excalidraw/excalidraw` (MIT) embedded directly as a React component.
- **Equations**: KaTeX (MIT) for rendering; plain textarea for LaTeX source input in this phase (MathLive can be considered later for semi-WYSIWYG math input, but is out of scope for V1).
- **Project structure**: monorepo (e.g. npm/pnpm workspaces) with shared TypeScript types/interfaces used by both frontend and backend (especially the Sub-block type registry contracts).
- **Deployment target**: local only, single user, single folder opened at launch. No authentication, no multi-tenancy, no cloud storage in this phase.

---

## Filesystem Layout (source of truth)

The project folder (opened at launch) should be organized roughly as follows:

```
project/
  notebook.json              # ordered index of Blocks: id, title, order, type hierarchy/nesting, folder reference
  blocks/
    001-introduction/
      block.json             # block metadata: id, title, order, parent (if nested), ordered list of sub-block refs
      subblocks/
        01-markdown.md
        02-diagram.mmd
        02-diagram.png       # rendered export of the mermaid source above
        03-sketch.excalidraw # Excalidraw source (JSON)
        03-sketch.png        # exported raster of the drawing
        04-equation.tex
    002-architecture/
      block.json
      subblocks/
        ...
```

- `notebook.json` holds the lightweight ordering/metadata index (do not duplicate large content here).
- Each Block folder is self-contained and independently movable/renamable; reordering Blocks means renumbering folder prefixes (handled server-side) and updating `notebook.json`.
- Every non-text sub-block (Mermaid, Drawing, Equation, Image) must store **both** its editable source **and** an exported artifact (e.g. `.mmd` + `.png`, `.excalidraw` + `.png`, `.tex` + rendered image if applicable) — the exported artifacts are what should be embedded/referenced when the final combined Markdown is generated or viewed outside the tool.

---

## Sub-block Type Registry (extensibility requirement)

Design a registry pattern, mirrored on both frontend and backend, where each sub-block type is defined by a consistent contract, for example:

```ts
interface SubBlockTypeDefinition<TContent, TProps> {
  type: string;                    // e.g. "markdown" | "mermaid" | "image" | "drawing" | "equation"
  component: React.ComponentType<SubBlockProps<TContent, TProps>>; // frontend renderer/editor
  serialize: (content: TContent) => { source: string; assets?: AssetFile[] };
  deserialize: (source: string, assets?: AssetFile[]) => TContent;
  validate?: (content: TContent) => ValidationResult; // server-side schema validation
}
```

- Adding a new sub-block type (e.g. a future "Table" or "Code snippet display" type) should require only registering a new `SubBlockTypeDefinition`, not modifying core Block/reordering/REST logic.
- Keep the registry definitions in a shared package/module importable by both frontend and backend where the contract (interfaces/types) is concerned; the `component` field is obviously frontend-only.

---

## REST API (initial scope)

Design and implement a RESTful API that fully drives the block-management logic (the frontend should be a client of this API, not the source of truth). It must also be usable by external tools/scripts, not just the bundled frontend.

Minimum endpoint set for V1:

- `GET /api/project` — return the full project structure (Blocks, ordering, nesting, sub-block references) as read from `notebook.json`.
- `POST /api/blocks` — create a new Block (title, optional parent for nesting, optional position).
- `PATCH /api/blocks/:id` — update Block metadata (title, parent).
- `DELETE /api/blocks/:id` — delete a Block (and its folder/contents).
- `PATCH /api/blocks/reorder` — reorder Blocks (accepts new ordering/nesting; server renumbers folder prefixes and updates `notebook.json`).
- `GET /api/blocks/:id` — return a single Block's full content (all its sub-blocks).
- `POST /api/blocks/:id/subblocks` — add a sub-block of a given type to a Block.
- `PATCH /api/blocks/:blockId/subblocks/:subBlockId` — update a sub-block's content.
- `PATCH /api/blocks/:blockId/subblocks/reorder` — reorder sub-blocks within a Block.
- `DELETE /api/blocks/:blockId/subblocks/:subBlockId` — delete a sub-block.
- `POST /api/assets` — upload a binary asset (image, exported PNG, etc.), returns a stored path/reference.

All endpoints should validate payloads against the shared TypeScript types/schemas (consider `zod` for runtime validation matching the TS types).

---

## Explicit Non-Goals for V1 (do not build these yet)

- No code execution of any kind (this is not a real notebook kernel).
- No graphical/visual editor for Mermaid diagrams (text + preview only).
- No multi-user collaboration, no auth, no permissions.
- No multi-project/workspace switching — one folder per running instance.
- No cloud sync/storage integration.
- No BlockNote — TipTap only, scoped to the Markdown sub-block.
- **No build/packaging/distribution work in this phase** — see "Distribution (future — notes only)" below. Development runs via local dev servers (`vite dev` for the client, `ts-node`/`tsx` or `nodemon` for the server); do not spend effort on a production build pipeline, bundling, or an npm `bin` entry point yet.

---

## Suggested Build Order

1. Monorepo scaffold (npm/pnpm workspaces): `packages/shared` (types + registry contracts), `packages/server` (Node/TS + Express/Fastify + remark), `packages/client` (React + TS + Vite).
2. Filesystem persistence layer on the server: read/write `notebook.json` and Block folders; Block CRUD + reorder logic (folder renumbering).
3. REST API implementing the endpoint list above, backed by the persistence layer.
4. Sub-block type registry (shared contracts) + server-side validation per type.
5. Frontend: project tree view (Blocks/sub-blocks, nesting) with `dnd-kit` for drag & drop reordering; wire to REST API.
6. Frontend: Markdown sub-block editor using TipTap (with Markdown serialization via `tiptap-markdown` or a `remark`-based bridge — evaluate both and pick the one that round-trips more reliably).
7. Frontend: Mermaid sub-block (textarea + `mermaid.js` live preview).
8. Frontend: Image sub-block (inline rendering + upload).
9. Frontend: Drawing sub-block (`@excalidraw/excalidraw` embed + export to source + PNG).
10. Frontend: Equation sub-block (LaTeX textarea + KaTeX live preview).
11. End-to-end test: create a multi-section project exercising all sub-block types, verify the on-disk Markdown/asset output is correct and re-openable (round-trip).

---

## Distribution (future — notes only, do not implement now)

Decided direction for later, once the app is functional: distribute as an **npm-installable CLI** (Option A), not a GitHub-clone-and-build workflow and not an Electron/Tauri desktop app (at least not initially).

Target end-user experience (future):

```bash
npx sourcebook ./my-project
# or, installed globally:
npm install -g sourcebook
sourcebook ./my-project
```

Running the command starts the Node backend (pointed at the given folder), serves the **already-built** React frontend (static output of the client's production build, bundled into the published npm package), and opens the browser automatically at `http://localhost:PORT`. No build step required on the end user's machine — only Node.js.

Implications to keep in mind while developing (informational only, not to be acted on yet):
- The server package will eventually need a `bin` entry in its `package.json` and a small CLI wrapper (parse folder argument, optional `--port`, auto-open browser).
- The client's production build output will need to be included in what gets published to npm and served as static files by the server.
- Keep client and server reasonably decoupled (clear API boundary) so that "serve built client from the Node server" is a packaging step added later, not a refactor.

None of this should drive implementation decisions right now — the focus for this phase is local development via dev servers, as stated in the Non-Goals section above.

---

## Notes for the implementing agent

- Prioritize getting the Block/Sub-block persistence model and REST API right first — this is the architectural backbone. The individual sub-block editors are comparatively isolated, swappable pieces once the registry pattern and API contract are solid.
- Treat Markdown as an AST (via `remark`) wherever structural manipulation is needed (splitting, reordering, validating), not as raw string manipulation.
- Keep the TipTap integration minimal and scoped — resist pulling in editor-level block management features; that responsibility belongs to the outer Block/Sub-block layer, not to TipTap.
- All new sub-block types, including future ones not listed here, must go through the registry pattern rather than ad hoc special-casing.
