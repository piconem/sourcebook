#!/usr/bin/env python3
"""
Creates example Sourcebook templates through the REST API:
  - Software Project (replaces the former "Software Design Document")
  - Scientific Paper
  - Research Project Proposal (simplified, inspired by EU Horizon Europe proposals)
  - Thesis

Usage:  SOURCEBOOK_TOKEN=sbu_… python3 scripts/create-example-templates.py [--api http://127.0.0.1:4000] [--replace] [--only <id>…]
An access token (Settings → My agents) of an owner, or of a user who may create projects, is required: --token or
the SOURCEBOOK_TOKEN environment variable.
Existing templates with the same id are skipped, or deleted and recreated with --replace.
--only limits the run to the given template ids (e.g. --only software-project).
Retired templates (RETIRED) are deleted when --replace is given.
"""
import argparse
import json
import os
import sys
import textwrap
import urllib.error
import urllib.request

API = "http://127.0.0.1:4000"
TOKEN = os.environ.get("SOURCEBOOK_TOKEN", "")


def call(method, path, body=None):
    req = urllib.request.Request(
        API + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={**({"content-type": "application/json"} if body is not None else {}),
                 **({"authorization": f"Bearer {TOKEN}"} if TOKEN else {})},
    )
    try:
        with urllib.request.urlopen(req) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()}")


# ---------------------------------------------------------------- spec helpers

def t(s):
    return textwrap.dedent(s).strip() + "\n"


def md(title, text, objective=None):
    return {"type": "markdown", "title": title, "objective": objective, "content": {"markdown": t(text)}}


def mermaid(title, code, objective=None):
    return {"type": "mermaid", "title": title, "objective": objective, "content": {"code": t(code)}}


def code(title, language, source, objective=None):
    return {"type": "code", "title": title, "objective": objective, "content": {"language": language, "code": t(source)}}


def eq(title, latex, objective=None):
    return {"type": "equation", "title": title, "objective": objective, "content": {"latex": latex}}


def question(title, text, answer="", objective=None):
    return {"type": "question", "title": title, "objective": objective, "content": {"question": text, "answer": answer}}


def choice(title, text, options, mode="single", selected=(), note="", objective=None):
    """options: [(id, text)…]; selected: option ids."""
    return {
        "type": "choice", "title": title, "objective": objective,
        "content": {"question": text, "mode": mode, "options": [{"id": i, "text": x} for i, x in options],
                    "selected": list(selected), "note": note},
    }


def section(title, objective=None, subs=(), children=()):
    return {"title": title, "objective": objective, "subs": list(subs), "children": list(children)}


# ---------------------------------------------------------------- 1. Software project

# ADR status: a single-answer choice whose options carry a colored dot.
ADR_STATUS = [("proposed", "🟡 Proposed"), ("approved", "🟢 Approved"), ("rejected", "🔴 Rejected")]


def adr_status(selected, note):
    return choice("Status", "What is the status of this decision?", ADR_STATUS, selected=[selected], note=note,
                  objective="Exactly one status. Proposed → under discussion; Approved → binding for design and code; Rejected → kept for history.")


