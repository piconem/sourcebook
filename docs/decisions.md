[← Sourcebook](../README.md) · [Installation](installation.md) · [Docker](../docker/README.md) · [User guide](user-guide.md) · [Collaboration](collaboration.md) · [AI assistant](ai-assistant.md) · [REST API](rest-api.md) · [File format](file-format.md) · [Development](development.md) · [Libraries](libraries.md)

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
| question | `NN-question.json` — `{ question, answer }` (a file that is not JSON is read as the question) | – |
| choice   | `NN-choice.json` — `{ question, mode: "single"\|"multiple", options: [{ id, text }], selected: [ids], note }` | – |
| csv      | `NN-csv.csv` — the data set as CSV (first record = header); content `{ csv, delimiter }`, delimiter detected on read | – |

Question and multiple-choice sub-blocks are stored as JSON (unambiguous to parse, still readable and editable by an
assistant with `edit_subblock_text`). `choice` validation: unique option ids, selected ids must exist, at most one
selected in `single` mode (switching a block to single keeps only the first selection). Option ids are short random
strings, so renaming or reordering options keeps the selection. The **note** is edited as a draft and stored only with
"Save note" (the rest of the block saves automatically, like other sub-blocks); an unsaved note is lost on reload.
In the combined Markdown export: `**Q:** … **A:** …`, and the question with a `- [x]`/`- [ ]` list and the note as a quote.

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
- Sub-block: a confirmation dialog is always shown (reference and type of the sub-block). If `assetsOf` reports
  files, it also asks whether to delete them (default: yes). Files still referenced by another sub-block of the same
  block are kept and reported.
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
is left to Excalidraw). The delete button is hidden while a sub-block is in full page.

## Resizable sidebar
The editor sidebar (outline) can be resized by dragging the handle on its right edge (200–640 px; arrow keys,
Shift for bigger steps, Home/End; double-click resets to 280 px), for long section titles. The width is a per-browser
preference (`sourcebook.sidebarWidth` in localStorage, like the scrolling mode).

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
  right; it opens the user menu. The profile is the signed-in account (see "Accounts…"): its display name can change,
  the username (`^[a-z0-9][a-z0-9._-]{0,38}$`) is the account id and cannot. Before accounts, the profile lived in
  `~/.config/sourcebook/user.json` (`$SOURCEBOOK_CONFIG_DIR`, `$XDG_CONFIG_HOME`); it is imported as the owner.
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

## Resolved comments and the project's comment list
- A thread can be **resolved** (nothing left to do) and reopened: `resolution: { by, at }` in the comments file
  (`POST …/comments/:id/resolve|reopen`). `commentCount` of a sub-block counts open threads only; resolved threads are
  not highlighted in the text, are collapsed to one line in the comments column ("Show" expands them) and are hidden by
  the MCP `list_comments` unless `include_resolved`. `findComment` (MCP) still finds them by id.
- `GET …/comments` lists every thread of the project in document order with its section and sub-block, so the UI and
  the assistant do not read each sub-block. The top-bar comments button (badge = open threads) shows them grouped by
  section with an Open / Resolved / All filter; clicking one opens the section, scrolls to the sub-block, opens its
  comments column and activates the thread.

## Change notifications and reload requests
- External applications / assistants describe what they changed with `POST …/notifications` (`summary` ≤ 300 chars,
  up to 50 targets). Granularity is at most a section: a target is a section, a sub-block of it, or a comment on that
  sub-block — each must exist (400 otherwise). Its label (`§2.1 Title`, `§2.1#3 Markdown`, `Comment on …`) is recorded
  at that moment; the UI recomputes labels from the current outline and uses the stored one, marked "(deleted)", when
  the part no longer exists.
- Stored per project in `notifications.json`, newest first, at most 200 (older ones are dropped). The read state is
  shared by every window (single-user app). Not content: project copies, templates and template archives leave it out.
- UI: bell in the top bar (badge = unread). Each notification shows author (AI badge for assistants), relative time,
  summary and its parts as links; opening it (summary or a part) marks it read and goes there. "Mark as read" per item
  and "Mark all as read" keep items in the list; "Clear" (with confirmation) empties it.
