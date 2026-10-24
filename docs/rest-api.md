[← Sourcebook](../README.md) · [Installation](installation.md) · [Docker](../docker/README.md) · [User guide](user-guide.md) · [Collaboration](collaboration.md) · [AI assistant](ai-assistant.md) · [REST API](rest-api.md) · [File format](file-format.md) · [Development](development.md) · [Libraries](libraries.md)

# REST API

## Workspace
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
| GET | `/api/types` | registered sub-block types |

Every `/api` call needs a session (web) or an access token (`Authorization: Bearer sbu_…`, plus `x-sourcebook-agent` to act
as one of your agents); projects you cannot open
answer 404, writes with read access 403. With a base path, everything (API, `/mcp`, the client) lives under it.

## Inside a project or template
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