SOFTWARE = {
    "name": "Software Project",
    "description": "A software project worked on alone or with an AI assistant: instructions, objectives, requirements, open questions, decisions (ADR), architecture, design, data, project structure, testing, plan and issues.",
    "sections": [
        # ------------------------------------------------------------ Prompts
        section("Prompts", "Ready-to-paste prompts that brief an AI assistant on how to work on this project (MCP / REST API, structure, behaviour). Replace <project-id> before using them.", subs=[
            md("Prompt (English)", """
                You are working with me on a software project kept in **Sourcebook**, a local block-based design notebook.
                The project id is `<project-id>`. Sourcebook is the source of truth: requirements, open questions,
                decisions and design live there before they become code.

                ## How to access the project

                Use the **Sourcebook MCP tools** (pass `project: "<project-id>"`):

                - **Read:** `get_outline` (sections, objectives, sub-block summaries — start here), `read_section`,
                  `read_subblock` (numbered source lines and `rev`), `read_document` (everything), `search`,
                  `list_comments`, `list_notifications`, `list_references` / `read_reference`, `list_bibliography`.
                - **Write:** `edit_subblock_text` (targeted find/replace or line edits — preferred), `update_subblock`,
                  `add_subblock`, `create_section`, `update_section`, `move_section`, `move_subblock`.
                - **Discuss:** `add_comment` (on a sub-block, lines or a quote), `reply_to_comment`, `resolve_comment`.
                - **Report:** `notify_changes` (summary + parts involved), `request_reload`.
                - Ask me before any destructive tool (`delete_section`, `delete_subblock`, `delete_comment`).

                Without MCP, use the REST API at `http://127.0.0.1:4000/api/projects/<project-id>`: `GET /notebook`,
                `GET /markdown`, `GET /blocks/{id}`, `PATCH /blocks/{id}/subblocks/{subId}` (with `expectedRev`),
                `POST /blocks/{id}/subblocks/{subId}/comments`, `GET /comments?status=open`, `POST /notifications`,
                `POST /reload-request`.

                ## How the project is structured

                - **Sections** are numbered (§1, §2.1 …); each holds ordered **sub-blocks** (§2.1#3) of type markdown,
                  code, mermaid, equation, image, drawing, **question** (question + answer) or **choice** (multiple choice
                  with a note). Question and choice sources are JSON. Lines are referenced as §2.1#3:L10-14.
                - Each section and sub-block may have an **objective**: what it must contain. Read it before writing.
                - Outline numbers change when sections move; ids never do. Quote both when you report.
                - Main parts: _Instructions_ (conventions, **Rules for the Assistant**, Glossary) → Vision & Objectives →
                  Requirements (FR-xx, NFR-xx, UC-xx) → Open Questions (Q-xx) → Decisions (ADR-xxx, with an index and a
                  status 🟡 Proposed · 🟢 Approved · 🔴 Rejected) → Architecture → Design → Data Models → Project Structure
                  → Testing → Development Plan (T-xx) → Issues (BUG-xx, TD-xx) → Risks.

                ## How to behave

                1. **First** read _Instructions_ completely (especially _Rules for the Assistant_ and the _Glossary_), then
                   `get_outline`. Follow those rules; they override this prompt where they differ.
                2. **Read before writing.** Use `read_subblock` and pass `expectedRev` when I may be editing the same part;
                   on a conflict, re-read and retry. Prefer small `edit_subblock_text` edits to full rewrites.
                3. Edit directly only `[Draft]` sections; for `[Review]` / `[Approved]` ones, propose changes as comments.
                4. **Never** set an ADR to Approved or Rejected yourself, and never add requirements, technologies or scope
                   that are not in the document — ask, or record a question (Q-xx) in _Open Questions_.
                5. Keep IDs stable, use the next free number for new items, and keep the ADR index in sync.
                6. Before writing code, read Requirements, the **approved** ADRs, Design, Data Models and Project Structure
                   (layout and coding conventions); reference the IDs you implement.
                7. When you finish a group of changes: resolve the comments you handled, send **one** `notify_changes` with a
                   short summary and the parts involved (§ references or comment ids), and call `request_reload` if I should
                   reload to see the whole result. Then tell me what you changed, with references.
                8. If something is unclear, ask me instead of guessing.
                """, "English version of the briefing prompt for an AI assistant."),
            md("Prompt (Italiano)", """
                Stai lavorando con me a un progetto software gestito in **Sourcebook**, un quaderno di progettazione locale
                a blocchi. L'id del progetto è `<project-id>`. Sourcebook è la fonte di verità: requisiti, domande aperte,
                decisioni e design stanno lì prima di diventare codice.

                ## Come accedere al progetto

                Usa i **tool MCP di Sourcebook** (passa `project: "<project-id>"`):

                - **Lettura:** `get_outline` (sezioni, objective, riassunto dei blocchi — parti da qui), `read_section`,
                  `read_subblock` (righe numerate del sorgente e `rev`), `read_document` (tutto), `search`,
                  `list_comments`, `list_notifications`, `list_references` / `read_reference`, `list_bibliography`.
                - **Scrittura:** `edit_subblock_text` (modifiche mirate trova/sostituisci o per righe — da preferire),
                  `update_subblock`, `add_subblock`, `create_section`, `update_section`, `move_section`, `move_subblock`.
                - **Discussione:** `add_comment` (su un blocco, su righe o su una citazione), `reply_to_comment`,
                  `resolve_comment`.
                - **Resoconto:** `notify_changes` (sintesi + parti coinvolte), `request_reload`.
                - Chiedimi conferma prima di ogni tool distruttivo (`delete_section`, `delete_subblock`, `delete_comment`).

                Senza MCP usa le API REST su `http://127.0.0.1:4000/api/projects/<project-id>`: `GET /notebook`,
                `GET /markdown`, `GET /blocks/{id}`, `PATCH /blocks/{id}/subblocks/{subId}` (con `expectedRev`),
                `POST /blocks/{id}/subblocks/{subId}/comments`, `GET /comments?status=open`, `POST /notifications`,
                `POST /reload-request`.

                ## Com'è strutturato il progetto

                - Le **sezioni** sono numerate (§1, §2.1 …); ognuna contiene **blocchi** ordinati (§2.1#3) di tipo markdown,
                  code, mermaid, equation, image, drawing, **question** (domanda + risposta) o **choice** (scelta multipla
                  con nota). Il sorgente di question e choice è JSON. Le righe si indicano come §2.1#3:L10-14.
                - Sezioni e blocchi possono avere un **objective**: cosa devono contenere. Leggilo prima di scrivere.
                - I numeri dell'outline cambiano quando le sezioni vengono spostate, gli id no. Riporta entrambi.
                - Parti principali: _Instructions_ (convenzioni, **Rules for the Assistant**, Glossary) → Vision & Objectives →
                  Requirements (FR-xx, NFR-xx, UC-xx) → Open Questions (Q-xx) → Decisions (ADR-xxx, con un indice e uno
                  stato 🟡 Proposed · 🟢 Approved · 🔴 Rejected) → Architecture → Design → Data Models → Project Structure
                  → Testing → Development Plan (T-xx) → Issues (BUG-xx, TD-xx) → Risks.

                ## Come comportarti

                1. **Per prima cosa** leggi tutta la sezione _Instructions_ (in particolare _Rules for the Assistant_ e il
                   _Glossary_), poi `get_outline`. Segui quelle regole: dove differiscono, prevalgono su questo prompt.
                2. **Leggi prima di scrivere.** Usa `read_subblock` e passa `expectedRev` quando potrei modificare la stessa
                   parte; in caso di conflitto rileggi e riprova. Preferisci piccole modifiche con `edit_subblock_text` alle
                   riscritture complete.
                3. Modifica direttamente solo le sezioni `[Draft]`; per quelle `[Review]` / `[Approved]` proponi le modifiche
                   con commenti.
                4. **Non** impostare mai tu un ADR come Approved o Rejected, e non aggiungere requisiti, tecnologie o scope che
                   non sono nel documento: chiedimelo, oppure registra una domanda (Q-xx) in _Open Questions_.
                5. Mantieni stabili gli ID, usa il primo numero libero per i nuovi elementi e tieni aggiornato l'indice degli ADR.
                6. Prima di scrivere codice leggi Requirements, gli ADR **approvati**, Design, Data Models e Project Structure
                   (struttura e convenzioni di codice); cita gli ID che implementi.
                7. Quando finisci un gruppo di modifiche: risolvi i commenti che hai gestito, invia **una** `notify_changes`
                   con una breve sintesi e le parti coinvolte (riferimenti § o id dei commenti) e chiama `request_reload` se
                   devo ricaricare per vedere il risultato completo. Poi dimmi cosa hai cambiato, con i riferimenti.
                8. Se qualcosa non è chiaro, chiedimelo invece di indovinare.
                """, "Versione italiana del prompt di istruzioni per un assistente AI."),
        ]),

        # ------------------------------------------------------------ 0. Instructions
        section("Instructions", "Explain how this document is organised and how people and AI assistants must work on it. Read this first.", children=[
            section("How to Use This Document", "Conventions every contributor (human or assistant) follows: order of work, identifiers, section status.", subs=[
                md("Conventions", """
                    This document is the **source of truth** for the project: ideas, requirements and decisions are written
                    here before they become code.

                    **Suggested order of work:** Objectives → Requirements → Open Questions → Decisions (ADR) → Architecture →
                    Design → Data Models → Project Structure → Testing → Development Plan. Go back and forth freely: a
                    question raised while designing goes to _Open Questions_, a decision taken goes to _Decisions (ADR)_.

                    **Identifiers** — every item that other parts refer to has a stable ID, never reused:

                    | Prefix | Item | Where |
                    | --- | --- | --- |
                    | G-xx | Goal | Objectives |
                    | FR-xx / NFR-xx | Functional / non-functional requirement | Requirements |
                    | UC-xx | Use case or user story | Requirements |
                    | Q-xx | Open question | Open Questions |
                    | ADR-xxx | Architecture decision record | Decisions (ADR) |
                    | T-xx | Task | Development Plan |
                    | BUG-xx / TD-xx | Bug / technical debt | Issues, Bugs & Tech Debt |

                    Refer to items by ID (e.g. "implements FR-03, follows ADR-002"), so they can be traced from requirement
                    to decision, design, test and task.

                    **Section status** — write it at the top of the section objective when useful:
                    `[Draft]` being written, anyone may edit · `[Review]` complete, discuss with comments ·
                    `[Approved]` agreed, change only through a new or updated ADR.

                    **Placeholders** look like `[text in brackets]` or _italic hints_: replace them, then delete the hints.
                    """, "The rules of the document in one page."),
            ]),
            section("Rules for the Assistant", "Instructions an AI assistant (via MCP) must follow when reading or editing this project.", subs=[
                md("Rules", """
                    _These rules are written for an AI assistant working on this project through the Sourcebook MCP server.
                    Adapt them to your way of working._

                    **Before doing anything**

                    1. Read _Instructions_ (this section) and the _Glossary_; use the glossary terms, do not invent synonyms.
                    2. Read the outline (`get_outline`) and the objective of the sections you will touch: the objective says
                       what a section must contain.

                    **When writing**

                    3. Edit directly only sections marked `[Draft]` (or with no status). For `[Review]` and `[Approved]`
                       sections, propose changes as comments (`add_comment`) and wait for the user.
                    4. Never change the status of an ADR to Approved or Rejected yourself: propose it, the user decides.
                    5. Keep IDs stable; new items take the next free number. Update the ADR index when you add an ADR.
                    6. Record new doubts as Q-xx in _Open Questions_ instead of guessing; when a question is answered with a
                       decision, create the ADR and reference it from the question.
                    7. Do not add requirements, dependencies or technologies that are not in this document or agreed with
                       the user. Respect _Scope & Non-goals_.

                    **When generating code**

                    8. Read first: Requirements, Decisions (ADR, Approved only), Design (interfaces, patterns, error
                       handling), Data Models and Project Structure (layout and coding conventions).
                    9. Mention the IDs your code implements (FR-xx, T-xx) in commit messages or pull requests.

                    **When done**

                    10. Resolve the comments you have handled (`resolve_comment`).
                    11. Send one `notify_changes` per group of changes with a short summary and the parts involved; ask for a
                        reload (`request_reload`) when the user should see the whole result.
                    """, "Clear, checkable rules: what the assistant reads first, what it may change, how it reports."),
            ]),
            section("Glossary", "Define every domain term once; both people and assistants must use these words consistently.", subs=[
                md("Terms", """
                    | Term | Definition | Not to be confused with |
                    | --- | --- | --- |
                    | [Term] | [Definition in plain language] | [Similar term] |
                    """),
            ]),
        ]),

        # ------------------------------------------------------------ 1. Objectives
        section("Vision & Objectives", "Why the project exists, what it must achieve and what it deliberately does not do.", children=[
            section("Goals", "The outcomes the project commits to, each measurable.", subs=[
                md("Problem statement", """
                    _Two or three sentences from the user's point of view. Avoid naming solutions here._

                    [Who has the problem] currently [does what / suffers what], which causes [cost, risk or pain].
                    """),
                md("Goals", """
                    | ID | Goal | Measure of success |
                    | --- | --- | --- |
                    | G-01 | [Outcome] | [Metric and target] |
                    | G-02 | [Outcome] | [Metric and target] |
                    """),
            ]),
            section("Scope & Non-goals", "Draw the boundary: what is included in this version and what is explicitly excluded.", subs=[
                md("Scope", """
                    **In scope**

                    - [Capability]

                    **Non-goals** (explicitly excluded — an assistant must not add them)

                    - [Excluded capability] — _why: [reason]_
                    """),
            ]),
            section("Stakeholders & Users", "Who uses or is affected by the system and what success means for each.", subs=[
                md("Stakeholders", """
                    | Stakeholder | Role | Needs | Success criteria |
                    | --- | --- | --- | --- |
                    | [End user] | [Uses the system to …] | [What they need] | [How they judge success] |
                    | [Maintainer] | [Develops and runs it] | [Simple deploys, clear logs] | [Time to fix a bug] |
                    """),
            ]),
        ]),

        # ------------------------------------------------------------ 2. Requirements
        section("Requirements", "What the system must do and how well, in a testable way. Every requirement has an ID.", children=[
            section("Functional Requirements", "Behaviours the system provides, each with priority and acceptance criteria.", subs=[
                md("Functional requirements", """
                    _MoSCoW priority (Must, Should, Could, Won't). Every acceptance criterion must be verifiable by a test._

                    | ID | Requirement | Priority | Acceptance criteria | Use case |
                    | --- | --- | --- | --- | --- |
                    | FR-01 | The system shall [behaviour]. | Must | Given [context], when [action], then [result]. | UC-01 |
                    | FR-02 | The system shall [behaviour]. | Should | [Criterion] | UC-01 |
                    """),
            ]),
            section("Non-Functional Requirements", "Quality attributes (performance, security, availability, …) with measurable targets.", subs=[
                md("Quality attributes", """
                    | ID | Attribute | Scenario | Target |
                    | --- | --- | --- | --- |
                    | NFR-01 | Performance | [N] concurrent users call [operation] | p95 latency < [X] ms |
                    | NFR-02 | Security | [Threat or access scenario] | [Control] |
                    | NFR-03 | Maintainability | A developer adds [feature type] | < [N] days |
                    """),
            ]),
            section("Use Cases & User Stories", "Concrete interactions that give meaning to the requirements.", subs=[
                md("UC-01: [Name]", """
                    **Actor:** [user role] · **Goal:** [what they want] · **Requirements:** FR-01, FR-02

                    1. [Actor] [does something].
                    2. The system [responds].
                    3. …

                    **Alternative flows:** [error or edge case] → [behaviour]

                    _User story form:_ As a [role], I want [capability] so that [benefit].
                    """),
            ]),
            section("Constraints & Assumptions", "Decisions already imposed, and assumptions the design relies on.", subs=[
                md("Constraints and assumptions", """
                    - **Technical:** [mandated language, platform, legacy system]
                    - **Organisational:** [team, deadlines, budget]
                    - **Regulatory:** [GDPR, standards]

                    **Assumptions** (to be validated)

                    - [Assumption] — _validated by: [how / when]_
                    """),
            ]),
        ]),

        # ------------------------------------------------------------ 3. Questions
        section("Open Questions", "Doubts to be resolved. One block per question (Q-xx); a question settled by a decision points to its ADR.", subs=[
            md("How to use", """
                Use a **Question** block for open-ended questions and a **Multiple choice** block when the answer is one of
                a few alternatives (the note explains the choice). Title each block `Q-xx: …`. When a question is answered:

                - write the answer and, if it is a design decision, create an ADR and write "→ ADR-xxx" in the answer;
                - resolve the related comments. Answered questions stay here as history.
                """),
            question("Q-01: Who are the first users?", "Which user group do we target with the first release, and how many users do we expect?",
                     "", "Open-ended question: answer in a few sentences."),
            choice("Q-02: Deployment target", "Where will the first version run?",
                   [("cloud", "Managed cloud (PaaS)"), ("onprem", "On-premise server"), ("desktop", "Local desktop app")],
                   mode="single", note="",
                   objective="Pick one; explain in the note. If this becomes binding, record it as an ADR."),
            choice("Q-03: Supported platforms", "Which platforms must the first release support?",
                   [("linux", "Linux"), ("macos", "macOS"), ("windows", "Windows"), ("web", "Web browser")],
                   mode="multiple", note=""),
        ]),

        # ------------------------------------------------------------ 4. ADR
        section("Decisions (ADR)", "Architecture Decision Records: one sub-section per decision, never deleted. The index lists them all.", subs=[
            md("ADR index", """
                **Status:** 🟡 Proposed (under discussion) · 🟢 Approved (binding) · 🔴 Rejected (kept for history).
                Keep this list in sync with the sub-sections below — one row per ADR, newest last.

                | ADR | Decision | Status | Date | Related |
                | --- | --- | --- | --- | --- |
                | ADR-001 | [Example] Choose the persistence technology | 🟡 Proposed | [YYYY-MM-DD] | Q-02, NFR-01 |
                | ADR-002 | [Example] Use a layered architecture | 🟢 Approved | [YYYY-MM-DD] | NFR-03 |
                | ADR-003 | [Example] Event sourcing for the order history | 🔴 Rejected | [YYYY-MM-DD] | ADR-001 |
                """, "Every ADR of the project with its current status (same dot as its Status block)."),
        ], children=[
            section("ADR-001: [Example] Choose the persistence technology", "Example ADR — copy this structure for new decisions: status, context, question, options, decision, consequences.", subs=[
                adr_status("proposed", "Proposed by [name] on [YYYY-MM-DD]. Deciders: [names]."),
                md("Context", """
                    _What forces the decision: requirements, constraints, current situation. Link the IDs._

                    The system must store [entities] (see _Data Models_) with [consistency / query needs] (NFR-01) and run
                    [where] (Q-02). The team knows [technologies].
                    """),
                question("Decision question", "Which database should store the application data?",
                         "_Filled in once decided — e.g. \"PostgreSQL, because …\"._"),
                choice("Options considered", "Which option do we choose?",
                       [("pg", "PostgreSQL — relational, strong consistency, mature tooling"),
                        ("mongo", "MongoDB — document model, flexible schema"),
                        ("sqlite", "SQLite — embedded, zero operations, single writer")],
                       mode="single", note="[Pros and cons of each option, and why the selected one wins.]",
                       objective="The alternatives evaluated; select the chosen one when the ADR is approved."),
                md("Decision & consequences", """
                    **Decision:** [We will use … for …].

                    **Consequences**

                    - ✅ [Positive consequence]
                    - ⚠️ [Trade-off or cost we accept]
                    - 🔁 [Follow-up work: tasks T-xx, ADRs to revisit]
                    """),
            ]),
            section("ADR-002: [Example] Use a layered architecture", "Example of an approved ADR: the chosen option is selected and the decision is binding.", subs=[
                adr_status("approved", "Approved by [names] on [YYYY-MM-DD]."),
                md("Context", """
                    The code base must stay easy to change by a small team (NFR-03); domain rules must be testable without
                    the database or the web framework.
                    """),
                question("Decision question", "How do we organise the code into layers?",
                         "Three layers — api → domain ← infra — with dependencies pointing to the domain (see _Project Structure_)."),
                choice("Options considered", "Which option do we choose?",
                       [("layered", "Layered (api / domain / infra)"), ("hexagonal", "Hexagonal (ports & adapters)"), ("none", "No explicit layering")],
                       mode="single", selected=["layered"],
                       note="Hexagonal is cleaner but heavier for the team's size; layered gives most of the benefit with less ceremony."),
                md("Decision & consequences", """
                    **Decision:** We use a layered architecture with the dependency rules in _Project Structure & Packages_.

                    - ✅ Domain logic unit-testable in isolation
                    - ⚠️ Some mapping code between layers
                    """),
            ]),
            section("ADR-003: [Example] Event sourcing for the order history", "Example of a rejected ADR: kept to remember why the option was discarded.", subs=[
                adr_status("rejected", "Rejected on [YYYY-MM-DD]: see the note in Options considered."),
                md("Context", """
                    We need an audit trail of order changes (FR-xx). Event sourcing was proposed as the storage model.
                    """),
                question("Decision question", "Do we store orders as a stream of events?",
                         "No: an audit table written by the order service covers the requirement (→ ADR-001)."),
                choice("Options considered", "Which option do we choose?",
                       [("es", "Event sourcing"), ("audit", "Current-state tables + audit log table")],
                       mode="single", selected=["audit"],
                       note="Event sourcing adds projections, replays and versioned events the team has no experience with; the audit requirement does not need it."),
            ]),
        ]),

        # ------------------------------------------------------------ 5. Architecture
        section("Architecture", "The main building blocks, their responsibilities and how they are deployed.", children=[
            section("System Context", "The system as a black box with its users and external systems.", subs=[
                mermaid("Context diagram", """
                    flowchart LR
                        user([User]) -->|uses| sys[The System]
                        admin([Administrator]) -->|configures| sys
                        sys -->|reads/writes| ext1[(External service A)]
                        sys -->|sends notifications| ext2[Email provider]
                    """),
            ]),
            section("Components", "Containers and components with their single responsibility.", subs=[
                mermaid("Component diagram", """
                    flowchart TB
                        subgraph System
                            ui[Web UI] --> api[API]
                            api --> svc[Domain services]
                            svc --> repo[Repositories]
                        end
                        repo --> db[(Database)]
                    """),
                md("Responsibilities", """
                    | Component | Responsibility | Technology | Owner |
                    | --- | --- | --- | --- |
                    | [Component] | [One sentence] | [Language / framework] | [Team / person] |
                    """),
            ]),
            section("Tech Stack & Dependencies", "Languages, frameworks and libraries with versions — the only ones code may use.", subs=[
                md("Tech stack", """
                    | Area | Choice | Version | Why (ADR) |
                    | --- | --- | --- | --- |
                    | Language | [e.g. TypeScript] | [5.x] | ADR-xxx |
                    | Framework | [ ] | [ ] | |
                    | Database | [ ] | [ ] | ADR-001 |
                    | Testing | [ ] | [ ] | |

                    **External services / APIs:** [name] — [purpose, limits, credentials handling]
                    """),
            ]),
            section("Deployment View", "Where components run and how they communicate.", subs=[
                mermaid("Deployment diagram", """
                    flowchart LR
                        subgraph Client
                            browser[Browser]
                        end
                        subgraph Server["Server / cloud"]
                            app[Application container]
                            db[(Database)]
                        end
                        browser -->|HTTPS| app --> db
                    """),
            ]),
        ]),

        # ------------------------------------------------------------ 6. Design
        section("Design", "How the components work inside: patterns, key scenarios, structure (UML), interfaces and error handling.", children=[
            section("Design Patterns", "Patterns used, where and why; code must follow them consistently.", subs=[
                md("Patterns", """
                    | Pattern | Where | Why | Notes |
                    | --- | --- | --- | --- |
                    | [Repository] | [Data access layer] | [Isolate persistence from domain] | [Interface per aggregate] |
                    | [Strategy] | [ ] | [ ] | |
                    """),
            ]),
            section("Key Scenarios (Sequence Diagrams)", "The most important flows step by step, one diagram each, linked to use cases.", subs=[
                mermaid("UC-01: [Scenario name]", """
                    sequenceDiagram
                        actor U as User
                        participant UI as Web UI
                        participant API as API
                        participant S as Service
                        participant DB as Database
                        U->>UI: [action]
                        UI->>API: POST /resource
                        API->>S: create(command)
                        S->>DB: insert
                        DB-->>S: ok
                        S-->>API: result
                        API-->>UI: 201 Created
                        UI-->>U: [feedback]
                    """, "One sequence diagram per key use case; name it after the UC."),
                md("Notes on the scenario", """
                    _Explain what the diagram does not show: validation, transactions, retries, error paths._
                    """),
            ]),
            section("Class Diagrams (UML)", "Static structure of the main modules: classes, interfaces and relations.", subs=[
                mermaid("Domain classes", """
                    classDiagram
                        class Order {
                          +id: UUID
                          +status: OrderStatus
                          +addItem(product, qty)
                          +total() Money
                        }
                        class OrderItem {
                          +quantity: int
                          +price: Money
                        }
                        class OrderRepository {
                          <<interface>>
                          +save(order)
                          +findById(id) Order
                        }
                        Order "1" *-- "many" OrderItem
                        OrderRepository ..> Order
                    """),
            ]),
            section("Interfaces & APIs", "Contracts between components and with the outside: endpoints, messages, signatures.", subs=[
                md("API overview", """
                    | Method | Path | Request | Response | Errors | Requirement |
                    | --- | --- | --- | --- | --- | --- |
                    | POST | /api/[resources] | [body] | 201 [resource] | 400, 409 | FR-01 |
                    | GET | /api/[resources]/{id} | – | 200 [resource] | 404 | FR-02 |
                    """),
                code("Contract example", "typescript", """
                    /** Request/response types shared by client and server. */
                    export interface CreateResourceRequest {
                      name: string;
                    }

                    export interface Resource {
                      id: string;
                      name: string;
                      createdAt: string; // ISO 8601
                    }
                    """),
            ]),
            section("Error Handling", "How errors are classified, propagated, logged and shown to users.", subs=[
                md("Error handling policy", """
                    - **Validation errors** → [400 with field details]; never logged as errors.
                    - **Not found / conflicts** → [404 / 409].
                    - **Unexpected errors** → logged with [correlation id]; the user sees [generic message].
                    - **Retries:** [which calls, how many, backoff].
                    """),
            ]),
        ]),

        # ------------------------------------------------------------ 7. Data
        section("Data Models", "The data the system owns: entities, relations, storage and evolution.", children=[
            section("Domain Model", "Entities and relations, independent of storage.", subs=[
                mermaid("Entity–relationship diagram", """
                    erDiagram
                        CUSTOMER ||--o{ ORDER : places
                        ORDER ||--|{ ORDER_ITEM : contains
                        PRODUCT ||--o{ ORDER_ITEM : "is in"
                    """),
                md("Entities", """
                    | Entity | Description | Key attributes | Invariants |
                    | --- | --- | --- | --- |
                    | [Order] | [ ] | [id, status, createdAt] | [total ≥ 0] |
                    """),
            ]),
            section("Persistence & Schema", "How entities are stored: schema, indexes, retention.", subs=[
                code("Schema", "sql", """
                    CREATE TABLE orders (
                      id          UUID PRIMARY KEY,
                      status      TEXT NOT NULL,
                      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
                    );
                    """),
                md("Migrations & retention", """
                    - **Migrations:** [tool], one migration per change, never edited once applied.
                    - **Retention / privacy:** [what is deleted when, personal data handling].
                    """),
            ]),
        ]),

        # ------------------------------------------------------------ 8. Project structure
        section("Project Structure & Packages", "Repository layout, modules and conventions — the context needed to write consistent code.", children=[
            section("Repository Layout", "Folders and packages, each with its purpose and allowed dependencies.", subs=[
                code("Layout", "plaintext", """
                    project/
                      src/
                        api/          HTTP layer (controllers, DTOs)
                        domain/       entities, services — no framework imports
                        infra/        repositories, external clients
                      tests/
                      docs/
                    """),
                md("Packages & dependency rules", """
                    | Package | Responsibility | May depend on |
                    | --- | --- | --- |
                    | api | [ ] | domain |
                    | domain | [ ] | – |
                    | infra | [ ] | domain |
                    """),
            ]),
            section("Coding Conventions", "Style and practices every contributor and assistant follows.", subs=[
                md("Conventions", """
                    - **Style:** [formatter / linter and config]
                    - **Naming:** [files, classes, functions, tests]
                    - **Errors & logging:** see _Design → Error Handling_
                    - **Comments & docs:** [when to write them]
                    - **Commits / branches:** [convention, e.g. Conventional Commits, `feature/T-xx-…`]
                    """),
            ]),
            section("Build & Tooling", "How to set up, build, run and release locally.", subs=[
                code("Commands", "bash", """
                    # setup
                    [install command]
                    # run locally
                    [dev command]
                    # tests
                    [test command]
                    """),
            ]),
        ]),

        # ------------------------------------------------------------ 9. Cross-cutting
        section("Cross-cutting Concerns", "Qualities that touch every component: security, configuration, observability, performance.", subs=[
            md("Security", """
                - **Authentication / authorisation:** [mechanism, roles]
                - **Secrets:** [where they live, never in the repository]
                - **Threats considered:** [list, with mitigations]
                """),
            md("Configuration", """
                | Setting | Source (env / file) | Default | Description |
                | --- | --- | --- | --- |
                | [APP_PORT] | env | [8080] | [ ] |
                """),
            md("Observability & performance", """
                - **Logs:** [format, levels, correlation id]
                - **Metrics / traces:** [what, where]
                - **Performance budget:** [targets from NFR-xx and how they are measured]
                """),
        ]),

        # ------------------------------------------------------------ 10. Testing
        section("Testing", "How we know the system works: strategy, test plan traced to requirements, definition of done.", children=[
            section("Test Strategy", "Kinds of tests, tools and what each level covers.", subs=[
                md("Strategy", """
                    | Level | Scope | Tool | Runs |
                    | --- | --- | --- | --- |
                    | Unit | [domain logic] | [ ] | every commit |
                    | Integration | [repositories, external APIs] | [ ] | every commit |
                    | End-to-end | [key scenarios UC-xx] | [ ] | before release |
                    """),
            ]),
            section("Test Plan", "Which tests verify which requirement.", subs=[
                md("Traceability", """
                    | Requirement | Test(s) | Status |
                    | --- | --- | --- |
                    | FR-01 | [test name / file] | [Not started / Passing] |
                    | NFR-01 | [load test] | [ ] |
                    """),
            ]),
            section("Definition of Done", "When a task counts as finished.", subs=[
                md("Definition of done", """
                    - [ ] Acceptance criteria of the related FR-xx met
                    - [ ] Tests written and passing
                    - [ ] Code reviewed; follows _Coding Conventions_
                    - [ ] Documentation updated (this document and user docs)
                    - [ ] Related comments and questions resolved
                    """),
            ]),
        ]),

        # ------------------------------------------------------------ 11. Deployment
        section("Deployment & Operations", "Environments, CI/CD, release and run-time operations.", subs=[
            md("Environments & pipeline", """
                | Environment | Purpose | URL / host | Deployed by |
                | --- | --- | --- | --- |
                | dev | [ ] | [ ] | [ ] |
                | production | [ ] | [ ] | [ ] |

                **CI/CD:** [pipeline steps: build → test → package → deploy]

                **Release & rollback:** [versioning scheme, how to roll back]
                """),
        ]),

        # ------------------------------------------------------------ 12. Documentation
        section("Documentation", "Documentation produced for users, developers and operators.", subs=[
            md("Documentation plan", """
                | Document | Audience | Where | Status |
                | --- | --- | --- | --- |
                | README | developers | repository root | [ ] |
                | API reference | integrators | [generated from …] | [ ] |
                | User guide | end users | [ ] | [ ] |
                | Runbook | operators | [ ] | [ ] |
                """),
        ]),

        # ------------------------------------------------------------ 13. Plan
        section("Development Plan", "Milestones and tasks, each traced to requirements.", children=[
            section("Milestones", "Major steps with their goal and expected date.", subs=[
                mermaid("Roadmap", """
                    gantt
                        title Roadmap
                        dateFormat YYYY-MM-DD
                        section Foundations
                        Setup & skeleton      :m1, 2026-01-05, 14d
                        section Features
                        Core features (FR-01) :m2, after m1, 28d
                        section Release
                        Hardening & release   :m3, after m2, 14d
                    """),
            ]),
            section("Tasks", "The backlog: small, verifiable tasks.", subs=[
                md("Backlog", """
                    | ID | Task | Implements | Owner | Status |
                    | --- | --- | --- | --- | --- |
                    | T-01 | [Set up repository and CI] | – | [ ] | ⬜ To do |
                    | T-02 | [Implement …] | FR-01 | [ ] | ⬜ To do |

                    Status: ⬜ To do · 🔄 In progress · ✅ Done · ⛔ Blocked
                    """),
            ]),
        ]),

        # ------------------------------------------------------------ 14. Issues
        section("Issues, Bugs & Tech Debt", "Known problems and accepted shortcuts, with severity and status.", subs=[
            md("Issues", """
                | ID | Description | Severity | Found in | Status | Fix (T-xx) |
                | --- | --- | --- | --- | --- | --- |
                | BUG-01 | [What happens, how to reproduce] | [High / Medium / Low] | [version] | Open | |
                | TD-01 | [Shortcut taken and its cost] | [ ] | [ ] | Accepted | |
                """),
        ]),

        # ------------------------------------------------------------ 15. Risks
        section("Risks", "What could go wrong, how likely, how bad, and what we do about it.", subs=[
            md("Risk register", """
                | Risk | Likelihood | Impact | Mitigation | Owner |
                | --- | --- | --- | --- | --- |
                | [Risk description] | Medium | High | [Action] | [Name] |
                """),
        ]),
    ],
}

