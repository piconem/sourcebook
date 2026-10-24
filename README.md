<p align="center">
  <img src="images/sourcebook_logo.png" alt="Sourcebook logo" width="220" />
</p>

<h1 align="center">Sourcebook</h1>

<p align="center">
  <strong>Stay in control of your design, writing and development.</strong><br />
  A notebook of modular blocks where AI agents support your work — in a structured, visible and controlled way.
</p>

<p align="center">
  🏠 <b>Local and self-hosted</b> — install it wherever you want: your computer, a server, Docker.<br />
  📄 <b>Plain files, Markdown first</b> — your content lives in a folder of yours as Markdown and plain text files, never in a closed database.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/version-0.2.0-blue.svg" alt="Version 0.2.0" />
  <a href="docs/ai-assistant.md"><img src="https://img.shields.io/badge/MCP-compatible-8A2BE2.svg" alt="MCP compatible" /></a>
  <a href="docker/README.md"><img src="https://img.shields.io/badge/docker-ready-2496ED.svg?logo=docker&amp;logoColor=white" alt="Docker ready" /></a>
  <img src="https://img.shields.io/badge/platform-linux%20%7C%20macOS%20%7C%20windows-lightgrey.svg" alt="Platforms: Linux, macOS, Windows" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%E2%89%A522-339933.svg?logo=node.js&amp;logoColor=white" alt="Node.js ≥ 22" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&amp;logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&amp;logoColor=black" alt="React 18" />
  <img src="https://img.shields.io/badge/Fastify-5-000000.svg?logo=fastify&amp;logoColor=white" alt="Fastify 5" />
  <a href="docs/development.md"><img src="https://img.shields.io/badge/tested%20with-Vitest-6E9F18.svg?logo=vitest&amp;logoColor=white" alt="Tested with Vitest" /></a>
</p>

---

## What it is
Sourcebook is a **local application you install wherever you want** — on your laptop, on a server of your group, in
Docker — and use from the browser. No cloud service, no account elsewhere: Sourcebook itself sends your projects
nowhere; content reaches an AI model only through the agents you connect, and only what they read.

Everything is stored as **plain files in a folder of yours**, Markdown first: text is Markdown (`.md`), and each other
block keeps its natural format — Mermaid (`.mmd`), LaTeX (`.tex`), CSV (`.csv`), source code (`.py`, `.ts` …),
small JSON files for questions and choices. A whole project exports as **one Markdown document**, and the documents
you add as references (PDF, Word, slides…) are converted to Markdown for the assistant. You can open, edit, back up
and version everything with your own tools, Git included.

It is a web application for writing **structured documents made of blocks**: design documents, research
papers, theses, project proposals, requirements, decision logs. It is the place where ideas, structure and decisions
are worked out *before* they become code, papers or products.

Its purpose is to keep **you in control** of that process. AI agents and LLMs can help — draft, review, analyse data,
read your documents — but they work *inside* the structure you define, on the blocks you point them to, and everything
they do is visible, signed and reversible. You decide; agents support.

## The idea: modular blocks
A Sourcebook document is not one long page. It is a **tree of sections**, and each section is a sequence of
**sub-blocks**, each of its own type:

| | |
|---|---|
| ✍️ **Markdown** text | 📊 **CSV data** sets, with table and column summary |
| 🔀 **Mermaid** diagrams | ❓ **Questions** with their answers |
| ✏️ hand-made **drawings** | ☑️ **Multiple choice** for decisions and checklists |
| ∑ **LaTeX** equations | 🖼️ **images** and figures from your documents |
| 💻 **code** in any language | 📎 attached references and 📚 bibliography |

Every block has an **objective** (what it must contain), its own **comments**, a precise address (`§2.1#3`, or
`§2.1#3:L10-14` for some lines), and can be **locked** while someone works on it. Blocks are the unit of work: small
enough to discuss, review, assign and change one at a time — by you, by a colleague or by an AI agent — without
stepping on each other.

## You stay in control
- **You set the structure and the goals**: sections, blocks and the **objective** of each one tell agents exactly what
  is expected — and nothing else.
- **Precise, scoped requests**: *Ask AI* turns a block, some lines or a comment thread into a request about exactly that
  part; agents address blocks and lines (`§2.1#3:L10-14`), not "the document".
