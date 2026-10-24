import type { CreateSubBlockBody, Registry, SubBlockTypeCore } from "@sourcebook/shared";
import { BibliographyStore } from "../store/BibliographyStore.js";
import { NotebookStore } from "../store/NotebookStore.js";
import { ReferencesStore } from "../store/ReferencesStore.js";

/**
 * "Sourcebook Demo": a template that shows every sub-block type and the main features, seeded into new
 * workspaces (see seedTemplates.ts) so a new installation has something to start from. Built through the
 * stores, so every sub-block is validated like one created from the editor.
 */
export const DEMO_TEMPLATE = {
  id: "sourcebook-demo",
  name: "Sourcebook Demo",
  description: "A tour of Sourcebook: every block type (Markdown, Mermaid, drawing, equation, code, image, CSV data, question, multiple choice), references, bibliography, comments and the AI assistant. Start a project from it and try everything.",
};

interface Section {
  title: string;
  objective?: string;
  subs: CreateSubBlockBody[];
  children?: Section[];
  references?: string[];
}

const t = (s: string) => {
  const lines = s.replace(/^\n/, "").split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return lines.map((l) => l.slice(indent)).join("\n").trimEnd() + "\n";
};
const md = (title: string, markdown: string, objective?: string): CreateSubBlockBody => ({ type: "markdown", title, objective, content: { markdown: t(markdown) } });

const REF_NOTES = "demo/meeting-notes.md";
const REF_GUIDE = "demo/style-guide.md";
const BIB_KEY = "knuth1984literate";

const STRUCTURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300" viewBox="0 0 640 300" font-family="Helvetica, Arial, sans-serif">
  <rect width="640" height="300" fill="#f8fafc"/>
  <rect x="24" y="24" width="592" height="252" rx="14" fill="#ffffff" stroke="#334155" stroke-width="2"/>
  <text x="44" y="56" font-size="20" font-weight="bold" fill="#0f172a">Project</text>
  <g>
    <rect x="44" y="76" width="260" height="180" rx="10" fill="#e0f2fe" stroke="#0284c7" stroke-width="2"/>
    <text x="60" y="104" font-size="16" font-weight="bold" fill="#075985">§1 Section</text>
    <rect x="60" y="118" width="228" height="34" rx="6" fill="#ffffff" stroke="#0284c7"/>
    <text x="72" y="140" font-size="14" fill="#0f172a">#1 Markdown</text>
    <rect x="60" y="160" width="228" height="34" rx="6" fill="#ffffff" stroke="#0284c7"/>
    <text x="72" y="182" font-size="14" fill="#0f172a">#2 Mermaid diagram</text>
    <rect x="60" y="202" width="228" height="34" rx="6" fill="#ffffff" stroke="#0284c7"/>
    <text x="72" y="224" font-size="14" fill="#0f172a">#3 CSV data</text>
  </g>
  <g>
    <rect x="336" y="76" width="260" height="180" rx="10" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/>
    <text x="352" y="104" font-size="16" font-weight="bold" fill="#166534">§2 Section</text>
    <rect x="352" y="118" width="228" height="34" rx="6" fill="#ffffff" stroke="#16a34a"/>
    <text x="364" y="140" font-size="14" fill="#0f172a">#1 Question</text>
    <rect x="352" y="160" width="228" height="80" rx="8" fill="#f0fdf4" stroke="#16a34a" stroke-dasharray="5 4"/>
    <text x="364" y="184" font-size="14" font-weight="bold" fill="#166534">§2.1 Subsection</text>
    <rect x="364" y="194" width="204" height="34" rx="6" fill="#ffffff" stroke="#16a34a"/>
    <text x="376" y="216" font-size="14" fill="#0f172a">#1 Code</text>
  </g>