# ---------------------------------------------------------------- 2. Scientific paper

PAPER = {
    "name": "Scientific Paper",
    "description": "Research paper structure: idea, context and motivation, related work, method, experimental design, results, discussion.",
    "sections": [
        section("Title and Abstract", "Summarise the whole paper so that a reader can decide in one minute whether to read it.", subs=[
            md("Working title", """
                _A specific, informative title (ideally stating the contribution or main finding)._

                [Working title]
                """),
            md("Abstract", """
                _150–250 words, one or two sentences per point:_

                1. **Context:** [the broader area and why it matters]
                2. **Gap:** [what is missing or unsolved]
                3. **Approach:** [what we propose]
                4. **Results:** [main quantitative findings]
                5. **Implications:** [why the results matter]
                """, "Write it last, but keep a draft from day one to stay focused."),
        ]),
        section("Introduction", "Motivate the problem, state the research questions and the contributions clearly.", children=[
            section("Context and Motivation", "Explain the broader context and why the problem is important now.", subs=[
                md("Context", """
                    _From general to specific: the field, the practical or scientific need, evidence that the problem matters (numbers, trends, citations)._
                    """),
            ]),
            section("Problem Statement and Research Questions", "Formulate the precise problem and the questions the paper answers.", subs=[
                md("Research questions", """
                    - **RQ1:** [Question answerable by the experiments]
                    - **RQ2:** [Question]
                    - **RQ3:** [Question]
                    """, "Every RQ must be answered explicitly in the Results or Discussion."),
            ]),
            section("Contributions", "List what is new in this work, in verifiable terms.", subs=[
                md("Contributions", """
                    This paper makes the following contributions:

                    1. [A new method / model / dataset / analysis …]
                    2. [An evaluation showing …]
                    3. [An open-source implementation / artifact …]
                    """),
            ]),
            section("Paper Organisation", "Guide the reader through the rest of the paper.", subs=[
                md("Roadmap", "Section 2 reviews related work. Section 3 presents [...]. Section 4 describes the experimental design, Section 5 reports the results, Section 6 discusses them and Section 7 concludes."),
            ]),
        ]),
        section("Background and Related Work", "Give the background needed and position the work against the state of the art.", children=[
            section("Background", "Introduce the concepts and notation the reader needs.", subs=[
                md("Key concepts", "_Define the concepts, models and notation used in the rest of the paper._"),
            ]),
            section("Related Work", "Group prior work by approach and explain the limitations this paper addresses.", subs=[
                md("Comparison with prior work", """
                    | Work | Approach | Strengths | Limitations | How we differ |
                    | --- | --- | --- | --- | --- |
                    | [Author et al., Year] | [Method] | [...] | [...] | [...] |
                    """, "Keep the BibTeX file in References and cite by key."),
            ]),
            section("Research Gap", "State precisely what is missing in the state of the art.", subs=[
                md("Gap", "_One paragraph: despite [prior work], no approach [does X] under [conditions Y]._"),
            ]),
        ]),
        section("Proposed Approach", "Describe the method so that it could be reimplemented from the paper alone.", children=[
            section("Overview", "Give the big picture of the approach before the details.", subs=[
                mermaid("Method pipeline", """
                    flowchart LR
                      data[(Input data)] --> pre[Preprocessing]
                      pre --> model[Proposed model]
                      model --> post[Post-processing]
                      post --> out[/Output/]
                    """),
            ]),
            section("Formalisation", "Define the problem and the method formally.", subs=[
                md("Problem definition", "_Given [inputs], find [outputs] that minimise/maximise [objective], subject to [constraints]._"),
                eq("Objective function", r"\theta^{*} = \arg\min_{\theta} \; \frac{1}{N}\sum_{i=1}^{N} \mathcal{L}\big(f_{\theta}(x_i), y_i\big) + \lambda \, \Omega(\theta)", "Replace with the actual formulation and define every symbol."),
            ]),
            section("Algorithm", "Present the algorithm and its complexity.", subs=[
                code("Algorithm sketch", "python", """
                    def proposed_method(data, params):
                        \"\"\"Replace with pseudocode or a minimal reference implementation.\"\"\"
                        model = initialise(params)
                        for epoch in range(params.epochs):
                            for batch in data:
                                loss = model.loss(batch)
                                model.update(loss)
                        return model
                    """),
                md("Complexity", "_Time and space complexity, with respect to [n, d, …]._"),
            ]),
        ]),
        section("Experimental Design", "Plan experiments that answer each research question convincingly and reproducibly.", children=[
            section("Hypotheses", "State the testable hypotheses linked to the research questions.", subs=[
                md("Hypotheses", """
                    | Hypothesis | Related RQ | Experiment | Supported if |
                    | --- | --- | --- | --- |
                    | H1: [statement] | RQ1 | [Exp. 1] | [e.g. significant improvement, p < 0.05] |
                    """),
            ]),
            section("Datasets and Setup", "Describe data, splits and the experimental environment.", subs=[
                md("Datasets", """
                    | Dataset | Size | Task | Split | Source / license |
                    | --- | --- | --- | --- | --- |
                    | [Name] | [N samples] | [Classification] | [70/15/15] | [URL, CC-BY] |
                    """),
            ]),
            section("Baselines", "Choose the methods to compare against and justify the choice.", subs=[
                md("Baselines", "- **[Baseline 1]** — [why it is a fair comparison]\n- **[Baseline 2]** — [state-of-the-art method]"),
            ]),
            section("Evaluation Metrics", "Define how success is measured and why these metrics are appropriate.", subs=[
                eq("Main metric", r"F_1 = 2 \cdot \frac{\text{precision} \cdot \text{recall}}{\text{precision} + \text{recall}}"),
                md("Metrics and statistics", "_Metrics, number of runs/seeds, confidence intervals and statistical tests used._"),
            ]),
            section("Reproducibility", "Give everything needed to reproduce the results.", subs=[
                md("Implementation details", """
                    - **Hardware:** [GPU/CPU, memory]
                    - **Software:** [framework and versions]
                    - **Hyper-parameters:** [values and how they were selected]
                    - **Code and data:** [repository URL, DOI]
                    """),
            ]),
        ]),
        section("Results", "Report the findings objectively, organised by research question.", children=[
            section("Main Results", "Answer the main research questions with the key tables and figures.", subs=[
                md("Main comparison", """
                    | Method | Metric 1 ↑ | Metric 2 ↓ | Runtime |
                    | --- | --- | --- | --- |
                    | Baseline 1 | … | … | … |
                    | **Ours** | **…** | **…** | … |
                    """),
            ]),
            section("Ablation Study", "Show the contribution of each component of the approach.", subs=[
                md("Ablations", "| Variant | Metric 1 | Δ vs full |\n| --- | --- | --- |\n| Full model | … | — |\n| w/o [component] | … | … |"),
            ]),
            section("Further Analysis", "Explore sensitivity, qualitative examples and failure cases.", subs=[
                md("Analysis", "_Sensitivity to hyper-parameters, qualitative examples, error analysis._"),
            ]),
        ]),
        section("Discussion", "Interpret the results, their implications and their limits.", children=[
            section("Interpretation and Implications", "Explain what the results mean for the research questions and the field.", subs=[
                md("Discussion", "_For each RQ: answer, evidence, and what it implies._"),
            ]),
            section("Limitations and Threats to Validity", "Discuss internal, external and construct validity honestly.", subs=[
                md("Threats", "- **Internal:** [...]\n- **External:** [...]\n- **Construct:** [...]"),
            ]),
        ]),
        section("Conclusion and Future Work", "Close with the take-away message and the next steps.", subs=[
            md("Conclusion", "_Restate the problem, the contribution and the main results in one paragraph; then two or three concrete future directions._"),
        ]),
        section("Data and Code Availability", "State where data, code and other artifacts can be found.", subs=[
            md("Artifacts", "- Code: [URL]\n- Data: [URL / DOI]\n- License: [...]\n\n_Keep the bibliography (.bib) and related papers in References._"),
        ]),
    ],
}