- Reload requests (`POST …/reload-request`, or `requestReload` on a notification) only emit a live `reload` event;
  nothing is stored. Open editors show a dialog with the sender, the message and the notifications concerned
  (default: the unread ones), with "Reload now" (flushes every pending debounced save, then `location.reload()`) and
  "Later". Editors that are not open when the request is sent never see it (the notifications remain).
- MCP: `notify_changes` (references like `§2.1#3` or comment ids, resolved to ids; author = the agent, see "Agent
  identities"), `request_reload`, `list_notifications`. In read-only mode they are refused like every MCP write.
- Badges where the changes are: the outline shows a bell (count when > 1, tooltip with authors and summaries) on each
  section with unread notifications about it, its sub-blocks or comments; a collapsed section shows those of its hidden
  sub-sections with an outlined bell. Clicking it only navigates — to the changed sub-block/comment, cycling through
  them on repeated clicks. Each changed sub-block (notifications about it or its comments) and each section changed as
  a whole has a bell in its header; clicking it marks those notifications read. Notifications become read only there
  or from the top-bar menu (opening an item, "Mark as read", "Mark all as read").

## Links (URL of sections, sub-blocks and comments)
- The hash route carries the place shown: `#/projects/<id>/s/<sectionId>[/b/<subBlockId>[/c/<commentId>]]` (templates
  alike). Stable ids rather than outline numbers, so links survive reordering. Selecting a section in the outline
  pushes a history entry; the document-mode scroll spy replaces the URL (no history spam) and keeps a more specific
  sub-block/comment URL while its section stays in view.
- Opening a link (or back/forward) selects the section, scrolls to it and, for a sub-block, scrolls to it and flashes
  it (in document mode after ~0.8 s, while the section finishes aligning); a comment link also opens the comments
  column and activates the thread. Unknown ids are ignored. The ↗ button of sections and sub-blocks copies the full URL.

## User menu and version
- The avatar at the top right opens a menu (it used to open Settings directly): name and @username, "Settings…" and
  "About Sourcebook…" (dialog with name, description, version and release date).
- Name, version, release date and description are constants in `packages/shared/src/version.ts`, used by the client
  and as the MCP server's version. 0.2.0, released 2026-10-24; the `package.json` versions follow by hand.

## Outline: collapsing sections
- Every section with sub-sections has an arrow to collapse it; "Expand all / Collapse all" above the outline. The
  collapsed ids are a per-browser convenience in `localStorage` (`sourcebook.outline.collapsed.<kind>/<id>`).
- Selecting a section hidden inside collapsed ones (link, notification, comment list) expands its ancestors.
- Drag and drop works with hidden items: dropping between a collapsed section and its hidden children is regrouped
  depth-first (`depthFirst` in `tree.ts`), so children always stay under their parent.

## Top bar actions and scrolling mode
- Top bar, right side: all comments, notifications (editor only), scrolling mode, Appearance, profile avatar
  (Appearance moved here from the sidebar).
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

## MCP server and live collaboration
- `packages/mcp`: one set of tools/resources/prompts (`createSourcebookMcpServer`) over an abstract `SourcebookApi`;
  stdio (`src/stdio.ts`, HTTP to the running server) and Streamable HTTP at `/mcp` inside the server (stateless, one
  MCP server per request, in-process through `app.inject`; only local Host/Origin accepted). All writes go through the
  REST API, so validation, locking, revisions and live events are shared with the web editor.
- References: outline numbers (`§2.1`, `§2.1#3`, `§2.1#3:L10-14`, `§2.1#3!c<id>`), ids and `sourcebook://` URIs resolve to
  the same element; every tool answer repeats number + id so the assistant can keep using ids after reordering.
- Sub-blocks carry `rev` (incremented on each content change). PATCH/edit accept `expectedRev` → 409 on mismatch.
  `POST …/edit` applies find/replace (must be unique unless `all`) or line-range edits on the type's source text inside
  the store mutex, then validates like any update — all or nothing.
- Content changed without new exports (API/MCP) drops the stale PNG/SVG; the editor regenerates missing exports
  when it shows the sub-block.
- Live events: `NotebookStore` emits after every mutation (blocks, sub-blocks, comments, assets, references); the
  `origin` comes from the `x-sourcebook-client` header via AsyncLocalStorage (web tabs send a per-tab id, MCP sends
  `mcp`). `GET …/events` streams them (SSE, 25 s heartbeat). The editor refetches what changed; a sub-block with a newer
  revision reloads in place ("Updated by the assistant") unless there are unsaved local edits, in which case a banner
  offers "Load their version" / "Keep mine" — a stale save is refused with 409 and opens the same banner.
- MCP settings (Settings → AI assistant, changed by owners): HTTP on/off, stdio on/off, read-only; stored in
  `<workspace>/.sourcebook/settings.json` (imported from the old config dir) and kept in memory. The MCP server tags every API call with `x-sourcebook-mcp-transport: stdio|http`; a global
  `onRequest` hook refuses (403) calls from a disabled transport and non-GET MCP calls in read-only mode (reading
  `/api/settings/mcp` stays allowed so the stdio process can explain why). `/mcp` answers 503 when HTTP is off and
  registers only reading tools in read-only mode. `GET /api/settings/mcp` also returns the connection parameters
  (`PUBLIC_URL/mcp` with an `Authorization: Bearer <agent token>` header; stdio command/args with the repository path
  from `packages/server/src/paths.ts` and `SOURCEBOOK_TOKEN`), from which the UI builds copyable Claude Code commands and
  client JSON (shell-quoted: the path may contain `&`); after creating an agent, with its real token.
- Comments by the assistant carry `author.kind: "assistant"` and show an "AI" badge. 🔗 buttons copy references
  (section, sub-block, code lines, quoted Markdown text) to paste in the chat.
- Agent identities: one MCP configuration per user. `/mcp` requires the user's access token (`Authorization: Bearer
  sbu_…`, 401 otherwise) and forwards it on every in-process API call (stdio: `SOURCEBOOK_TOKEN`). Every tool gets an
  optional `agent` parameter (added by wrapping `registerTool`); the tool runs inside an AsyncLocalStorage holding it and
  the API layer sends it as `x-sourcebook-agent`. The server accepts only agents of the token's user (403 otherwise);
  MCP calls without one use the user's default agent, so an assistant never signs as the person (with no agent yet, it
  may still read and `register_agent`). The server signs with `{ name, username: <agent id>, kind: "assistant",
  onBehalfOf: { username, name } }` and ignores `author` in bodies. Agents created by an earlier build with a token of
  their own (`sbk_…`) keep working. Single-user mode (`buildApp({ auth: false })`, used by tests)
  keeps the connection identity from `SOURCEBOOK_MCP_AGENT_ID` / `_NAME` or `?agent_id=&agent_name=` and the
  participants check below.
- Participants: `GET …/participants` (MCP `list_participants`) lists the users who may open the project and their
  agents (registered identities), plus whoever signed comments, replies, resolutions and notifications (latest name,
  contributions, last activity). Agent ids are unique across users and agents, and agent names unique among active
  agents, when they are created. In single-user mode an explicit `author` is refused (409) when it would be mistaken
  for someone else (the local user's username, an id used with another name, a name used by another id).
- Edits to content are still attributed to "the assistant" (live-event origin `mcp`), not to a specific agent.
- Locks for agents: `lock_subblock`, `unlock_subblock`, `list_locks`; a 423 names the holder.
- `move_references` moves reference files/folders between folders (same as the UI's Move to…).
- Limits: sub-blocks move only within their section; images/drawings are read as descriptions and cannot be written
  via MCP (question and choice sub-blocks are written as JSON); binary references (PDF, Office) cannot be read as text.

## Ask AI (prompts for the assistant)
A speech-bubble-with-sparkles button on every element that can be referenced — the whole document (sidebar),
sections, sub-blocks, a Markdown selection (floating bar), code lines (code toolbar), comment threads and text
reference files — opens a dialog that prepares a request to paste into a chat with an assistant connected via MCP:
a precise reference (outline number, id, `sourcebook://` URI), how to read the target with the MCP tools, and
instructions for the chosen kind of interaction, plus optional custom text (`packages/client/src/ai/prompts.ts`).

| Target | Brainstorming | Critique | Build / Fill | Improve / Rewrite | Comment | Custom |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Document | ✓ | ✓ | ✓ (placeholders, empty sections) | – (too broad) | ✓ (comments across) | ✓ |
| Section | ✓ | ✓ | ✓ (creates sub-blocks) | ✓ | ✓ | ✓ |
| Sub-block: markdown, code | ✓ | ✓ | ✓ | ✓ | ✓ on lines/quotes | ✓ |
| Sub-block: mermaid, equation | ✓ | ✓ | ✓ | ✓ | ✓ whole sub-block | ✓ |
| Sub-block: image, drawing | ✓ | ✓ | – (not writable via MCP) | – | ✓ whole sub-block | ✓ |
| Selection (text / code lines) | ✓ | ✓ | ✓ (expand) | ✓ (only that part) | ✓ anchored | ✓ |
| Comment thread | – | – | – | – | ✓ discuss & reply | ✓ |
| Reference file | ✓ | ✓ | – | – | – | ✓ |
| Bibliography entry | ✓ (where to cite, related sources — never invented) | ✓ (fields, BibTeX, usage) | – | – | – | ✓ |

Writing modes (build, improve, comment) are disabled when the MCP settings grant read-only access; a warning appears
when both transports are off. The last used mode is remembered. A test checks that every reference written in the
prompts is parsed by the MCP server's reference parser.

## Bibliography (sources and citations)
- One list of sources per project/template in `bibliography.json` (`{ version: 1, entries }`, sorted by name), copied
  with projects/templates and included in template archives (validated: schema, unique keys; citations of missing
  keys are warnings). It is not a folder of files: References hold input files, the bibliography holds citable sources
  (papers, books, websites, software, datasets, videos…); a source can link to a reference file through its Link.
- Entry: `key` (the id, also the BibTeX key: `^[A-Za-z][\w:.-]{0,63}$`, unique), `type` (14 BibTeX types + biblatex
  `online`, `software`, `dataset`, `report`, `patent`, `video`), `name` (short label shown in citations, e.g.
  "Knuth 1984"), `authors`, `year`, `venue` (written to the BibTeX field of the type: journal, booktitle, publisher,
  school, institution, howpublished, organization, holder), `title`, `abstract`, `description` (BibTeX `note`), `doi`,
  `url`, `textCitation`, `bibtex`.
- BibTeX is either pasted (kept verbatim; its key follows renames) or generated from the fields on request (⚙ Generate,
  which asks before replacing a different text). Pasting into an empty new entry fills its fields. The text citation
  is an author-year line ("Knuth, D. E. (1984). Title. Venue. https://doi.org/…"), generated the same way. Creating
  without a key derives one: first author (or name) + year + first significant title word (`knuth1984literate`).
- **Citations in text** are ordinary Markdown links `[Name](bib:key)`, so sources stay plain Markdown and survive any
  editor; the ❝ Cite toolbar button (distinct from 📎 References) inserts them on the selection or as the name. In the
  editor they show as chips with the source in a tooltip, missing keys are underlined in red, Ctrl/⌘+click opens the
  source. **Associations** (📚 on section and sub-block headers) store keys in `block.json` (`citations` on the block or
  on a sub-block ref) for sources that support a whole part.
- Renaming a key rewrites every `](bib:old)` link and association (sub-block revisions are bumped, so open editors and
  the assistant see the change). Deleting a used source is refused (409 with the list of usages) unless forced, which
  removes associations; text links remain and show as missing.
- Export: `bib:` links point to anchors in a final **References** section listing every cited or associated source
  (text citation, or "key (not in the bibliography)"); the ZIP also contains `bibliography.bib` (stored or generated
  BibTeX of all entries) for LaTeX.

## Links in Markdown and attached files
- Links keep their Markdown form (`[text](bib:key)`, `[text](../../../references/<path>)`, `[text](https://…)`); the
  editor only decorates them: a book icon for citations and a paperclip for reference files (widgets, not part of the
  text), dotted/solid underline, a tooltip, and a red wavy underline when the source or file does not exist.
- With the cursor on a link a bar shows its target with **Open**, **Change…** (citation/file pickers; the text follows
  when it was the old name) or **Edit** (web address), **Unlink** (keeps the text) and **Remove** (deletes it).
- 📎 on section and sub-block headers attaches reference files to the whole part (`references` in `block.json`, like
  `citations`), listing files linked in the text too. Renaming a file or folder in References updates attachments and
  Markdown links (sub-block revisions bumped); deleting drops attachments and shows where the files were used (links
  in the text stay, flagged as missing). The export adds an "_Attachments:_" line after the section/sub-block and the
  files go into the ZIP. MCP: `attach_reference` / `detach_reference`; the outline shows `📎`.

## Moving reference files
- `POST …/references/move { paths, dir }` moves files/folders into an existing folder (`""` = root) keeping their names.
  Everything is checked before anything moves: a missing source or destination (404), a folder into itself (400), a
  name already in the destination or two items with the same name (409). Items already there are skipped; entries
  inside a selected folder move with it. Converted Markdown (`.mcp/`), attachments and Markdown links follow, as for
  renames (`renameReferencePath`).
- UI: items are draggable (custom `application/x-sourcebook-references` data, so they are never taken for uploads);
  folders and breadcrumbs accept them (not a folder into itself or where they already are). "Move to…" (selection bar,
  context menu) opens a folder picker. If the folder being browsed moves, the browser follows it.

## Reference files for the assistant (Markdown conversion)
- Every reference file has an MCP status: **text** and **images** are read as they are; documents are **converted to
  Markdown** automatically (on upload, or when the file is first listed, e.g. copied in by hand; again when it changes —
  size/mtime, with a SHA-256 recorded); other formats are **not readable**. Everything runs in Node (no Python,
  LibreOffice or external services): `pdfjs-dist` (+ `@napi-rs/canvas`, a prebuilt npm binary, for page images),
  `mammoth` + `turndown` (Word), `word-extractor` (`.doc`), our own readers for PowerPoint/OpenDocument/EPUB/RTF/Jupyter
  (`fflate` + `@xmldom/xmldom`), `exceljs`, `mailparser`, `@kenjiuno/msgreader`.
- Output: `references/.mcp/<path>/content.md` (a preamble, then one part per page/slide/sheet/chapter/file, each opened
  by `<!-- sourcebook:page N -->` and a `## Page N` heading so parts can be read separately), `manifest.json` (source
  size/mtime/hash, converter, per-part analysis, warnings or the error) and `pages/pNNN.webp`. The folder is hidden in
  References, follows renames, is removed with its file, kept when copying projects (timestamps preserved) and left out
  of template archives (rebuilt after import). Conversions run one at a time per project, in the background.
- PDF pages are classified from `getTextContent` and the operator list (images' area through the transformation
  matrices, path operations, text drawn in render mode 3): **text** (≥ 80 readable characters), **text + figures**
  (images ≥ 8 % of the page), **scan** (an image ≥ 85 % of the page; with an invisible OCR layer its text is used and
  flagged), **figures**, **vector** drawing, **blank**; a text layer that is mostly replacement/private-use characters
  counts as unreadable. Pages without usable text get an image (≈ 1100 px wide WebP) and a note in the Markdown;
  headings come from larger fonts, paragraphs from vertical gaps, hyphenated line ends are joined.
- Figures of text pages are cut out: the bounding boxes of images and of vector paths (from `constructPath`, through
  the transformation matrices) are merged when closer than 16 pt; regions of at least 40×30 pt and 1.2 % of the page
  that contain more than hairlines become figures (page backgrounds and rules alone are ignored). The nearest line
  starting with "Figure/Fig./Table/Figura/Tabella… N" just below or above (same column) is the caption. Each figure is
  cut from a ≈ 180 dpi rendering (`figures/pNNN-K.webp`), listed at the end of its page in the Markdown and returned
  by `read_reference_figures` (up to 12 per page, 300 per document).
- Conversions run in a worker thread (one long-lived `worker_threads` worker; TypeScript through `tsx`), so the server
  stays responsive; background conversions emit their live events as "server", so the window that uploaded the file
  sees the result without reloading. `manifest.revision` records the conversion logic version: content produced by an
  older one is converted again automatically.
- Image sub-blocks can take an image file of the references or a figure of a document ("From references…" in the
  block, "Insert into a section…" in the figure inspector and on image files, `add_image_from_reference` via MCP). The
  image is **copied** into the section's `assets/` (the sub-block keeps working when the reference changes or is
  reconverted, and exports need nothing new); its caption defaults to the figure's, and the source file is attached
  to the sub-block (📎) to keep track of where it comes from. Bibliography associations stay manual.