</svg>
`;

/** An Excalidraw element with the fields Excalidraw itself writes. */
function shape(i: number, type: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}) {
  return {
    id: `demo-${type}-${i}`,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: `a${i.toString(36)}`,
    roundness: type === "rectangle" ? { type: 3 } : type === "text" ? null : { type: 2 },
    seed: 1000 + i,
    version: 1,
    versionNonce: 2000 + i,
    isDeleted: false,
    boundElements: [],
    updated: 1792800000000,
    link: null,
    locked: false,
    ...extra,
  };
}
const text = (i: number, x: number, y: number, value: string, fontSize = 20) =>
  shape(i, "text", x, y, value.length * fontSize * 0.55, fontSize * 1.25, {
    text: value,
    originalText: value,
    fontSize,
    fontFamily: 5,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  });
const arrow = (i: number, x: number, y: number, dx: number) =>
  shape(i, "arrow", x, y, dx, 0, { points: [[0, 0], [dx, 0]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow", elbowed: false });

const DRAWING = {
  type: "excalidraw",
  version: 2,
  elements: [
    shape(1, "rectangle", 0, 0, 180, 90, { backgroundColor: "#ffec99" }),
    text(2, 52, 32, "Idea"),
    arrow(3, 200, 45, 100),
    shape(4, "rectangle", 320, 0, 180, 90, { backgroundColor: "#a5d8ff" }),
    text(5, 370, 32, "Draft"),
    arrow(6, 520, 45, 100),
    shape(7, "ellipse", 640, -5, 180, 100, { backgroundColor: "#b2f2bb" }),
    text(8, 690, 32, "Review"),
    text(9, 250, 130, "Sketch freely: shapes, arrows, text, images", 16),
  ],
  appState: { gridSize: 20, gridStep: 5, gridModeEnabled: false, viewBackgroundColor: "#ffffff" },
  files: {},
};

const DATASET = `experiment,model,dataset,accuracy,latency_ms,date,passed
E01,baseline,small,0.71,12,2026-09-01,no
E02,baseline,large,0.74,48,2026-09-01,no
E03,tuned,small,0.82,14,2026-09-08,yes
E04,tuned,large,0.85,51,2026-09-08,yes
E05,distilled,small,0.79,6,2026-09-15,yes
E06,distilled,large,0.81,22,2026-09-15,yes
E07,ensemble,small,0.86,40,2026-09-22,yes
E08,ensemble,large,0.88,165,2026-09-22,no
`;

const SECTIONS: Section[] = [
  {
    title: "Welcome",
    objective: "Explain what Sourcebook is, how a project is organised and how to use this demo.",
    subs: [
      md(
        "What is Sourcebook",
        `
        **Sourcebook** is a notebook made of **blocks**, written together by people and AI assistants. Each project is a
        tree of **sections** (§1, §2, §2.1 …); each section holds an ordered list of **sub-blocks** (§2#1, §2#2 …) of
        different types: text, diagrams, drawings, equations, code, images, data sets, questions and choices.

        Everything is stored as plain files in your workspace folder (Markdown, \`.mmd\`, \`.tex\`, \`.csv\` …), so a project
        stays readable and versionable outside the tool.

        ## How to use this demo

        1. Create a project from this template: on the Home page, right-click *Sourcebook Demo* among the templates and
           choose *New project from this template…*.
        2. Walk through the sections in the outline on the left: each one shows a kind of block and how to use it.
        3. Change anything, add sub-blocks with the **＋** between them, delete what you do not need.
        4. When you are done, start your real work from an empty project or from one of the other templates.

        Every section and sub-block can have an **objective** (the line under its title): what it must contain. It
        guides both you and the assistant.
        `,
        "A short introduction: what a project, a section and a sub-block are.",
      ),
      { type: "image", title: "How a project is organised", content: { src: "", alt: "A project with sections, subsections and sub-blocks", caption: "Sections contain sub-blocks and other sections." } },
      {
        type: "choice",
        title: "Your first steps",
        objective: "A checklist: tick the steps as you try them.",
        content: {
          question: "What have you tried so far?",
          mode: "multiple",
          options: [
            { id: "outline", text: "Moved and collapsed sections in the outline" },
            { id: "blocks", text: "Added a sub-block of each type" },
            { id: "comment", text: "Commented a sentence, a line of code or a CSV row" },
            { id: "references", text: "Uploaded a file to References and linked it" },
            { id: "assistant", text: "Connected an AI assistant (Settings → AI assistant)" },
            { id: "export", text: "Exported the project as Markdown" },
          ],
          selected: [],
          note: "Multiple-choice blocks work as checklists, polls or option comparisons.",
        },
      },
    ],
  },
  {
    title: "Writing with Markdown",
    objective: "Show rich text: formatting, lists, tables, links, citations and links to reference files.",
    references: [REF_GUIDE],
    subs: [
      md(
        "Formatting",
        `
        Markdown blocks are edited as rich text. Select some text to format it, or type Markdown directly:
        **bold**, *italic*, ~~strikethrough~~, \`inline code\` and [links](https://commonmark.org).

        ### Lists and quotes

        - Bullet lists
          - nested as deep as you need
        - Numbered lists:
          1. first
          2. second

        > Quotes are good for requirements, interview notes or definitions.

        ### Tables

        | Block type | Good for | Stored as |
        | --- | --- | --- |
        | Markdown | text, tables, lists | \`.md\` |
        | Mermaid | flowcharts, sequences, classes | \`.mmd\` |
        | Equation | LaTeX formulas | \`.tex\` |
        | CSV data | reference data sets | \`.csv\` |

        ### Code inside text

        \`\`\`bash
        echo "Short snippets can live inside Markdown; longer code goes in a Code block."
        \`\`\`
        `,
      ),
      md(
        "Citations and reference files",
        `
        Text can cite an entry of the project **Bibliography**: this is how literate programming was introduced
        [Knuth 1984](bib:${BIB_KEY}). Insert a citation with the ❝ Cite button of the toolbar; the Bibliography lists every entry and
        where it is cited, and exports BibTeX.

        It can also link files kept in **References** (top bar), the project's folder of documents, PDFs and data:
        see the [meeting notes](../../../references/${REF_NOTES}). This section also has a reference file *attached*
        as a whole (next to its title): the [style guide](../../../references/${REF_GUIDE}).
        `,
        "Cite a bibliography entry and link a reference file.",
      ),
    ],
    children: [
      {
        title: "Nested sections",
        objective: "Show that sections can be nested and reorganised.",
        subs: [
          md(
            "Moving things around",
            `
            This is §2.1, a section inside §2. In the outline on the left you can:

            - drag a section to move it, or drop it onto another one to nest it;
            - collapse a section to hide its subsections (▸);
            - reorder the sub-blocks of a section by dragging their handle.

            Numbers (§2.1#1) change when you move things; ids never do, so comments and links follow.
            `,
          ),
        ],
      },
    ],
  },
  {
    title: "Diagrams and drawings",
    objective: "Show Mermaid diagrams written as text and free-hand Excalidraw drawings.",
    subs: [
      {
        type: "mermaid",
        title: "Flowchart",
        objective: "Mermaid diagrams are written as text and rendered live.",
        content: {
          code: t(`
            flowchart LR
              idea([Idea]) --> draft[Draft in Sourcebook]
              draft --> review{Review}
              review -- comments --> draft
              review -- approved --> done[(Project files)]
              ai[[AI assistant]] -. MCP .-> draft
          `),
        },
      },
      {
        type: "mermaid",
        title: "Sequence diagram",
        content: {
          code: t(`
            sequenceDiagram
              actor You
              participant SB as Sourcebook
              participant AI as AI assistant
              You->>SB: write a section
              You->>AI: "review §3 and comment"
              AI->>SB: add_comment(§3#1:L4)
              SB-->>You: 🔔 notification
              You->>SB: reply and resolve
          `),
        },
      },
      { type: "drawing", title: "Sketch", objective: "Excalidraw: draw by hand, then export as PNG or SVG.", content: DRAWING },
    ],
  },
  {
    title: "Equations and code",
    objective: "Show LaTeX equations and source code with syntax highlighting.",
    subs: [
      { type: "equation", title: "Softmax", objective: "Equations are written in LaTeX and rendered with KaTeX.", content: { latex: "\\sigma(\\mathbf{z})_i = \\frac{e^{z_i}}{\\sum_{j=1}^{K} e^{z_j}} \\qquad i = 1, \\dots, K" } },
      { type: "equation", title: "Bayes' theorem", content: { latex: "P(A \\mid B) = \\frac{P(B \\mid A)\\, P(A)}{P(B)}" } },
      {
        type: "code",
        title: "TypeScript",
        objective: "Code blocks are saved as real source files (.ts, .py …); comments attach to lines.",
        content: {
          language: "typescript",
          code: t(`
            interface Experiment {
              id: string;
              accuracy: number;
              latencyMs: number;
            }

            /** Best experiment under a latency budget. */
            export function best(experiments: Experiment[], budgetMs: number): Experiment | undefined {
              return experiments
                .filter((e) => e.latencyMs <= budgetMs)
                .sort((a, b) => b.accuracy - a.accuracy)[0];
            }
          `),
        },
      },
      {
        type: "code",
        title: "Python",
        content: {
          language: "python",
          code: t(`
            import csv

            def best(path: str, budget_ms: float) -> dict | None:
                """Best experiment of the CSV data set under a latency budget."""
                with open(path, newline="") as f:
                    rows = [r for r in csv.DictReader(f) if float(r["latency_ms"]) <= budget_ms]
                return max(rows, key=lambda r: float(r["accuracy"]), default=None)
          `),
        },
      },
    ],
  },
  {
    title: "Data sets (CSV)",
    objective: "Show a reference data set to explore and discuss.",
    subs: [
      md(
        "Working with data",
        `
        A **CSV data** block keeps a data set inside the project. In the table you can sort by a column, filter rows,
        edit cells and column names and add or remove rows and columns. **Summary** shows, for each column, its type,
        empty cells, distinct values, min / max / mean and the most frequent values. **CSV** shows the raw text.

        Import a \`.csv\` / \`.tsv\` file from your computer or from References, and download it back. Select a row by its
        number to comment it or to ask the AI about it.
        `,
      ),
      { type: "csv", title: "experiments.csv", objective: "Results of the experiments (fictional data).", content: { csv: DATASET, delimiter: "," } },
    ],
  },
  {
    title: "Questions and decisions",
    objective: "Show question blocks (open questions with answers) and multiple-choice blocks (decisions, options).",
    subs: [
      { type: "question", title: "Answered question", content: { question: "Which experiment should we use in production?", answer: "E06 (distilled, large): 0.81 accuracy at 22 ms, within the 50 ms budget." } },
      { type: "question", title: "Open question", objective: "An open question: the answer is still empty.", content: { question: "Is the 50 ms latency budget per request or per batch?", answer: "" } },
      {
        type: "choice",
        title: "Decision",
        objective: "A single-choice block records a decision and why it was taken.",
        content: {
          question: "Where do we store the results?",
          mode: "single",
          options: [
            { id: "csv", text: "CSV files in the project" },
            { id: "db", text: "A database" },
            { id: "both", text: "Both: CSV for the reference set, database for the raw runs" },
          ],
          selected: ["both"],
          note: "The reference set must stay readable in the project; raw runs are too many for CSV.",
        },
      },
    ],
  },
  {
    title: "Working together",
    objective: "Explain comments, notifications, locks, permissions and the AI assistant.",
    subs: [
      md(
        "Comments, notifications and locks",
        `
        - **Comments**: select text (or lines of code, or CSV rows) and comment it. Threads have replies and can be
          resolved; the top bar lists every comment of the project.
        - **Notifications** 🔔: when someone (or an assistant) changes the project, the changed sections get a badge in
          the outline and on the block. A notification is cleared from the bell on the block or from the top bar.
        - **Locks** 🔒: take a sub-block before a long piece of work, so nobody else changes it; release it when done.
        - **People and permissions**: the owner adds users (Settings → Users) and gives them **read** (read and comment)
          or **write** access to each project (Settings → Project access).
        `,
      ),
    ],
    children: [
      {
        title: "AI assistant",
        objective: "How to connect an AI assistant and what to ask it.",
        subs: [
          md(
            "Connecting an assistant",
            `
            Sourcebook has an **MCP server**: AI assistants such as Claude Code read and write the project through it, and
            comment like any other participant. In *Settings → AI assistant* you find the ready-made command with your
            access token; each assistant then works under an **agent** identity of yours (*Settings → My agents*), shown
            as "Writer · for *your name*" in comments and notifications.

            Things to ask:

            - *"Read §2 and comment the unclear sentences."*
            - *"Summarise experiments.csv and propose which model to use."*
            - *"Draw a sequence diagram of the login flow in a new Mermaid block of §3."*
            `,
          ),
          {
            type: "code",
            title: "Command",
            objective: "Example: Claude Code. Copy the real command from Settings → AI assistant.",
            content: { language: "bash", code: t(`claude mcp add --transport http sourcebook http://127.0.0.1:4000/mcp --header "Authorization: Bearer <your access token>"`) },
          },
        ],
      },
    ],
  },
];