# ---------------------------------------------------------------- 3. Research proposal

PROPOSAL = {
    "name": "Research Project Proposal",
    "description": "Collaborative research proposal, simplified from the Horizon Europe structure: excellence, impact, implementation.",
    "sections": [
        section("Project Summary", "Give evaluators the essence of the project on one page.", subs=[
            md("Project identity", """
                | Field | Value |
                | --- | --- |
                | Acronym | [ACRONYM] |
                | Full title | [Title] |
                | Duration | [36 months] |
                | Budget requested | [€ …] |
                | Keywords | [k1, k2, k3] |
                """),
            md("Abstract", """
                _Max 2000 characters: challenge, objectives, approach, expected impact._
                """, "Written last; must stand alone for reviewers who read nothing else."),
        ]),
        section("Introduction", "Frame the challenge the project addresses and why it must be tackled now.", children=[
            section("Challenge and Context", "Describe the societal, scientific or industrial challenge and its relevance to the call.", subs=[
                md("Challenge", "_Evidence of the problem (figures, policy documents), link to the call topic and expected outcomes._"),
            ]),
            section("Project Vision", "State in a few lines what the world looks like if the project succeeds.", subs=[
                md("Vision", "_By the end of the project, [who] will be able to [what], thanks to [key result]._"),
            ]),
        ]),
        section("Excellence", "Show that the objectives are clear and ambitious and that the methodology is sound.", children=[
            section("Objectives", "Define specific, measurable, achievable, relevant and time-bound (SMART) objectives.", subs=[
                md("Specific objectives", """
                    | ID | Objective | Measurable indicator | Target | Month |
                    | --- | --- | --- | --- | --- |
                    | O1 | [Develop …] | [Accuracy / TRL / users] | [value] | M18 |
                    | O2 | [Validate …] | [...] | [...] | M30 |
                    | O3 | [Demonstrate …] | [...] | [...] | M36 |
                    """, "Every objective must map to work packages and deliverables."),
            ]),
            section("State of the Art and Beyond", "Summarise the state of the art and explain how the project advances beyond it.", subs=[
                md("Progress beyond the state of the art", """
                    | Area | State of the art | Limitations | Our advance |
                    | --- | --- | --- | --- |
                    | [Area 1] | [Best existing approaches, cited] | [Gap] | [What the project brings] |
                    """),
                md("Technology Readiness", "_Starting TRL [x] → target TRL [y], with justification._"),
            ]),
            section("Methodology", "Describe the concept, the approach and how the work is organised to reach the objectives.", subs=[
                mermaid("Concept", """
                    flowchart LR
                      req[Requirements and use cases] --> res[Research and development]
                      res --> int[Integration]
                      int --> pil[Pilots and validation]
                      pil -->|feedback| res
                      pil --> exp[Exploitation]
                    """),
                md("Approach", "_Methods, models, data, and how interdisciplinary expertise is combined. Explain alternatives and fallback strategies._"),
            ]),
            section("Open Science Practices", "Explain how results, data and software will be shared openly and reproducibly.", subs=[
                md("Open science", "- Open access publications: [route]\n- Research data management: [FAIR principles, repositories]\n- Open-source software: [licenses]"),
            ]),
        ]),
        section("Impact", "Convince evaluators that results will lead to outcomes and wider impacts, and how they will reach users.", children=[
            section("Pathways to Impact", "Link project outputs to expected outcomes and long-term impacts.", subs=[
                mermaid("Impact pathway", """
                    flowchart LR
                      out[Outputs: tools, datasets, publications] --> outc[Outcomes: adoption by target groups]
                      outc --> imp[Impacts: societal, economic, scientific]
                    """),
                md("Expected impacts", """
                    | Expected outcome (call) | Project contribution | Indicator | Target |
                    | --- | --- | --- | --- |
                    | [Outcome from the call text] | [How we contribute] | [KPI] | [value] |
                    """),
            ]),
            section("Target Groups and Stakeholders", "Identify who will use or benefit from the results and how they are involved.", subs=[
                md("Stakeholders", "| Group | Interest | Involvement in the project |\n| --- | --- | --- |\n| [Industry] | [...] | [Advisory board, pilots] |"),
            ]),
            section("Dissemination, Exploitation and Communication", "Plan how results are spread, exploited and communicated to the public.", subs=[
                md("DEC plan", """
                    | Measure | Target audience | Channel | KPI |
                    | --- | --- | --- | --- |
                    | Dissemination | Scientific community | Journals, conferences | [N papers] |
                    | Exploitation | Industry | Licensing, spin-off | [N agreements] |
                    | Communication | General public | Website, social media | [N visitors] |
                    """),
            ]),
        ]),
        section("Implementation", "Show that the work plan, resources and team are credible and well organised.", children=[
            section("Work Plan and Work Packages", "Break the project into work packages with clear leaders and objectives.", subs=[
                md("Work packages", """
                    | WP | Title | Lead | Start | End | Objectives |
                    | --- | --- | --- | --- | --- | --- |
                    | WP1 | Project management | [P1] | M1 | M36 | — |
                    | WP2 | [Research line A] | [P2] | M1 | M24 | O1 |
                    | WP3 | [Integration and pilots] | [P3] | M12 | M33 | O2 |
                    | WP4 | Dissemination and exploitation | [P1] | M1 | M36 | O3 |
                    """),
            ]),
            section("Timeline", "Visualise the schedule of work packages and milestones.", subs=[
                mermaid("Gantt chart", """
                    gantt
                      title Project timeline
                      dateFormat YYYY-MM-DD
                      section Management
                        WP1 Management :wp1, 2027-01-01, 1095d
                      section Research
                        WP2 Research line A :wp2, 2027-01-01, 730d
                        WP3 Integration and pilots :wp3, 2027-12-01, 640d
                      section Impact
                        WP4 Dissemination :wp4, 2027-01-01, 1095d
                    """),
            ]),
            section("Deliverables and Milestones", "List the tangible outputs and control points of the project.", subs=[
                md("Deliverables", "| No. | Deliverable | WP | Type | Dissemination | Month |\n| --- | --- | --- | --- | --- | --- |\n| D2.1 | [Report on …] | WP2 | Report | Public | M12 |"),
                md("Milestones", "| No. | Milestone | WPs | Month | Means of verification |\n| --- | --- | --- | --- | --- |\n| MS1 | [First prototype] | WP2 | M12 | [D2.1 accepted] |"),
            ]),
            section("Team and Consortium", "Show that the partners have complementary expertise and clear roles.", subs=[
                md("Partners", "| Partner | Country | Expertise | Role in the project |\n| --- | --- | --- | --- |\n| [University A] | [IT] | [...] | Coordinator, WP2 lead |"),
            ]),
            section("Risk Management", "Identify critical risks and mitigation measures.", subs=[
                md("Critical risks", "| Risk | Likelihood | Severity | WPs | Mitigation |\n| --- | --- | --- | --- | --- |\n| [Data not available on time] | Medium | High | WP2 | [Synthetic data fallback] |"),
            ]),
            section("Resources and Budget", "Justify the effort and costs requested.", subs=[
                md("Effort and costs", "| Partner | Person-months | Personnel (€) | Equipment (€) | Other (€) | Total (€) |\n| --- | --- | --- | --- | --- | --- |\n| [P1] | [..] | [..] | [..] | [..] | [..] |"),
            ]),
        ]),
        section("Ethics and Data Management", "Address ethical issues and how data are managed during and after the project.", subs=[
            md("Ethics self-assessment", "_Human participants, personal data (GDPR), dual use, AI ethics — and the measures taken._"),
            md("Data management plan", "_Types of data, formats, storage, sharing (FAIR), retention._"),
        ]),
    ],
}