- Statuses (`ReferenceNode.mcp`): `native` (text, or image), `pending` (queued), `converting`, `ready`, `stale`
  (file changed, or converted by an older logic: queued again), `failed` (error recorded in the manifest; retried only
  when the file changes, or on "Convert again") and `unsupported`. The UI shows them as **Yes** (native, ready),
  **Converting** (pending, converting, stale) and **No** (failed, unsupported). Native text formats are recognised by
  extension (`NATIVE_TEXT_EXT` in `packages/shared/src/mcpContent.ts`); images are sent to the assistant scaled so the
  longest side is ≤ 1568 px (WebP).
- Limits: files over 200 MB are not converted automatically (they can be converted on request); at most 200 page
  images are rendered automatically per document (more on request); a conversion taking over 10 minutes is stopped and
  recorded as failed.
- References UI: "Assistant ready" column / card badge with a tooltip, a folder button opening the inspector
  (Markdown, Figures, Pages, What the assistant sees, Details) for converted or failed documents, a counter of readable
  files with a "not readable yet" filter, and actions to convert (files, folders, selections), reconvert, render all
  page images and delete generated content.
- No OCR: the assistant reads page images directly (better on tables, formulas, handwriting) and can store what it read
  with `save_reference_transcription`, which replaces that page's text (marked as transcribed). Limits: layouts in
  columns may interleave; spreadsheet sheets are capped at 1000 rows × 40 columns; ZIPs include up to 200 files, one
  level deep; `.ppt`/`.xls` (old binary formats) are not readable.

