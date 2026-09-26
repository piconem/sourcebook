/** Mermaid diagram kinds offered by the type picker, each with a starter example. */
export interface MermaidKind {
  id: string;
  label: string;
  description: string;
  /** Matches the diagram declaration on the first meaningful line. */
  detect: RegExp;
  template: string;
}

export const MERMAID_KINDS: MermaidKind[] = [
  {
    id: "flowchart",
    label: "Flowchart",
    description: "Processes, decisions and data flow",
    detect: /^(flowchart|graph)\b/,
    template: `flowchart LR
  A[Request] --> B{Valid?}
  B -- yes --> C[Process]
  B -- no --> D[Reject]
  C --> E[(Store)]
`,
  },
  {
    id: "sequence",
    label: "Sequence",
    description: "Messages between participants over time",
    detect: /^sequenceDiagram\b/,
    template: `sequenceDiagram
  actor User
  participant Client
  participant Server
  User->>Client: Edit block
  Client->>Server: PATCH /api/blocks/:id
  Server-->>Client: 200 OK
  Client-->>User: Saved
`,
  },
  {
    id: "class",
    label: "Class",
    description: "Classes, attributes and relationships",
    detect: /^classDiagram\b/,
    template: `classDiagram
  class Block {
    +string id
    +string title
    +addSubBlock(type)
  }
  class SubBlock {
    +string id
    +string type
  }
  Block "1" *-- "many" SubBlock : contains
`,
  },
  {
    id: "state",
    label: "State",
    description: "States and transitions of a system",
    detect: /^stateDiagram(-v2)?\b/,
    template: `stateDiagram-v2
  [*] --> Draft
  Draft --> Review : submit
  Review --> Draft : request changes
  Review --> Published : approve
  Published --> [*]
`,
  },
  {
    id: "er",
    label: "Entity relationship",
    description: "Data model entities and cardinalities",
    detect: /^erDiagram\b/,
    template: `erDiagram
  PROJECT ||--o{ BLOCK : contains
  BLOCK ||--o{ SUBBLOCK : contains
  BLOCK {
    string id PK
    string title
  }
  SUBBLOCK {
    string id PK
    string type
  }
`,
  },
  {
    id: "journey",
    label: "User journey",
    description: "Steps and satisfaction of a user task",
    detect: /^journey\b/,
    template: `journey
  title Writing a design document
  section Draft
    Create sections: 5: Author
    Add diagrams: 3: Author
  section Review
    Read document: 4: Reviewer
    Leave comments: 3: Reviewer
`,
  },
  {
    id: "gantt",
    label: "Gantt",
    description: "Project schedule and task dependencies",
    detect: /^gantt\b/,
    template: `gantt
  title Release plan
  dateFormat YYYY-MM-DD
  section Backend
    API design      :a1, 2026-01-05, 7d
    Implementation  :a2, after a1, 14d
  section Frontend
    UI prototype    :b1, 2026-01-12, 10d
    Integration     :after a2, 5d
`,
  },
  {
    id: "pie",
    label: "Pie chart",
    description: "Proportions of a whole",
    detect: /^pie\b/,
    template: `pie title Time spent
  "Design" : 35
  "Implementation" : 45
  "Testing" : 20
`,
  },
  {
    id: "quadrant",
    label: "Quadrant chart",
    description: "Items placed on two axes",
    detect: /^quadrantChart\b/,
    template: `quadrantChart
  title Feature prioritization
  x-axis Low effort --> High effort
  y-axis Low value --> High value
  quadrant-1 Plan
  quadrant-2 Do now
  quadrant-3 Skip
  quadrant-4 Maybe
  Export ZIP: [0.3, 0.8]
  Dark mode: [0.6, 0.4]
  Sync: [0.85, 0.7]
`,
  },
  {
    id: "requirement",
    label: "Requirement",
    description: "Requirements and what satisfies them",
    detect: /^requirementDiagram\b/,
    template: `requirementDiagram
  requirement persistence {
    id: 1
    text: Content is stored as Markdown files
    risk: low
    verifymethod: test
  }
  element store {
    type: module
  }
  store - satisfies -> persistence
`,
  },
  {
    id: "git",
    label: "Git graph",
    description: "Branches, commits and merges",
    detect: /^gitGraph\b/,
    template: `gitGraph
  commit
  branch feature
  checkout feature
  commit
  commit
  checkout main
  merge feature
  commit
`,
  },
  {
    id: "mindmap",
    label: "Mind map",
    description: "Hierarchical ideas around a topic",
    detect: /^mindmap\b/,
    template: `mindmap
  root((Sourcebook))
    Blocks
      Nesting
      Ordering
    Sub-blocks
      Markdown
      Diagrams
      Code
`,
  },
  {
    id: "timeline",
    label: "Timeline",
    description: "Events in chronological order",
    detect: /^timeline\b/,
    template: `timeline
  title Project history
  2026 Q1 : Idea : First prototype
  2026 Q2 : REST API
  2026 Q3 : Editors : Export
`,
  },
  {
    id: "sankey",
    label: "Sankey",
    description: "Flows and their magnitudes",
    detect: /^sankey(-beta)?\b/,
    template: `sankey-beta

Budget,Design,30
Budget,Development,50
Budget,Testing,20
Development,Backend,30
Development,Frontend,20
`,
  },
  {
    id: "xychart",
    label: "XY chart",
    description: "Bar and line charts",
    detect: /^xychart(-beta)?\b/,
    template: `xychart-beta
  title "Blocks written per month"
  x-axis [Jan, Feb, Mar, Apr]
  y-axis "Blocks" 0 --> 50
  bar [12, 20, 34, 41]
  line [12, 20, 34, 41]
`,
  },
  {
    id: "block",
    label: "Block",
    description: "Blocks laid out on a grid",
    detect: /^block(-beta)?\b/,
    template: `block-beta
  columns 3
  client["Client"] space server["Server"]
  client --> server
  space:2 disk[("Files")]
  server --> disk
`,
  },
  {
    id: "packet",
    label: "Packet",
    description: "Bit layout of a data structure",
    detect: /^packet(-beta)?\b/,
    template: `packet-beta
  0-15: "Source port"
  16-31: "Destination port"
  32-63: "Sequence number"
`,
  },
  {
    id: "kanban",
    label: "Kanban",
    description: "Tasks grouped by status",
    detect: /^kanban\b/,
    template: `kanban
  todo[To do]
    t1[Write introduction]
  doing[In progress]
    t2[Architecture diagram]
  done[Done]
    t3[Project outline]
`,
  },
  {
    id: "architecture",
    label: "Architecture",
    description: "Services and infrastructure",
    detect: /^architecture(-beta)?\b/,
    template: `architecture-beta
  group app(cloud)[Local app]
  service client(internet)[Browser] in app
  service api(server)[API] in app
  service files(disk)[Project files] in app
  client:R --> L:api
  api:R --> L:files
`,
  },
  {
    id: "c4",
    label: "C4 context",
    description: "System context (C4 model)",
    detect: /^C4(Context|Container|Component|Dynamic|Deployment)\b/,
    template: `C4Context
  title Sourcebook – system context
  Person(author, "Author", "Writes design documents")
  System(sourcebook, "Sourcebook", "Block-based Markdown notebook")
  System_Ext(agent, "Coding agent", "Implements what is described")
  Rel(author, sourcebook, "Authors content")
  Rel(agent, sourcebook, "Reads Markdown")
`,
  },
];

/** First line that is not blank, a %% comment, or part of a --- front-matter block. */
function declaration(code: string): string {
  const lines = code.split("\n");
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = lines.findIndex((l, j) => j > 0 && l.trim() === "---") + 1;
  }
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l && !l.startsWith("%%")) return l;
  }
  return "";
}

export function detectKind(code: string): MermaidKind | undefined {
  const decl = declaration(code);
  return decl ? MERMAID_KINDS.find((k) => k.detect.test(decl)) : undefined;
}

/** True when switching away would discard real work (not empty, not an untouched template). */
export function hasUserWork(code: string): boolean {
  const trimmed = code.trim();
  return trimmed !== "" && !MERMAID_KINDS.some((k) => k.template.trim() === trimmed);
}
