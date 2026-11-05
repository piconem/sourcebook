[← Sourcebook](../README.md) · [Installation](installation.md) · [Docker](../docker/README.md) · [User guide](user-guide.md) · [Collaboration](collaboration.md) · [AI assistant](ai-assistant.md) · [REST API](rest-api.md) · [File format](file-format.md) · [Development](development.md) · [Libraries](libraries.md) · [Screenshots](screenshots.md)

# User guide

## Projects, sections and sub-blocks
- The **home page** lists projects and templates (sortable; right-click or ⋯ for open, rename, duplicate, save as
  template, new project from a template, export a template as ZIP, delete).
- A project is a tree of **sections** (§1, §2, §2.1 …) shown in the **outline** on the left; each section holds an
  ordered list of **sub-blocks** (§2.1#1, §2.1#2 …). Add one with the **＋** between sub-blocks, reorder by dragging
  its handle, move sections by dragging them in the outline (onto another one to nest them).
- Sections and sub-blocks can have a **title** and an **objective**: what they must contain, for you and for the
  assistant.
- Changes are saved automatically; other people's and assistants' changes appear live.

The outline on the left collapses sub-sections (arrow on each section, "Expand all / Collapse
all", remembered per browser and project). The left sidebar can be widened by dragging its edge, or hidden
to give the document the whole width: the button left of the logo, or **Ctrl+\\** (⌘+\\ on macOS); remembered per
browser. **Zoom** (− 100% + in the top bar, or Ctrl + mouse wheel over the document) enlarges or shrinks only the
document, not the whole page, from 50% to 200%; click the percentage to go back to 100%. Drawings keep their own
zoom. **Appearance** (half-moon icon): theme (Light, Dark, Sepia, Midnight or System) and, for dark themes, how
blocks look: dark like the theme, *light text* (Markdown blocks light for reading, code and diagrams dark) or *light
blocks*. In **References**, files and folders are moved by dragging them onto a
folder or a breadcrumb, or with "Move to…" (links and attachments follow). The avatar at the top right opens the
user menu: Settings and About (version, release date).

## Sub-block types

| Type | What it is | Stored as |
|---|---|---|
| **Markdown** | rich text: headings, lists, tables, links, code, images, citations | `.md` |
| **Mermaid diagram** | flowcharts, sequence, class, state, ER, Gantt… written as text | `.mmd` (+ PNG/SVG export) |
| **Drawing** | free-hand sketches (Excalidraw) | `.excalidraw` (+ PNG) |
| **Equation** | LaTeX formulas (KaTeX) | `.tex` |
| **Code** | source code with syntax highlighting; comments attach to lines | `.py`, `.ts`, … (the extension is the language) |
| **Image** | an uploaded image or a figure taken from a reference document, with caption | `.md` + `assets/` |
| **CSV data** | a reference data set: table, column summary, raw CSV | `.csv` |
| **Question** | a question and its answer (open questions, FAQ, interviews) | `.json` |
| **Multiple choice** | single or multiple choice with a note (decisions, checklists, polls) | `.json` |

**CSV data** sub-blocks hold a reference data set to reason about (with you or the assistant): in the editor a
table (sort by column, filter, edit cells and column names, add/remove rows and columns, 100 rows per page), a
**Summary** per column (type, filled/empty, distinct values, min/max/mean, most frequent values) and the raw **CSV**;
import a `.csv`/`.tsv` file from your computer or from References (the delimiter is detected), download it back.
Comments attach to rows (💬 in the row gutter; select rows by their number, Shift+click for several). The assistant
reads and edits the CSV text like any other: line 1 is the header, line N+1 is row N, so `§2#1:L5` is row 4. The
combined Markdown shows the first 50 rows as a table.

## Comments
Select text (or code lines, or CSV rows) and comment it, or comment a whole sub-block. Threads have replies and can be
resolved and reopened; anchored comments follow their text when it moves and show as *detached* when it is gone. The
comments column sits next to the document; the top bar lists every comment of the project. People with **read** access
can comment too.

## Notifications
An application or script that changes a project tells the user what it did with one
notification per group of changes (a short summary plus the sections, sub-blocks or comments involved). They appear
in the bell menu at the top right of the editor (unread count, author, summary, links to each part); opening one
marks it read, "Mark all as read" and "Clear" manage the list. Unread notifications are also marked where they
apply: a bell on the section in the outline (on a collapsed parent for hidden sub-sections; clicking it goes to the
changed part, again for the next one, without marking anything read) and a bell in the header of each changed
sub-block — or of the section, for changes to the section as a whole — which marks them read. Notifications are
marked read only from that bell or from the top-bar menu. At the end of a group of changes, a reload request
shows the user a dialog with the message and those notifications, and offers to reload the page (pending edits are
saved first).

## References and bibliography
- **References** (top bar) is the project's folder of input files: documents, PDFs, data, images, in folders you
  choose. Files can be uploaded, renamed, moved (drag onto a folder or "Move to…") and downloaded as ZIP. Every file is
  made readable by the assistant (documents converted to Markdown automatically): see
  [AI assistant](ai-assistant.md#reference-files-and-the-assistant).
- Files can be **linked** from Markdown text or **attached** (📎) to a whole section or sub-block.
- **Bibliography** (top bar) holds citable sources (BibTeX import/export). Cite them in Markdown with the ❝ Cite button:
  they become links `[Name](bib:key)`, and the export adds a final **References** section.

## Links, export, locks
- **Links**: The URL follows what is shown: `#/projects/<id>/s/<sectionId>` (a section),
`…/b/<subBlockId>` (a sub-block), `…/c/<commentId>` (a comment thread, opened in the comments column). Ids are used,
so links survive moving sections; the ↗ buttons of sections and sub-blocks copy them.
- **Export**: the whole project as one Markdown document, or a ZIP with every referenced file.
- **Locks** 🔒: take a sub-block before a long piece of work so nobody else changes it; see
  [Collaboration](collaboration.md).
- **Ask AI** ✨💬: prepares a ready-to-paste request for your assistant about the document, a section, a sub-block,
  a selection, a comment thread or a reference file.

## Templates
Five templates ship with Sourcebook: **Sourcebook Demo**, **Software Project**, **Scientific Paper**, **Research Project
Proposal** and **Thesis**. The server adds them to the workspace at its first start (and to existing workspaces after
an upgrade), each once — if the owner deletes one, it does not come back (`.sourcebook/seeded.json` remembers it; remove
the id from there to get it again), and a template with the same id already in the workspace is left as it is.

**Sourcebook Demo** is a tour to start a first project from: a sub-block of
every type (Markdown, Mermaid, drawing, equation, code, image, CSV data, question, multiple choice), nested sections,
objectives, a bibliography entry cited in the text, reference files linked and attached, and pages on comments,
notifications, locks, permissions and connecting an AI assistant. Its content is in
`packages/server/src/seed/demoTemplate.ts`.

**Software Project** is meant to be worked on alone or with an AI assistant. It starts with _Prompts_ (a ready-to-paste
briefing for an AI assistant, in English and Italian: MCP tools / REST API, structure, behaviour) and _Instructions_ (conventions,
IDs such as FR-xx / Q-xx / ADR-xxx / T-xx, section status, rules for the assistant, glossary), then Vision & Objectives,
Requirements, Open Questions (question and multiple-choice blocks), Decisions (ADR), Architecture, Design (patterns,
sequence and class diagrams, interfaces, error handling), Data Models, Project Structure & Packages, Cross-cutting
Concerns, Testing, Deployment & Operations, Documentation, Development Plan, Issues/Bugs/Tech Debt and Risks. The ADR
section opens with an index of all decisions; each ADR has a status block (🟡 Proposed · 🟢 Approved · 🔴 Rejected),
context, a question block, the options considered (multiple choice with a note) and the consequences.

Any project can be saved as a template, and templates can be exported and imported as ZIP files.