## Accounts, access, agents and locks
- Auth is always on in the server binary. Principal: a web session (cookie `sourcebook_session[_<base>]`, `HttpOnly`,
  `SameSite=Strict`, `Path=<base path>`, `Secure` with an https public URL; 30 days, renewed daily with use) or an agent
  token (`Authorization: Bearer sbk_…`). Writes with a session need the `x-sourcebook-client` header (the web client
  sends it; cross-site forms cannot) — with SameSite=Strict, the CSRF protection. Login throttling: 5 failures per
  username+IP, then a doubling wait up to 15 minutes. Until a temporary password is changed, only `/api/auth/*` works
  (403 `password_change_required`).
- Storage in `<workspace>/.sourcebook/` (0700 / 0600, `.gitignore` = `*`) rather than the per-person config dir: one
  volume to mount and back up in a container, and the accounts belong to the workspace they protect. Passwords:
  scrypt (N=16384, r=8, p=1, 16-byte salt, `timingSafeEqual`; a dummy hash is computed for unknown users). Tokens and
  session ids: 32 random bytes, stored as SHA-256. No dependency added (`node:crypto`, cookies parsed by hand).
- First start: owner = profile of an older version (user.json), else the OS login if the workspace already has projects
  (so existing comments stay theirs), else `admin`; password from `SOURCEBOOK_ADMIN_PASSWORD` or generated and printed
  once. `reset-owner-password` (server script) sets a new temporary one offline.