# ---------------------------------------------------------------- 4. Thesis

THESIS = {
    "name": "Thesis",
    "description": "Bachelor/Master/PhD thesis: introduction, state of the art, contribution and architecture, implementation, experimental evaluation, conclusions.",
    "sections": [
        section("Abstract", "Summarise problem, contribution, method and main results in one page.", subs=[
            md("Abstract", "_Context and problem → goal of the thesis → approach → main results → significance. Write it last._"),
        ]),
        section("Introduction", "Introduce the problem, motivate it and state goals and contributions of the thesis.", children=[
            section("Context", "Describe the domain in which the thesis is set.", subs=[
                md("Context", "_The application domain and the technological/scientific landscape, from general to specific._"),
            ]),
            section("Motivation and Problem Statement", "Explain why the problem matters and define it precisely.", subs=[
                md("Problem statement", "_What is the problem, who is affected, why existing solutions are not enough._"),
                md("Research questions / goals", "- **RQ1 / G1:** [...]\n- **RQ2 / G2:** [...]", "Each question/goal must be answered in the evaluation and conclusions."),
            ]),
            section("Contributions", "List the original contributions of the thesis.", subs=[
                md("Contributions", "1. [Design of …]\n2. [Implementation of …]\n3. [Experimental evaluation showing …]"),
            ]),
            section("Thesis Structure", "Give a roadmap of the chapters.", subs=[
                md("Structure", "Chapter 2 presents the state of the art. Chapter 3 describes the proposed contribution and its architecture. Chapter 4 details the implementation. Chapter 5 reports the experimental evaluation. Chapter 6 concludes and outlines future developments."),
            ]),
        ]),
        section("State of the Art", "Provide the background and critically review existing work related to the problem.", children=[
            section("Background", "Introduce the concepts, technologies and terminology needed to follow the thesis.", subs=[
                md("Background concepts", "_Definitions, models, standards and technologies used later._"),
            ]),
            section("Related Work", "Review existing approaches, grouped by theme.", subs=[
                md("Related approaches", "_One subsection per research line: summary, strengths, limitations._"),
                md("Comparison", "| Approach | Feature A | Feature B | Limitation |\n| --- | --- | --- | --- |\n| [Work 1] | ✓ | ✗ | [...] |\n| **This thesis** | ✓ | ✓ | — |", "Makes the gap explicit and motivates the contribution."),
            ]),
            section("Open Challenges", "Summarise the gaps that the thesis addresses.", subs=[
                md("Gaps", "- [Gap 1 → addressed in Chapter 3]\n- [Gap 2 → addressed in Chapter 5]"),
            ]),
        ]),
        section("The Contribution / Architecture", "Present the proposed solution at the conceptual and architectural level.", children=[
            section("Requirements", "Derive the requirements the solution must satisfy.", subs=[
                md("Requirements", "| ID | Requirement | Type | Source |\n| --- | --- | --- | --- |\n| R1 | [...] | Functional | [Gap / use case] |\n| R2 | [...] | Non-functional | [...] |"),
            ]),
            section("Architecture Overview", "Describe the overall architecture and its main components.", subs=[
                mermaid("Architecture", """
                    flowchart TB
                      subgraph Proposed system
                        in[Input layer] --> core[Core component]
                        core --> store[(Storage)]
                        core --> out[Output / API]
                      end
                      ext[External systems] --> in
                    """),
                md("Components", "| Component | Responsibility | Requirements covered |\n| --- | --- | --- |\n| [Core component] | [...] | R1, R2 |"),
            ]),
            section("Design Decisions", "Justify the key design choices against alternatives.", subs=[
                md("Decisions", "_For each decision: alternatives considered, criteria, choice and consequences._"),
            ]),
        ]),
        section("Implementation", "Explain how the architecture was realised in practice.", children=[
            section("Technologies and Tools", "List and justify the technologies used.", subs=[
                md("Technology stack", "| Layer | Technology | Version | Why |\n| --- | --- | --- | --- |\n| [Backend] | [...] | [...] | [...] |"),
            ]),
            section("Key Modules", "Describe the most relevant parts of the implementation.", subs=[
                code("Key code excerpt", "python", """
                    # Replace with a short, significant excerpt (not whole files).
                    def core_algorithm(data):
                        ...
                    """, "Only code that helps understanding; full code goes in the repository."),
                md("Module description", "_Responsibilities, main data structures and interactions of each key module._"),
            ]),
            section("Implementation Challenges", "Discuss the difficulties met and how they were solved.", subs=[
                md("Challenges", "- **[Challenge]:** [solution adopted]"),
            ]),
        ]),
        section("Experimental Evaluation", "Assess the contribution against the research questions with a rigorous methodology.", children=[
            section("Evaluation Goals and Methodology", "Define what is evaluated and how.", subs=[
                md("Methodology", "| Research question | Experiment | Metric | Expected outcome |\n| --- | --- | --- | --- |\n| RQ1 | [Exp. 1] | [...] | [...] |"),
            ]),
            section("Experimental Setup", "Describe the environment, datasets and parameters to allow reproduction.", subs=[
                md("Setup", "- **Hardware / environment:** [...]\n- **Datasets / workloads:** [...]\n- **Baselines:** [...]\n- **Parameters:** [...]"),
            ]),
            section("Results", "Present the results for each research question.", subs=[
                md("Results", "| Configuration | Metric 1 | Metric 2 |\n| --- | --- | --- |\n| Baseline | … | … |\n| Proposed | … | … |"),
            ]),
            section("Discussion", "Interpret results, including limitations and threats to validity.", subs=[
                md("Discussion", "_What the results show for each RQ, unexpected findings, limitations._"),
            ]),
        ]),
        section("Conclusions and Future Developments", "Close the thesis by summarising results and indicating next steps.", children=[
            section("Summary of Contributions", "Recap the work and answer the research questions explicitly.", subs=[
                md("Conclusions", "_Problem → contribution → results, and an explicit answer to each RQ._"),
            ]),
            section("Limitations", "Acknowledge the limitations of the work.", subs=[md("Limitations", "- [Limitation and its consequence]")]),
            section("Future Developments", "Propose concrete directions for future work.", subs=[md("Future work", "- [Direction 1: what, why, how]")]),
        ]),
    ],
}