- **Agents propose, you decide**: they can comment instead of editing; you reply, accept or resolve. **Read-only**
  mode lets agents read and comment without changing anything.
- **Everything is visible and signed**: every comment and change carries its author — *"Reviewer · for Alex Morgan"* —
  and agents report what they changed with **notifications** that link to each modified block.
- **Protect what you are working on**: **lock** a block and nobody — person or agent — can change it until you release it.
- **Reversible**: revoke an agent at once, or delete it with everything it wrote; your content is plain files you can
  keep under Git.
- **Your data stays yours**: self-hosted, no cloud service required; agents reach Sourcebook only with your personal
  token and never have more rights than you.

## Ways of working

**🧑 Alone** — Organise a complex piece of work as an outline of blocks; mix text, diagrams, data and decisions; keep
open questions and options next to the content; start from one of the [templates](#templates).

**🧑 + 🤖 Alone, supported by AI agents** — Connect an assistant — Claude Code, Gemini CLI, OpenAI Codex or any MCP
client — through the built-in **MCP server**, and bring it in when you need it. Agents read the project (including
your PDFs and documents, converted automatically), comment precise lines, draft or revise the blocks you ask for, and
tell you what they changed with notifications. You can give each agent a role — a *writer*, a *reviewer*, a *data
analyst* — each with its own name and picture.

**👥 With other people** — Invite users and give each one **read** (read and comment) or **write** access per project.
Comment threads, replies and resolutions, change notifications, live updates and locks let several people work on
the same document.

**👥 + 🤖 A team supported by agents** — Each person connects their own agents with one personal token. Every
contribution is signed — *"Reviewer · for Alex Morgan"* — so everyone knows which person or which agent did what, each
agent answers to its person, and the same permissions and locks apply to people and agents alike.

## Templates
A template is a ready-made structure to start a project from: sections, sub-blocks, an **objective** for every part
and, where useful, instructions and ready-to-paste prompts for the agents. Every installation comes with five:

| Template | For |
|---|---|
| **Sourcebook Demo** | a guided tour: one block of every type, comments, references, bibliography, agents |
| **Software Project** | software designed with AI agents: requirements, open questions, decisions (ADR) with status, architecture, design, data models, testing, plan, issues |
| **Scientific Paper** | a research paper: idea, motivation, related work, method, experiments, results, discussion |
| **Research Project Proposal** | a collaborative proposal, simplified from Horizon Europe: excellence, impact, implementation |
| **Thesis** | a bachelor, master or PhD thesis: state of the art, contribution, implementation, evaluation |

Templates are edited like projects. Any project can be **saved as a template**, and templates are **exported and
imported as ZIP files** to share them with others.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="images/screenshots/03-editor.webp" alt="The editor: outline of sections, objectives, a Markdown block" /><br /><sub><b>The editor</b> — sections in the outline, typed blocks, an objective for each.</sub></td>
    <td width="50%"><img src="images/screenshots/04-comments-on-text.webp" alt="Comment of a Reviewer agent on a sentence, with replies" /><br /><sub><b>Agents propose, you decide</b> — a Reviewer agent comments a sentence; you and the Writer agent reply.</sub></td>
  </tr>
  <tr>
    <td><img src="images/screenshots/07-code-review-and-lock.webp" alt="Review comment on code lines and a block locked by an agent" /><br /><sub><b>Precise review</b> — comments on code lines; a block locked while an agent works on it.</sub></td>
    <td><img src="images/screenshots/08-csv-data-with-row-comments.webp" alt="CSV data set with comments of a Data analyst agent on rows" /><br /><sub><b>Data to reason about</b> — a CSV data set; a Data analyst agent comments individual rows.</sub></td>
  </tr>
  <tr>
    <td><img src="images/screenshots/11-agent-notifications.webp" alt="Notifications from agents listing the blocks they changed" /><br /><sub><b>Nothing happens behind your back</b> — agents report what they changed, with links to each block.</sub></td>
    <td><img src="images/screenshots/17-settings-agents.webp" alt="Settings: access tokens and agent identities" /><br /><sub><b>Your agents, your rules</b> — one personal token, named agents, revoke or delete them at any time.</sub></td>
  </tr>
</table>

➡️ **[All screenshots, full size with captions](docs/screenshots.md)**

<details>
<summary><b>More screenshots</b> — projects, templates, diagrams, drawings, decisions, references, bibliography, Ask AI, settings, dark theme</summary>
<br />

| | |
|---|---|
| ![Projects](images/screenshots/01-projects.webp) <br /><sub>Projects</sub> | ![Templates](images/screenshots/02-templates.webp) <br /><sub>Templates</sub> |
| ![Mermaid diagrams](images/screenshots/05-mermaid-diagrams.webp) <br /><sub>Mermaid diagrams</sub> | ![Drawing](images/screenshots/06-drawing.webp) <br /><sub>Hand-made drawings (Excalidraw)</sub> |
| ![CSV column summary](images/screenshots/09-csv-column-summary.webp) <br /><sub>Column summary of a data set</sub> | ![Questions and decisions](images/screenshots/10-questions-and-decisions.webp) <br /><sub>Open questions and decisions</sub> |
| ![All comments](images/screenshots/12-all-comments.webp) <br /><sub>Every comment of the project</sub> | ![References](images/screenshots/13-references.webp) <br /><sub>References, readable by the assistant</sub> |
| ![Reference converted for the assistant](images/screenshots/14-reference-converted-for-assistant.webp) <br /><sub>A PDF converted to Markdown for the assistant</sub> | ![Bibliography](images/screenshots/15-bibliography.webp) <br /><sub>Bibliography</sub> |
| ![Ask AI](images/screenshots/16-ask-ai.webp) <br /><sub>Ask AI: a scoped request, ready to paste</sub> | ![MCP settings](images/screenshots/18-settings-mcp.webp) <br /><sub>Connecting Claude Code, Gemini CLI, OpenAI Codex</sub> |
| ![Users](images/screenshots/19-settings-users.webp) <br /><sub>Users</sub> | ![Project access](images/screenshots/20-settings-project-access.webp) <br /><sub>Read or write access per project</sub> |
| ![Dark theme](images/screenshots/21-dark-theme.webp) <br /><sub>Dark theme</sub> | |

</details>

## Getting started

**With Node.js** (≥ 22):
```bash
git clone https://github.com/piconem/sourcebook.git
cd sourcebook
corepack enable          # provides pnpm
pnpm install
pnpm start               # → http://127.0.0.1:4000
```

**With Docker**:
```bash
docker/build.sh          # builds the image
cd docker
cp .env.example .env     # data folder, port, base path, public URL…
mkdir -p data
docker compose up -d     # → http://127.0.0.1:4000
```

At the first start Sourcebook creates the **owner** account and prints its password in the log (`docker compose logs
sourcebook` with Docker); you choose a new one at the first sign-in. Your data lives in `~/Sourcebook` (Node) or in
`docker/data` (Docker); the workspace starts with the [templates](#templates) below — open **Sourcebook Demo** first,
a guided tour of every block type.

## Documentation

| | |
|---|---|
| [Installation and configuration](docs/installation.md) | requirements, Node and Docker, first start, options (port, base path, public URL…) |
| [Docker](docker/README.md) | image, docker compose, reverse proxy, Windows, publishing |
| [User guide](docs/user-guide.md) | projects, sections and block types, comments, notifications, references, bibliography, templates |
| [Collaboration](docs/collaboration.md) | users, access per project, agents and tokens, pictures, locks, where accounts are stored |
| [AI assistant (MCP)](docs/ai-assistant.md) | connecting an assistant, agent identities, tools, documents for the assistant |
| [REST API](docs/rest-api.md) | every endpoint, with examples for scripts |
| [File format](docs/file-format.md) | how projects are stored on disk |
| [Development](docs/development.md) | repository layout, commands, adding a block type |
| [Design decisions](docs/decisions.md) | implementation choices and known limitations |
| [Screenshots](docs/screenshots.md) | the application in use, full size with captions |
| [Libraries and licenses](docs/libraries.md) | the open-source libraries Sourcebook is built on |

## License
[MIT](LICENSE) — free to use, modify and redistribute. The libraries it includes keep their own licenses: see
[Libraries and licenses](docs/libraries.md).