/** Writes the demo template into `dir` (an empty folder). */
export async function buildDemoTemplate(dir: string, registry: Registry<SubBlockTypeCore<any>>): Promise<void> {
  const store = await NotebookStore.open(dir, registry);
  const refs = new ReferencesStore(dir);
  await refs.save("demo", "meeting-notes.md", Buffer.from(t(`
    # Kick-off meeting

    - Goal: choose the model for production by the end of the month.
    - Latency budget: 50 ms.
    - Next step: run the distilled models on the large data set.
  `)));
  await refs.save("demo", "style-guide.md", Buffer.from(t(`
    # Style guide

    - One idea per sub-block; give it a title and an objective.
    - Prefer diagrams to long descriptions.
    - Keep open questions in question blocks until they are answered.
  `)));
  await new BibliographyStore(dir, store).create({
    key: BIB_KEY,
    type: "article",
    name: "Knuth 1984",
    authors: "Donald E. Knuth",
    year: "1984",
    venue: "The Computer Journal",
    title: "Literate Programming",
    doi: "10.1093/comjnl/27.2.97",
    url: "",
    abstract: "",
    description: "Programs written as documents for people, with the code woven in.",
    textCitation: "",
    bibtex: "",
    generate: true,
  });

  const add = async (sections: Section[], parentId: string | null) => {
    for (const s of sections) {
      const block = await store.createBlock({ title: s.title, parentId });
      if (s.objective) await store.updateBlock(block.id, { objective: s.objective });
      if (s.references) await store.setReferences(block.id, null, s.references);
      for (const sub of s.subs) {
        // An image points at an asset saved in its own section's folder.
        const content = sub.type === "image" ? { ...(sub.content as object), src: await store.saveAsset(block.id, "svg", Buffer.from(STRUCTURE_SVG)) } : sub.content;
        await store.addSubBlock(block.id, { ...sub, content });
      }
      await add(s.children ?? [], block.id);
    }
  };
  await add(SECTIONS, null);
}
