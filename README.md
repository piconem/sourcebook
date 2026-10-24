<p align="center">
  <img src="images/sourcebook_logo.png" alt="Sourcebook logo" width="220" />
</p>

<h1 align="center">Sourcebook</h1>

<p align="center">
  A notebook of modular blocks where people and AI agents think, write and decide together.
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
Sourcebook is a web application for writing **structured documents made of blocks**: design documents, research
papers, theses, project proposals, requirements, decision logs. It is the place where ideas, structure and decisions
are worked out *before* they become code, papers or products.

You run it yourself (on your computer, a server or in Docker). Everything is saved as **plain files** in a folder of
yours: Markdown, source code, CSV, JSON. Nothing is locked inside a database, and everything can be versioned with Git.

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

## Ways of working

**🧑 Alone** — Organise a complex piece of work as an outline of blocks; mix text, diagrams, data and decisions; keep
open questions and options next to the content; start from a template (Software Project, Scientific Paper, Thesis,
Research Proposal, or the *Sourcebook Demo* tour).

**🧑 + 🤖 Alone with AI agents** — Connect an assistant — Claude Code, Gemini CLI, OpenAI Codex or any MCP client —
through the built-in **MCP server**. Agents
read the whole project (including your PDFs and documents, converted automatically), write and edit blocks, comment
precise lines, and tell you what they changed with notifications. Several agents can work with you at once — a
*writer*, a *reviewer* — each with its own name and picture.

**👥 With other people** — Invite users and give each one **read** (read and comment) or **write** access per project.
Comment threads, replies and resolutions, change notifications, live updates and locks let several people work on
the same document.

**👥 + 🤖 A team with agents** — Each person connects their own agents with one personal token. Every contribution is
signed — *"Reviewer · for Mario Rossi"* — so everyone knows which person or which agent did what, and the same
permissions and locks apply to people and agents alike.

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
`docker/data` (Docker); the workspace starts with the **Sourcebook Demo** template, a guided tour of every block type.

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
| [Libraries and licenses](docs/libraries.md) | the open-source libraries Sourcebook is built on |

## License
[MIT](LICENSE) — free to use, modify and redistribute. The libraries it includes keep their own licenses: see
[Libraries and licenses](docs/libraries.md).