TEMPLATES = [SOFTWARE, PAPER, PROPOSAL, THESIS]
# Former templates replaced by a new one (deleted with --replace).
RETIRED = {"software-design-document": "software-project"}


def slug(name):
    import re
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def create_sections(tid, sections, parent=None, counts=None):
    for s in sections:
        block = call("POST", f"/api/templates/{tid}/blocks", {"title": s["title"], "parentId": parent})
        if s["objective"]:
            call("PATCH", f"/api/templates/{tid}/blocks/{block['id']}", {"objective": s["objective"]})
        counts["sections"] += 1
        for sub in s["subs"]:
            body = {k: v for k, v in sub.items() if v is not None}
            call("POST", f"/api/templates/{tid}/blocks/{block['id']}/subblocks", body)
            counts["subblocks"] += 1
        create_sections(tid, s["children"], block["id"], counts)


def main():
    global API, TOKEN
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default=API)
    ap.add_argument("--replace", action="store_true", help="delete and recreate templates that already exist")
    ap.add_argument("--only", nargs="+", metavar="ID", help="only these template ids")
    ap.add_argument("--token", default=TOKEN, help="access token (default: $SOURCEBOOK_TOKEN)")
    args = ap.parse_args()
    API = args.api.rstrip("/")
    TOKEN = args.token
    if not TOKEN:
        raise SystemExit("An access token is required: --token sbu_… or SOURCEBOOK_TOKEN (Settings → My agents)")
    existing = {t["id"] for t in call("GET", "/api/templates")}
    if args.replace:
        for old, new in RETIRED.items():
            if old in existing and (not args.only or new in args.only):
                call("DELETE", f"/api/templates/{old}")
                print(f"delete {old} (replaced by {new})")
    for spec in TEMPLATES:
        tid = slug(spec["name"])
        if args.only and tid not in args.only:
            continue
        if tid in existing:
            if not args.replace:
                print(f"skip   {tid} (exists; use --replace)")
                continue
            call("DELETE", f"/api/templates/{tid}")
        created = call("POST", "/api/templates", {"name": spec["name"], "description": spec["description"]})
        counts = {"sections": 0, "subblocks": 0}
        create_sections(created["id"], spec["sections"], None, counts)
        print(f"create {created['id']}: {counts['sections']} sections, {counts['subblocks']} sub-blocks")


if __name__ == "__main__":
    sys.exit(main())
