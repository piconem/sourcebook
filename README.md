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
pnpm start        # builds the client, then serves everything from the server (http://127.0.0.1:4000/)
pnpm test         # vitest in all packages
pnpm typecheck
```
The workspace folder holds all projects and templates, plus `.sourcebook/` with accounts and settings. Missing
folders are created automatically, and the **Sourcebook Demo** template is added at the first start (see
[Example templates](#example-templates)).

**Docker**: `docker/build.sh` builds the image, `docker/docker-compose.yml` (settings in `docker/.env`) runs it with the
workspace in a mounted folder, `docker/push.sh` publishes it on GHCR — see [docker/README.md](docker/README.md).

**Configuration** (command-line option, else environment variable, else default):

| Option / variable | Default | |
|---|---|---|
| `--workspace` / `SOURCEBOOK_WORKSPACE` | `~/Sourcebook` | where Sourcebook works: projects, templates, `.sourcebook/` |
| `--host` / `SOURCEBOOK_HOST` | `127.0.0.1` | interface to listen on (`0.0.0.0` to accept other machines, e.g. in a container) |
| `--port` / `PORT` | `4000` | port — the only one: web interface, REST API (`/api`) and MCP server (`/mcp`) share it |
| `--base-path` / `SOURCEBOOK_BASE_PATH` | `/` | URL prefix, e.g. `/marco/sourcebook` for `https://mydomain.it/marco/sourcebook/` behind a reverse proxy |
| `--public-url` / `SOURCEBOOK_PUBLIC_URL` | `http://127.0.0.1:<port><base>` | address users reach (shown in MCP connection hints; `https` makes the session cookie `Secure`) |
| `SOURCEBOOK_ADMIN_PASSWORD` | generated | password of the owner account created at the first start |
| `SOURCEBOOK_TRUST_PROXY=1` | off | behind a reverse proxy: trust `X-Forwarded-*` (client IP for sign-in throttling) |

One client build works under any base path (relative asset URLs; the server tells the page its prefix). In development
`SOURCEBOOK_BASE_PATH` is read by Vite as well. Several Sourcebooks can share a domain under different prefixes: each
has its own session cookie.

## Accounts, access and agents
- **First start**: an **owner** account is created — `admin`, or the profile of an older single-user Sourcebook. Its
  password is `SOURCEBOOK_ADMIN_PASSWORD`, or a generated one printed **once** in the server log; it must be changed at
  the first sign-in. Forgot it? `pnpm --filter @sourcebook/server reset-owner-password [--workspace dir]` prints a new
  temporary one (then restart the server).
- **Users**: the owner adds them (Settings → Users) with a temporary password they change at the first sign-in, and
  can disable, reset, delete them or make them owners. Only owners create projects and templates, unless a user is
  given **may create projects** (the creator gets write access to what they create). Only owners delete.
- **Access** (Settings → Project access): per project / template and user, **read** (read and comment) or **write**
  (also edit). Projects without access are invisible. Owners open everything.
- **Agents** (Settings → My agents): each user creates an **access token** (shown once) and configures the MCP server
  with it **once**; all their agents share that configuration. Agents are **identities** registered by the user (or by
  the assistant itself with `register_agent`): every tool takes `agent: "<id>"` to say which one acts, otherwise the
  user's default agent does. An agent has its user's rights and signs as "Reviewer · for Mario Rossi". Only the
  user's own agents can be named; revoking the token, an agent or the user stops them at once. **Revoke** stops an
  agent and keeps its history; **Delete** removes it for good with everything it wrote in every project — threads
  (with their replies), replies, resolutions (threads reopen), notifications, locks, picture — after showing what
  will go and asking to type its id; its id becomes free again. Scripts may use the
  token too (header `x-sourcebook-agent: <id>` to act as an agent, otherwise as the user).
