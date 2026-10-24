[← Sourcebook](../README.md) · [Installation](installation.md) · [Docker](../docker/README.md) · [User guide](user-guide.md) · [Collaboration](collaboration.md) · [AI assistant](ai-assistant.md) · [REST API](rest-api.md) · [File format](file-format.md) · [Development](development.md) · [Libraries](libraries.md)

# Working with AI assistants (MCP)
`packages/mcp` is an [MCP](https://modelcontextprotocol.io) server that lets an LLM assistant read and edit
projects and templates with you — sections, sub-blocks, lines, comments and references — through the same REST API
(same validation; your open editor updates live). The Sourcebook server must be running.

## Connecting
Create an access token in **Settings → My agents** — Sourcebook shows it once, with ready-to-copy
commands — and configure the MCP server **once**. Then register your agents' identities (same page, or let the
assistant call `register_agent`): every tool takes `agent: "<id>"`, so several agents (a writer, a reviewer…) sharing
the connection are told apart, each signed with its name and yours; without `agent`, your default agent acts.
**Settings → AI assistant (MCP)** (owner) enables or disables each transport and can make every agent read-only; the
server enforces it.

## Clients
Sourcebook speaks standard MCP over **streamable HTTP**, so any MCP client works. Settings → AI assistant (MCP) and,
with your token filled in, Settings → My agents show these commands ready to copy.

| Client | How to add Sourcebook |
|---|---|
| **Claude Code** | `claude mcp add --transport http sourcebook http://127.0.0.1:4000/mcp --header "Authorization: Bearer sbu_…"` |
| **Gemini CLI** | `gemini mcp add --scope user --transport http --header "Authorization: Bearer sbu_…" sourcebook http://127.0.0.1:4000/mcp` |
| **OpenAI Codex CLI** | `export SOURCEBOOK_TOKEN=sbu_…` then `codex mcp add sourcebook --url http://127.0.0.1:4000/mcp --bearer-token-env-var SOURCEBOOK_TOKEN` (Codex reads the token from that variable, not from an inline header) |
| **Claude Desktop** | stdio, below (not available when Sourcebook runs in a container) |
| **Other clients** | the JSON below (also the format of Gemini CLI's `~/.gemini/settings.json`) |

```json
{ "mcpServers": { "sourcebook": { "type": "http", "url": "http://127.0.0.1:4000/mcp", "headers": { "Authorization": "Bearer sbu_…" } } } }
```
Codex as a file (`~/.codex/config.toml`):
```toml
[mcp_servers.sourcebook]
url = "http://127.0.0.1:4000/mcp"
bearer_token_env_var = "SOURCEBOOK_TOKEN"
```
Claude Code, once per project, in a committed `.mcp.json` that reads the token from the environment
(`SOURCEBOOK_TOKEN=sbu_… claude`):
```json
{ "mcpServers": { "sourcebook": { "type": "http", "url": "http://127.0.0.1:4000/mcp", "headers": { "Authorization": "Bearer ${SOURCEBOOK_TOKEN}" } } } }
```
The HTTP endpoint accepts local requests and the host of `SOURCEBOOK_PUBLIC_URL`. Gemini CLI enables MCP servers only
in folders it trusts: `gemini mcp list` shows *Disabled* in an untrusted folder.

**ChatGPT and the model APIs.** The OpenAI Responses API calls remote MCP servers from OpenAI's cloud: Sourcebook must
then be reachable on a public **HTTPS** address (`SOURCEBOOK_PUBLIC_URL`, behind a reverse proxy), and the token goes in
the `Authorization` header of its MCP tool. The Gemini API SDKs connect to MCP servers from your own program, like any
client above. ChatGPT connectors are set up with OAuth or without authentication, while Sourcebook uses personal access
tokens: ChatGPT is not supported for now (check the current ChatGPT documentation before relying on this).

## stdio
The client starts a local process that talks to Sourcebook over HTTP:
```bash
claude mcp add -e SOURCEBOOK_TOKEN=sbu_… sourcebook -- pnpm --silent --dir "/path/to/sourcebook" --filter @sourcebook/mcp exec tsx src/stdio.ts
```
Environment (stdio): `SOURCEBOOK_TOKEN` (your access token), `SOURCEBOOK_URL` (default `http://127.0.0.1:4000`, include
the base path if any), `SOURCEBOOK_MCP_READONLY=1` (reading tools only).

stdio needs a checkout of Sourcebook on the machine of the AI client. It is therefore **not available when Sourcebook
runs in a container** (the image sets `SOURCEBOOK_CONTAINER=1`): Settings shows it as unavailable, and the server
refuses stdio calls. `SOURCEBOOK_MCP_STDIO=true|false` overrides the default (on natively, off in a container).

## Agents, locks and Ask AI
`whoami` tells an agent who it is, whom it works for and the other agents of its user; `list_participants` shows the
people and agents of a project.
Before a longer piece of work on a sub-block an agent takes it with `lock_subblock` and releases it with
`unlock_subblock`; `list_locks` shows who holds what.

**Ask AI**: the ✨💬 button on the document, sections, sub-blocks, selected text/code lines, comment threads and
reference files prepares a ready-to-paste request (brainstorming, critique, build/fill, improve/rewrite, comment, or
your own prompt) that points the assistant at exactly that element.

## Reference files and the assistant
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
CSV data sub-blocks are read and written as CSV text: line 1 is the header, line N+1 is row N, so `§2#1:L5` is row 4.