- Roles: owner (everything; at least one active owner is kept) and member. `canCreateProjects` lets a member create
  projects/templates (also import, duplicate): the creator gets `write`. Deleting projects: owners only. Access per
  project/template and username in `access.json`: `read` = view + comment (start threads, reply, resolve/reopen,
  re-anchor, delete own comments, mark notifications read), `write` = everything else. Routes declare
  `config.access`; the default is read for GET, write otherwise, checked in the project-scoped hook. No access = 404.
- Access tokens (`tokens.json`, SHA-256, prefix kept for display) are created by the signed-in user (not with a token)
  and shown once. Agents are identities of a user (unique ids across users and agents, unique names among active
  agents), created in Settings or by the assistant (`register_agent`); the first is the default. They have the user's
  rights at every request (revoked token or agent, disabled or deleted user → 401/403). A script with a token and no
  agent header acts as the user.
- Agents can be revoked (stopped, history kept, id stays taken) or deleted: `POST /api/agents/:id/delete` removes, in
  every project and template, the threads it started (other people's replies go with them), its replies, its
  resolutions (threads reopen), its notifications and locks, then its picture and record; the id becomes free.
  `GET …/footprint` computes the same per project without changing anything (the UI shows it, and asks to type the id).
  Matching is by username, so comments of the pre-accounts era signed with that id go too.
- Pictures of users and agents: `.sourcebook/avatars/<id>.webp`. The browser crops a square (drag, wheel/slider zoom,
  circular preview) and uploads a 256 px PNG as a data URL; the server (`@napi-rs/canvas`, already used for PDFs) crops
  the central square and re-encodes 256×256 WebP whatever it receives, so a script cannot store anything else. Ids
  are shared by users and agents, so one map `id → version` (`GET /api/avatars`) drives every `<Avatar>`; the version
  (mtime) in the URL lets the browser cache pictures forever. Pictures of revoked agents stay (old comments).
- Notifications: read state per user (`readBy`); files of older versions (`read: true`) count as read by all.
- Locks: per sub-block in the project's `locks.json` (not copied, not archived), live event `locks`. Holder =
  user or agent; changing (content, title, objective, edits) or deleting a sub-block held by someone else, or deleting a
  section containing one, answers 423; moving sections/sub-blocks is allowed (content is untouched). No expiry by
  design: holder, the user of a holding agent, or an owner (force) release it; locks of deleted sub-blocks vanish.
- UI: a sign-in gate (`AuthGate`) in front of the app; 401 anywhere brings it back. Read-only projects get a badge,
  hidden write controls (`.write-only`) and sub-block bodies made `inert`; a sub-block held by someone else is `inert`
  too, with a 🔒 badge naming holder and user. Settings tabs: Account (name, password), My agents, AI assistant,
  and for owners Users, Project access, Locks.

## Startup configuration and base path
- `packages/server/src/config.ts`: CLI options > environment > defaults (workspace, host, port, base path, public URL,
  admin password, trust proxy), validated at startup.
- Base path: every route (API, `/mcp`, events, client) is registered under the prefix; URLs generated by the server
  use `app.basePath`; `/` and `<base>` redirect to `<base>/`. The client is built once with relative assets (`base:
  "./"`) and served by the server from `packages/client/dist` with `window.__SOURCEBOOK__ = { basePath }` injected into
  `index.html`; `api/client.ts` builds every URL from it. Routes of the client are hash-based, so a proxy only forwards
  the prefix. The `/mcp` local-only check also accepts the host of the public URL.

## CSV data sub-blocks
- The data lives in the sub-block (`NN-csv.csv`), not as a link to References: it is versioned and edited like any
  content; References files can be imported into it. RFC 4180 parsing (quoted delimiters, quotes, line breaks) in
  `packages/shared/src/csv.ts`; edits in the table rewrite the CSV with minimal quoting (formatting of untouched rows
  may be normalized). Limit 100 000 rows.
- Sorting and filtering only change the view. Column kinds are inferred (number — also "1.234,5" / "12%" —, date,
  boolean, text, empty) for the summary and numeric sorting.
- Comments use line anchors (`commentAnchor: "lines"`), so rows are commented exactly like code lines, through REST and
  MCP alike. The table keeps comments on their rows when rows are deleted (a comment only on a deleted row detaches);
  anchors are re-stored after saves by the shared anchoring hook.

## Bundled templates (Sourcebook Demo)
- Generated by code at startup (`packages/server/src/seed/`) through the same stores the API uses, rather than shipped
  as a folder: every sub-block is validated by the current types, and there are no generated files to keep in sync.
  A test checks that the demo covers every registered sub-block type, so adding a type means adding it to the demo.
- Built in `templates/.seed-<id>` and renamed into place, so a half-built template never appears. Seeded once per id
  (`.sourcebook/seeded.json`): deleting it is respected, and a later version can add new bundled templates to existing
  workspaces. An existing folder with the same id is never touched.
- Only `index.ts` (the real server) enables it (`buildApp({ seedTemplates: true })`); tests and embedders start from an
  empty workspace.

## Container image
- `docker/Dockerfile`, multi-stage on `node:24-bookworm-slim` (glibc, for the prebuilt `@napi-rs/canvas` binaries):
  a build stage with every dependency builds the web client; a prod stage installs only the runtime dependencies of
  the server and its workspace packages (`pnpm --filter "@sourcebook/server..." install --prod`); the runtime stage
  keeps the monorepo layout under `/app`, so the paths used in development (client `dist`) work unchanged.
- The server still runs the TypeScript sources through tsx (`node --import tsx`), like `pnpm start`: no separate
  compile step to maintain. tsx is therefore a runtime dependency of the server. `node` is PID 1 and the server closes
  on SIGTERM/SIGINT (at most 3 s, since live-update streams stay open), so `docker stop` is immediate.
- Unprivileged user (compose: `SOURCEBOOK_UID:GID`, default 1000), a single volume `/data` = the workspace,
  `HEALTHCHECK` on `<base path>/api/auth/me` (any answer below 500).
- Publishing is a manual step (`docker/push.sh`: buildx amd64 + arm64 to `ghcr.io/piconem/sourcebook`, refusing a dirty
  tree or an existing version). No CI workflow yet.

## MCP clients and stdio in a container
- One standard transport (streamable HTTP with a bearer token) serves every client; client support is only connection
  hints: Claude Code, Gemini CLI (`gemini mcp add -t http -H …`; its settings.json takes the same JSON as other
  clients) and OpenAI Codex (`codex mcp add --url … --bearer-token-env-var SOURCEBOOK_TOKEN`: Codex takes no inline
  header). Checked with Gemini CLI 0.65 (`gemini mcp list` → Connected) and Codex CLI 0.164 (configuration accepted).
- stdio means a process started by the AI client on its machine, from a checkout of Sourcebook: impossible inside a
  container. `config.mcpStdio` (default: off when `SOURCEBOOK_CONTAINER=1` or `/.dockerenv`, overridable with
  `SOURCEBOOK_MCP_STDIO`) makes the settings report `stdio: { enabled: false, available: false }` with no connection
  hints, refuses turning it on (400) and refuses stdio calls (403), whatever `settings.json` says.
- ChatGPT connectors are set up with OAuth or without authentication on a public HTTPS URL; Sourcebook's personal
  tokens do not fit: not supported for now.

## Known limitations
- Users with read access cannot select text inside a sub-block to anchor a comment (the body is inert): they comment
  on the whole sub-block.
- A lock taken by a browser stays if the window is closed: release it later or ask an owner.
- One server process per workspace (accounts and sessions are cached in memory; edit `.sourcebook/` only while it is
  stopped).
- Moving references keeps names: a name clash in the destination refuses the whole move (rename first).
- The MCP `search` tool looks in the notebook and the bibliography, not inside reference files or their converted
  Markdown (read them with `read_reference`).
- Excalidraw appState is saved as-is (includes view state such as scroll/zoom).