- **Pictures**: each user can set a picture for themselves (Settings → Account) and for each of their agents (My
  agents); the owner can change anyone's. The image is cropped square in the browser (drag and zoom), stored as a
  256×256 WebP and shown in a circle wherever the person or agent appears (comments, notifications, menus); without
  one, the initials.
- **Locks**: a sub-block can be taken (🔒 in its header, or `lock_subblock` for agents): until its holder releases it,
  nobody else can change or delete it (nor delete its section); comments stay open. No expiry: the holder releases it,
  the user an agent works for may release the agent's locks, the owner can release any (in the editor or Settings →
  Locks).
- **Where it is stored**: `<workspace>/.sourcebook/` (folder `0700`, files `0600`, with a `.gitignore` excluding all):
  `accounts.json` (scrypt password hashes), `tokens.json` (SHA-256 of access tokens), `agents.json`, `access.json`,
  `sessions.json` (hashes of session tokens; 30 days, renewed with use), `settings.json` and `avatars/`. Passwords and tokens are never stored. Mount or back
  up the workspace and everything comes along.
- Web sessions are `HttpOnly`, `SameSite=Strict` cookies scoped to the base path; changes must carry the
  `x-sourcebook-client` header (sent by the web client), and repeated wrong passwords are throttled.

**Version**: name, version and release date live in `packages/shared/src/version.ts` (shown in the user menu → About
and reported by the MCP server); keep `version` in the `package.json` files in sync when releasing.

