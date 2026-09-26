# Implementation decisions (V1)

Decisions taken while implementing `project-instructions.md`, beyond those already fixed there.

## Tooling
- **pnpm workspaces + Fastify 5** (with `fastify-type-provider-zod`): request bodies/params are validated by the same zod schemas that define the shared TypeScript types.
- `@sourcebook/shared` is consumed as TypeScript source (no build step).
- **React 18** (not 19): `@excalidraw/excalidraw` 0.18 depends on Radix packages that declare React ≤ 18 peers.

## Markdown bridge for TipTap: `@tiptap/markdown`
Evaluated `@tiptap/markdown` (official, TipTap 3) vs `tiptap-markdown` (community) on the fixtures in
`packages/client/src/subblocks/markdown/fixtures.ts` (headings, inline marks, nested lists, code, quotes,
images, GFM tables, rules, hard breaks).

| fixture   | @tiptap/markdown | tiptap-markdown |
|-----------|------------------|-----------------|
| quote     | exact            | stable (joins soft-broken lines) |
| table     | stable (pads cells) | exact        |
| hardbreak | stable (`  ` instead of `\`) | exact |
| others    | exact            | exact           |

Both are semantics-preserving; `@tiptap/markdown` was chosen because it is maintained alongside TipTap 3
and its only differences are cosmetic and idempotent. A remark-based bridge (mdast ↔ ProseMirror JSON)
remains the fallback if fidelity problems appear. `roundtrip.test.ts` guards the choice.

## Persistence
- Block and sub-block **ids are stable** (`nanoid`); folder/file names (`001-slug`, `02-type.ext`) are derived
  from order and are recomputed on every structural change. Renames happen in two phases
  (→ `.tmp-<id>` → final) so swapped prefixes never collide.
- Folder numbering is **global depth-first** (a nested block gets the next prefix after its parent).
- All mutations go through a single in-process mutex; files are written atomically (temp + rename).
- The server caches `notebook.json`/`block.json` in memory: edit the project folder by hand only while
  the server is stopped.

## Sub-block storage
| type     | source                | exports (rendered by the client, sent with each save) |
|----------|-----------------------|---------------------------------------------|
| markdown | `NN-markdown.md`      | –                                           |
| mermaid  | `NN-mermaid.mmd`      | `.png` + `.svg`                             |
| drawing  | `NN-drawing.excalidraw` | `.png`                                    |
| equation | `NN-equation.tex`     | `.png`                                      |
| image    | `NN-image.md` (a Markdown image reference to `../assets/<id>.<ext>`) | the image itself in `assets/` |
| code     | `NN-code.<ext>` — the extension encodes the language (`CODE_LANGUAGES` in shared) | – |

The contract has two optional hooks for this: `sourceExtFor(content)` (the store renames the source
file when the extension changes, e.g. switching a code sub-block from Python to Rust) and
`assetsOf(content)` (files in `assets/` a sub-block references: image `src`, `../assets/…` links in Markdown).

Exports are generated in the browser (mermaid SVG → canvas, `exportToBlob` for Excalidraw,
`html-to-image` for KaTeX) because that is where the renderers live; content created via the REST API
without exports is still valid, and `GET /api/project/markdown` falls back to source (fenced mermaid, `$$`).

## API additions beyond the V1 list
- `GET /api/project/markdown` — whole notebook compiled into one Markdown document via mdast.
- `GET /api/types` — registered sub-block types.
- `GET /api/blocks/:id/files/*` — serves files inside a block folder by stable id.
- `POST /api/assets?blockId=…` — the target block is a query parameter; the body is multipart with one `file`.

## Code highlighting
- Code sub-block and the export preview: **CodeMirror 6**, grammars lazy-loaded by file extension from
  `@codemirror/language-data` (a few languages, e.g. GraphQL and Makefile, have no grammar there and show as plain text).
- Code blocks inside Markdown: TipTap `CodeBlockLowlight` (highlight.js grammars); the language picker
  writes the fence info string (```` ```python ````).

## Tables in Markdown
Contextual toolbar (visible with the cursor in a table): insert/move/delete rows and columns, delete table,
via `prosemirror-tables` commands (`moveTableRow`, `moveTableColumn`). Row 0 is the Markdown header row and
stays in place.

## Deleting content with assets
- Sub-block: if `assetsOf` reports files, a dialog asks whether to delete them too (default: yes). Files still
  referenced by another sub-block of the same block are kept and reported.
- Image replaced by a new upload: a dialog asks whether to delete the previous file. The sub-block is saved
  first, then `DELETE /api/blocks/:id/assets/:name` removes it, refusing (409) while any sub-block still references it.
- Block: a dialog lists the nested sections and the asset files that will be removed with the folder
  (no option to keep them).

## Export
The header icon opens a dialog with the compiled Markdown (highlighted, read-only) and saves a ZIP with the
document at the root plus every referenced local file at its project-relative path, so links survive
extraction anywhere. Equations stay as `$$…$$` (their PNG is not needed). The save location is chosen with
the File System Access API (`showSaveFilePicker`, Chromium browsers); elsewhere the ZIP is downloaded.

## Titles and objectives
- Sections/subsections (Blocks) have an optional **objective**; sub-blocks have an optional **title** and
  **objective**. All are optional metadata stored in `block.json` (`objective` on the block, `title`/`objective`
  on each sub-block ref); blank values remove the key. Set via `PATCH /api/blocks/:id` and
  `PATCH /api/blocks/:blockId/subblocks/:subBlockId` (`{ title?, objective? }`).
- Export: objectives become HTML comments right below their heading (`<!-- Objective: … -->`, multi-line when
  needed; `--` sequences are broken up so the comment cannot end early). A sub-block title becomes a heading one
  level below its section, and the sub-block's own headings nest under it.

## Mermaid diagram types
A new mermaid sub-block starts empty and shows a gallery of 20 diagram kinds (flowchart, sequence, class,
state, ER, Gantt, C4, …), each with a starter example (`packages/client/src/subblocks/mermaid/templates.ts`,
every template validated by `mermaid.parse` in tests). The toolbar selector shows the kind detected from the
diagram declaration. Switching kind replaces the code with the new example; if the current code is not empty
and not an untouched example, a dialog warns that the work will be lost.

The preview (`MermaidPreview.tsx`) has zoom controls: −/+ (×1.25 steps, 10%–800%), the percentage resets to
100%, "Fit" follows the available space (width inline, never above 100%; width and height in full page).
Ctrl/⌘ + wheel zooms around the pointer; drag pans when the diagram overflows. The SVG is resized from its
viewBox, so zoom stays vector-sharp. Zoom is view-only: exported PNG/SVG are unaffected.

## Full-page editing
Every sub-block has an expand icon in its header. The already-mounted editor is restyled as a full-page panel
(fixed position over a backdrop) instead of being re-rendered in a separate dialog, so editor state, undo
history and the Excalidraw scene are preserved. Esc, the backdrop or the icon close it (Esc inside Excalidraw
is left to Excalidraw).

## Themes
- **Tokens, not hard-coded colors.** Every color in `styles.css` is a CSS custom property. A theme
  (`packages/client/src/theme/themes.ts`) is data: `ui` tokens for the app chrome, and a `surface` palette for
  editing surfaces (text fields, editors, previews) including syntax colors (`--syn-*`). Adding a theme = adding
  an entry to `THEMES`; `appearance.test.ts` checks every theme defines the same tokens and `contrast.test.ts`
  enforces WCAG AA contrast (4.5:1 for text and syntax colors, 3:1 for accents).
- **Two layers.** Elements with the `.surface` class (sub-block bodies, objectives, CodeMirror) remap the UI
  tokens to surface tokens, so nested components need no theme-specific rules. The option "keep editing
  surfaces light" swaps the surface palette of a dark theme with the light one.
- Built-in themes: Light, Dark, Sepia, Midnight, plus **System** (follows `prefers-color-scheme`, live).
- Third-party renderers follow the surface scheme: CodeMirror (theme + `HighlightStyle` on CSS variables),
  lowlight/highlight.js classes mapped to `--syn-*`, Excalidraw `theme` prop, mermaid `theme: "dark"` for the
  preview. **Exports are always light** (mermaid renders exports with the default theme; Excalidraw and equation
  exports force a white background), and the UI theme is not saved into `.excalidraw` files.
- The preference lives in `localStorage` (`sourcebook.appearance`), per browser rather than per project, and is
  applied before React renders to avoid a light flash.

## References (project input files)
- Stored under `references/` at the project root, with arbitrary folders. The filesystem is the source of truth:
  files copied in by hand appear too; hidden (dot) files are ignored. Not part of `notebook.json`.
- UI: a "References" entry at the top of the sidebar (above the project structure) opens a Drive-style file
  manager in the main area: breadcrumbs, search across all folders, grid (image thumbnails) or list layout
  (sortable by name/size/modified), single click selects, double click opens (folder → enter, file → viewer),
  actions from the selection bar, the ⋮ button or right-click; keyboard: Enter, F2, Delete, Backspace (up), arrows.
  The current folder and layout are remembered per browser.
- Multiple selection like desktop file managers: Ctrl/⌘-click toggles, Shift-click selects a range from the last
  plain/Ctrl-clicked item, Ctrl/⌘+A selects all, Esc clears; checkboxes on cards/rows (and select-all in the list
  header). The selection bar and the context menu act on the whole selection. Download: a single file downloads
  directly; a folder or several items become a ZIP (`POST /api/references/zip`, streamed with fflate one file at a
  time, entries relative to the browsed folder, empty folders kept, already-compressed formats stored). Delete:
  one confirmation listing the items and the total number of files, then `POST /api/references/delete` (entries
  inside selected folders are skipped).
- File contents are read-only in the app: upload (button or drag & drop from the OS, onto the area or a folder;
  name clashes get " (n)"), new folder, rename (name only, never overwrites), delete (folders recursively, with
  confirmation), download, preview.
- Safety: every path segment is validated (no `..`, separators, hidden or control characters). Files are served
  with explicit types and `nosniff`; unknown types as `text/plain`; HTML and SVG with a sandboxing CSP
  (no scripts, no network), and HTML is shown in an empty-sandbox iframe.
- Viewers are a registry (`packages/client/src/references/viewers`), first match by extension wins:
  PDF (browser viewer), images, audio, video, HTML (sandboxed), Markdown (rendered with the sub-block's TipTap
  schema), CSV/TSV (table, first 2000 rows), JSON (collapsible tree), BibTeX (searchable entries with DOI/URL),
  Mermaid (rendered, with zoom), Excalidraw (view mode), and text/code/LaTeX/YAML/… with CodeMirror highlighting.
  Structured viewers also have a Source tab. Text previews are limited to 2 MB. Other formats (Office, archives,
  binaries) open an explanatory popup with a Download button.
- Markdown sub-blocks can link references (📎 in the toolbar): the link is `../../../references/<path>`, relative
  to the sub-block file like asset links; Ctrl/⌘ + click opens it in the viewer. On export, local links are
  rebased onto the combined document and linked references are included in the ZIP.
- Export fix made along the way: all `toMarkdown` fragments now use paths relative to the block's `subblocks/`
  folder and the compiler rebases them (previously `../assets/…` links written in Markdown sub-blocks were copied
  unchanged into the root-level document and broke).

## Top bar, user profile and comments
- A top bar shows "Sourcebook" on the left and the user's avatar (initials, color from the username) on the
  right; it opens Settings with the profile: display name and username (`^[a-z0-9][a-z0-9._-]{0,38}$`,
  suggested from the name). The profile is per person, not per project: `$SOURCEBOOK_CONFIG_DIR`, else
  `$XDG_CONFIG_HOME/sourcebook`, else `~/.config/sourcebook/user.json`; without one, the OS login is used.
- Comments are attached to sub-blocks and stored next to them in `NN-type.comments.json`
  (`{ version: 1, comments: [{ id, author, createdAt, text, replies: [...] }] }`), renamed with the sub-block
  when it is renumbered, deleted with it, and removed when the last comment is deleted. Timestamps are set by
  the server and kept strictly increasing, so insertion order = time order. API clients may pass `author`;
  otherwise the current profile is used. Comments are not part of the Markdown export.
- UI (Word/Google Docs style): each sub-block header has a speech-bubble icon, filled/highlighted with a count
  only when comments exist, which toggles the comments column to the right of that sub-block (aligned with it;
  the column space is kept for all rows while any is open), and a bubble-with-plus icon that opens the column
  with a new-comment box. Threads are oldest first, each with replies (Ctrl/⌘+Enter to send) and deletion
  (inline confirmation). Below 1100 px the column stacks under the sub-block.

## Comments on text and lines (Markdown, Code)
- Types declare `commentAnchor` in the registry: Markdown `"text"` (any selection), Code `"lines"` (whole lines).
  Other types keep only whole-sub-block comments; the server rejects anchors on them or with the wrong unit.
- Source files are never modified: anchors live in the comments file, W3C "text quote" style
  (`{ unit, exact, prefix, suffix, start }`, `packages/shared/src/anchors.ts`). Resolution searches the quote,
  preferring the occurrence whose surrounding text best matches the stored context, then the one nearest to
  `start`; line anchors must match whole lines. For Markdown the text is the editor's plain text (blocks joined
  by "\n"), so API clients quote the visible words, not Markdown syntax.
- API convenience: `anchor: { lines: { first, last } }` designates source lines; the server turns it into a quote
  anchor from the current source. Code: the lines themselves. Markdown: the visible text of those lines of the
  `.md` file, extracted with remark (`packages/server/src/markdown/plainText.ts`) as the same plain text the
  editor uses (a cross-check test compares it with TipTap's text on headings, lists, tables, code, breaks).
  Types provide this via `anchorText(source)` in the registry (default: the source itself). Listing comments
  adds `resolved: { lines } | null` (current source lines of each quote, or detached) — computed, not stored.
- In the editor, highlights are decorations (ProseMirror inline decorations / CodeMirror marks + line
  backgrounds + a 💬 gutter) mapped through every edit, so they follow the text while typing. After each content
  save, anchors whose stored quote would no longer find the highlighted text are re-saved (`PATCH …/comments/:id`).
  When the whole quoted text is deleted the highlight disappears and the comment becomes **detached**: it stays in
  the column with the original quote struck through, and can be re-attached to a new selection or kept as a
  general comment.
- UI: Markdown — select text → floating "💬+ Comment" button; Code — "💬+ Comment line(s)" in the toolbar or click
  the gutter ("+" on hover). Clicking highlighted text/markers activates the thread in the column and vice versa
  (the editor scrolls to the quote). Both whole-sub-block and anchored comments are listed together, oldest first.
- An editor ↔ column "bridge" per sub-block (`packages/client/src/comments/bridge.ts`) carries the active comment,
  attached/detached status and line numbers; `useCommentAnchoring` holds the editor-independent logic, and each
  editor supplies a small adapter (text, ranges, selection, reveal).

## Top bar actions and scrolling mode
- Top bar, right side: scrolling mode, Appearance, profile avatar (Appearance moved here from the sidebar).
- Scrolling mode (menu, remembered per browser in `sourcebook.scrollMode`):
  - **Section**: the main area shows only the selected section/sub-section.
  - **Document**: every section in outline order, one scrolling document. Sections mount lazily when they come
    within ~1200 px of the view (IntersectionObserver). Selecting in the outline scrolls to the section (re-adjusting
    while sections above finish mounting); while scrolling, the outline highlights the section crossing the top
    third of the view (scroll spy). Each section shows its outline number; nested titles are smaller.

## Workspace: multiple projects and templates
- Supersedes the V1 non-goal "one folder per running instance" (requested later). A **workspace** folder
  (`~/Sourcebook` by default, `--workspace` / `SOURCEBOOK_WORKSPACE`) holds `projects/<id>/` and `templates/<id>/`;
  each is an unchanged notebook folder plus `project.json` (name, description, createdAt, createdFrom). The id is the
  folder name (slug of the initial name, `-2`… on clashes) and stays stable on rename, so URLs and links survive.
  Folders dropped in by hand with a `notebook.json` are listed too (metadata derived).
- One API for both: every notebook route lives under `/api/projects/:projectId/…` and `/api/templates/:projectId/…`
  (registered twice with a prefix; an `onRequest` hook opens — and caches — the addressed notebook as `req.nb`).
  `/api/project` became `…/notebook`. Collection routes: list/create/get/patch/delete.
- Copies (new project from template, "save as template", duplicate) take everything — sections, objectives,
  sub-blocks, assets, references — except `*.comments.json` and `project.json`.
- Client: hash routes `#/projects`, `#/templates`, `#/projects/<id>`, `#/templates/<id>`. Home = Overleaf-style lists
  (search, sortable columns, ⋮/right-click menu: open, rename/edit, duplicate, save as template / new project from
  template, delete with confirmation; "New …" dialog with a "Start from" choice). Opening one sets the notebook API
  base (`setNotebookBase`) and drops cached notebook data before anything renders; the top bar shows
  "Sourcebook › Projects › name", and templates carry a "Template" badge.
- The repository's `example-project/` was copied (not moved) to `~/Sourcebook/projects/example-project`.

## Inserting sub-blocks
Between sub-blocks (and before the first) a thin insertion point reveals, on hover or keyboard focus, a line with a
centered "+"; clicking it shows the sub-block types centered in the sub-block column, and the new sub-block is
created at that position (`position` in `POST …/blocks/:id/subblocks`). After the last sub-block the options are
always visible (with a hint when the section is empty). Esc or a click elsewhere closes open options. Applies to
projects and templates, in both scrolling modes.

## Template archives (export / import)
- Export (`GET /api/templates/:id/archive.zip`, "Export as ZIP" in the template menu): a streamed ZIP with
  `sourcebook-template.json` (`{ format: "sourcebook-template", version: 1, exportedAt, template: { name, description } }`),
  `project.json`, `notebook.json`, `blocks/`, `references/`. Comments are excluded (like copies).
- Import (`POST /api/templates/import`, "Import template" on the Templates page) validates the whole archive in memory
  before writing anything (`packages/server/src/store/templateArchive.ts`) and reports all errors at once:
  ZIP signature and integrity; limits (200 MB compressed, 500 MB / 20 000 entries uncompressed, checked before
  inflating); safe paths (no absolute, `..`, backslashes); manifest format/version; `project.json`/`notebook.json`
  schemas; unique section ids and folders, existing parents, no cycles; each `block.json` present, valid and matching;
  sub-block types registered, source and export files present, content valid for the type (`contentSchema` +
  `validate`), referenced assets present. Tolerated with warnings: no manifest, a single wrapping folder, unexpected
  files, comments files, block folders not listed in `notebook.json`; OS junk (`__MACOSX`, `.DS_Store`) is dropped.
- The UI first calls it with `dryRun=1` to show either the list of problems or a preview with an editable name, then
  imports. The files are written to a hidden staging folder, opened once by `NotebookStore` as a final check, and
  renamed into `templates/<id>` (id from the name, de-duplicated) — a failed import leaves nothing behind.

## Known limitations
- References cannot be moved between folders (rename only); links from Markdown are not updated on rename.
- Excalidraw appState is saved as-is (includes view state such as scroll/zoom).