**In the editor**: the outline on the left collapses sub-sections (arrow on each section, "Expand all / Collapse
all", remembered per browser and project). In **References**, files and folders are moved by dragging them onto a
folder or a breadcrumb, or with "Move to…" (links and attachments follow). The avatar at the top right opens the
user menu: Settings and About (version, release date).

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
| GET / PUT | `/api/settings/mcp` | `{ http: { enabled }, stdio: { enabled }, readOnly }` + connection parameters (URL + `Authorization` header, stdio command/args/cwd/env with `SOURCEBOOK_TOKEN`); PUT: owner |
| GET / PUT | `/api/user` | the signed-in user's profile `{ name, username }` (PUT changes the name; the username cannot change) |
| POST | `/api/auth/login` · `/api/auth/logout` | `{ username, password }` → `{ user, author }` + session cookie · ends the session |
| GET | `/api/auth/me` | `{ user, agent?, author }` of the session or agent token (401 otherwise) |
| POST / PATCH | `/api/auth/password` · `/api/auth/profile` | `{ currentPassword, newPassword }` · `{ name }` |
| GET / POST | `/api/users` | list · owner: `{ username, name, password (temporary), role?, canCreateProjects? }` |
| PATCH / DELETE | `/api/users/:username` | owner: `{ name?, role?, canCreateProjects?, disabled?, password? (reset) }` · delete (their agents are revoked) |
| GET · PUT | `/api/access` · `/api/access/:kind/:projectId` | owner: every project/template with `{ access: { username: "read"\|"write" } }` · `{ access: { username: level \| null } }` |
| GET / POST / DELETE | `/api/tokens` · `/api/tokens/:id` | your access tokens (`?all=1` owner: everyone's) · `{ label }` → `{ token, info }` (token shown once; signed in only) · revoke |
| GET / POST / DELETE | `/api/agents` · `/api/agents/:id` | your agents (`?all=1` owner) · `{ id, name }` → the agent (the first is the default) · revoke |
| POST | `/api/agents/:id/default` | make it the agent acting when a call names none |
| GET · POST | `/api/agents/:id/footprint` · `/api/agents/:id/delete` | what deleting it would remove, per project (nothing changes) · delete it for good with all it wrote → what was removed |
| GET | `/api/avatars` · `/api/avatars/:id` | `{ avatars: { id: version } }` · the picture (WebP, 256×256) of a user or agent |
| PUT / DELETE | `/api/avatars/:id` | `{ image: <data URL or base64> }` — cropped to the central square and scaled to 256 px · remove (your own, your agents', or anyone's for owners) |
| GET | `/api/locks` | owner: locked sub-blocks of every project/template |

Every `/api` call needs a session (web) or an access token (`Authorization: Bearer sbu_…`, plus `x-sourcebook-agent` to act
as one of your agents); projects you cannot open
answer 404, writes with read access 403. With a base path, everything (API, `/mcp`, the client) lives under it.
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
| GET | `…/participants` | `{ participants: [{ username, name, kind, onBehalfOf?, registered?, contributions, lastActive? }] }` — users who may open the project and their agents, plus whoever signed comments, replies, resolutions and notifications |
| GET | `…/locks` | `{ locks: [{ blockId, subBlockId, holder, since }] }` |
| POST / DELETE | `…/blocks/:blockId/subblocks/:subBlockId/lock` | take a sub-block (409 if someone else holds it) · release it (holder, the user of the holding agent, or the owner with `?force=1`). Changing or deleting a sub-block held by someone else: 423 |
| POST | `…/reload-request` | `{ message?, notificationIds?, author? }` — asks open editors to reload, listing those notifications (default: the unread ones) |
| GET | `…/references` | tree of `references/`; each file has `mcp: { status, kind, unit?, parts?, pageImages?, figures?, imageOnlyParts?, error? }` (see below) and documents still to convert are queued |
| GET | `…/references/file/*` | a reference, inline (`?download=1` to download) |
| POST | `…/references/upload?dir=…` | multipart, one or more `file` fields (≤ 100 MB each) |
| POST | `…/references/folders` | `{ path }` |
| PATCH | `…/references/rename` | `{ path, newName }` |
| POST | `…/references/move` | `{ paths, dir }` → `{ moved: [{ from, to }] }` — moves files/folders into folder `dir` (`""` = root), keeping names; links and associations follow; 409 on a name clash (nothing moved), 400 for a folder into itself |
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
marks it read, "Mark all as read" and "Clear" manage the list. Unread notifications are also marked where they
apply: a bell on the section in the outline (on a collapsed parent for hidden sub-sections; clicking it goes to the
changed part, again for the next one, without marking anything read) and a bell in the header of each changed
sub-block — or of the section, for changes to the section as a whole — which marks them read. Notifications are
marked read only from that bell or from the top-bar menu. At the end of a group of changes, a reload request
shows the user a dialog with the message and those notifications, and offers to reload the page (pending edits are
saved first).

```bash
# Scripts authenticate with an access token (Settings → My agents): TOKEN=sbu_…
# Tell the user what changed, then ask open editors to reload
curl -X POST localhost:4000/api/projects/checkout/notifications -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"summary": "Updated the API section", "targets": [{"blockId": "'$BLOCK'", "subBlockId": "'$SUB'", "note": "new endpoints"}]}'
curl -X POST localhost:4000/api/projects/checkout/reload-request -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"message": "Refactoring of §2 complete"}'
```

**Links.** The URL follows what is shown: `#/projects/<id>/s/<sectionId>` (a section),
`…/b/<subBlockId>` (a sub-block), `…/c/<commentId>` (a comment thread, opened in the comments column). Ids are used,
so links survive moving sections; the ↗ buttons of sections and sub-blocks copy them.

```bash
# Create a project from a template, then comment lines 12-14 of one of its code sub-blocks
curl -X POST localhost:4000/api/projects -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name": "Checkout", "from": {"kind": "templates", "id": "software-project"}}'
curl -X POST localhost:4000/api/projects/checkout/blocks/$BLOCK/subblocks/$SUB/comments \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"text": "Handle the timeout here", "anchor": {"lines": {"first": 12, "last": 14}}}'
```

## Working with an AI assistant (MCP)
`packages/mcp` is an [MCP](https://modelcontextprotocol.io) server that lets an LLM assistant read and edit
projects and templates with you — sections, sub-blocks, lines, comments and references — through the same REST API
(same validation; your open editor updates live). The Sourcebook server must be running (`pnpm dev`).

**Connecting**: create an access token in **Settings → My agents** — Sourcebook shows it once, with ready-to-copy
commands — and configure the MCP server **once**. Then register your agents' identities (same page, or let the
assistant call `register_agent`): every tool takes `agent: "<id>"`, so several agents (a writer, a reviewer…) sharing
the connection are told apart, each signed with its name and yours; without `agent`, your default agent acts.
**Settings → AI assistant (MCP)** (owner) enables or disables each transport and can make every agent read-only; the
server enforces it.

**HTTP** (built into the Sourcebook server; local requests, or the host of `SOURCEBOOK_PUBLIC_URL`):
```bash
claude mcp add --transport http sourcebook http://127.0.0.1:4000/mcp --header "Authorization: Bearer sbu_…"
```
Or once per project, in a committed `.mcp.json` that reads the token from the environment (`SOURCEBOOK_TOKEN=sbu_… claude`):
```json
{ "mcpServers": { "sourcebook": { "type": "http", "url": "http://127.0.0.1:4000/mcp", "headers": { "Authorization": "Bearer ${SOURCEBOOK_TOKEN}" } } } }
```
**stdio** (the client starts the process):
```bash
claude mcp add -e SOURCEBOOK_TOKEN=sbu_… sourcebook -- pnpm --silent --dir "/path/to/sourcebook" --filter @sourcebook/mcp exec tsx src/stdio.ts
```
Environment (stdio): `SOURCEBOOK_TOKEN` (your access token), `SOURCEBOOK_URL` (default `http://127.0.0.1:4000`, include
the base path if any), `SOURCEBOOK_MCP_READONLY=1` (reading tools only).

`whoami` tells an agent who it is, whom it works for and the other agents of its user; `list_participants` shows the
people and agents of a project.
Before a longer piece of work on a sub-block an agent takes it with `lock_subblock` and releases it with
`unlock_subblock`; `list_locks` shows who holds what.

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
`include_resolved` for all), `list_notifications`, `whoami`, `list_participants`, `list_locks` · `register_agent` · `lock_subblock`, `unlock_subblock` · `save_reference_transcription`, `move_references` (move files/folders between folders of
References; links and associations follow) · `create_project`, `create_template`, `create_section`, `add_subblock`,
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

**CSV data** (`csv`) sub-blocks hold a reference data set to reason about (with you or the assistant): in the editor a
table (sort by column, filter, edit cells and column names, add/remove rows and columns, 100 rows per page), a
**Summary** per column (type, filled/empty, distinct values, min/max/mean, most frequent values) and the raw **CSV**;
import a `.csv`/`.tsv` file from your computer or from References (the delimiter is detected), download it back.
Comments attach to rows (💬 in the row gutter; select rows by their number, Shift+click for several). The assistant
reads and edits the CSV text like any other: line 1 is the header, line N+1 is row N, so `§2#1:L5` is row 4. The
combined Markdown shows the first 50 rows as a table.

## Example templates
**Sourcebook Demo** ships with Sourcebook: the server adds it to the workspace at its first start (and to existing
workspaces after an upgrade), once — if the owner deletes it, it does not come back (`.sourcebook/seeded.json`
remembers it; remove the id from there to get it again). It is a tour to start a first project from: a sub-block of
every type (Markdown, Mermaid, drawing, equation, code, image, CSV data, question, multiple choice), nested sections,
objectives, a bibliography entry cited in the text, reference files linked and attached, and pages on comments,
notifications, locks, permissions and connecting an AI assistant. Its content is in
`packages/server/src/seed/demoTemplate.ts`.

`python3 scripts/create-example-templates.py [--replace] [--only <id>…]` creates the other ones through the REST API
of a running server: **Software Project**, Scientific Paper, Research Project Proposal, Thesis.

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
