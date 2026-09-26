#!/usr/bin/env python3
"""
Creates example Sourcebook templates through the REST API:
  - Software Design Document
  - Scientific Paper
  - Research Project Proposal (simplified, inspired by EU Horizon Europe proposals)
  - Thesis

Usage:  python3 scripts/create-example-templates.py [--api http://127.0.0.1:4000] [--replace]
Existing templates with the same id are skipped, or deleted and recreated with --replace.
"""
import argparse
import json
import sys
import textwrap
import urllib.error
import urllib.request

API = "http://127.0.0.1:4000"


def call(method, path, body=None):
    req = urllib.request.Request(
        API + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"content-type": "application/json"} if body is not None else {},
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


def section(title, objective=None, subs=(), children=()):
    return {"title": title, "objective": objective, "subs": list(subs), "children": list(children)}


# ---------------------------------------------------------------- 1. Software design

SOFTWARE = {
    "name": "Software Design Document",
    "description": "Design of a software system: requirements, architecture, dependencies, design patterns, data structures, quality and operations.",
    "sections": [
        section("Overview", "Let a new reader understand in five minutes what the system is, who it is for and why it exists.", children=[
            section("Purpose and Scope", "State the problem the system solves and draw a clear boundary around what is (and is not) included.", subs=[
                md("Problem statement", """
                    _Describe the problem in two or three sentences, from the user's point of view. Avoid naming solutions here._

                    [Who has the problem] currently [does what / suffers what], which causes [cost, risk or pain].
                    """, "A problem statement that a stakeholder would recognise and agree with."),
                md("Scope", """
                    **In scope**

                    - [Capability 1]
                    - [Capability 2]

                    **Out of scope (for this version)**

                    - [Explicitly excluded capability, and why]
                    """),
            ]),
            section("Stakeholders and Users", "Identify who uses or is affected by the system and what success means for each of them.", subs=[
                md("Stakeholder map", """
                    | Stakeholder | Role | Needs | Success criteria |
                    | --- | --- | --- | --- |
                    | [End user] | [Uses the system to …] | [What they need] | [How they judge success] |
                    | [Operator] | [Runs the system] | [Monitoring, easy deploys] | [Incidents per month] |
                    | [Product owner] | [Funds and prioritises] | [Time to market] | [Adoption KPI] |
                    """),
            ]),
            section("Glossary", "Agree on the vocabulary: every domain term used in this document should be defined here once.", subs=[
                md("Terms", """
                    | Term | Definition |
                    | --- | --- |
                    | [Term] | [Definition in plain language] |
                    """),
            ]),
        ]),
        section("Requirements", "Capture what the system must do and how well it must do it, in a testable way.", children=[
            section("Functional Requirements", "List the behaviours the system must provide, each with a priority and an acceptance criterion.", subs=[
                md("Requirements table", """
                    _Use MoSCoW priorities (Must, Should, Could, Won't). Each acceptance criterion must be verifiable by a test._

                    | ID | Requirement | Priority | Acceptance criteria |
                    | --- | --- | --- | --- |
                    | FR-01 | The system shall [behaviour]. | Must | Given [context], when [action], then [result]. |
                    | FR-02 | The system shall [behaviour]. | Should | [Criterion] |
                    """),
            ]),
            section("Non-Functional Requirements", "Quantify the quality attributes (performance, availability, security, …) that drive the architecture.", subs=[
                md("Quality attributes", """
                    | Quality attribute | Scenario | Target |
                    | --- | --- | --- |
                    | Performance | [N] concurrent users call [operation] | p95 latency < [X] ms |
                    | Availability | Normal operation | ≥ 99.9% monthly |
                    | Security | [Threat or access scenario] | [Control, e.g. OAuth2 + RBAC] |
                    | Maintainability | A new developer adds [feature type] | < [N] days |
                    """),
            ]),
            section("Constraints and Assumptions", "Make explicit the decisions already imposed and the assumptions the design relies on.", subs=[
                md("Constraints", """
                    - **Technical:** [mandated language, platform, cloud provider, legacy system]
                    - **Organisational:** [team size, deadlines, budget]
                    - **Regulatory:** [GDPR, industry standards]

                    **Assumptions** (to be validated)

                    - [Assumption] — _validated by: [how / when]_
                    """),
            ]),
        ]),
        section("Architecture", "Describe the main building blocks, their responsibilities and how they interact.", children=[
            section("System Context", "Show the system as a black box with the people and external systems it talks to.", subs=[
                mermaid("Context diagram", """
                    flowchart LR
                      user([User]) -->|uses| system[System under design]
                      admin([Administrator]) -->|configures| system
                      system -->|reads/writes| db[(Database)]
                      system -->|calls| ext[External service]
                    """, "Every arrow is an interaction the design must support."),
            ]),
            section("Components", "Decompose the system into components with a single, clear responsibility each.", subs=[
                mermaid("Component diagram", """
                    flowchart TB
                      subgraph System
                        ui[Web UI] --> api[API layer]
                        api --> svc[Domain services]
                        svc --> repo[Repositories]
                      end
                      repo --> db[(Database)]
                      svc --> queue[[Message queue]]
                    """),
                md("Responsibilities", """
                    | Component | Responsibility | Exposes | Depends on |
                    | --- | --- | --- | --- |
                    | [API layer] | [Validation, authentication, routing] | [REST endpoints] | [Domain services] |
                    | [Domain services] | [Business rules] | [Service interfaces] | [Repositories, queue] |
                    """),
            ]),
            section("Key Interactions", "Walk through the most important or risky runtime scenarios step by step.", subs=[
                mermaid("Main scenario", """
                    sequenceDiagram
                      actor User
                      participant UI
                      participant API
                      participant Service
                      participant DB
                      User->>UI: Submit request
                      UI->>API: POST /resource
                      API->>Service: validate and execute
                      Service->>DB: persist
                      DB-->>Service: ok
                      Service-->>API: result
                      API-->>UI: 201 Created
                    """),
            ]),
            section("Architectural Decisions", "Record significant decisions with their context and consequences (lightweight ADRs).", subs=[
                md("ADR-001: [Decision title]", """
                    **Status:** Proposed | Accepted | Superseded

                    **Context.** [Forces at play: requirements, constraints, options considered]

                    **Decision.** [What was decided]

                    **Consequences.** [Positive and negative effects, follow-up work]
                    """),
            ]),
        ]),
        section("Dependencies", "Inventory what the system relies on, why, and the risks each dependency brings.", children=[
            section("Libraries and Frameworks", "Justify each third-party library and check its license and maintenance status.", subs=[
                md("Dependency inventory", """
                    | Name | Version | License | Purpose | Alternatives considered | Risk |
                    | --- | --- | --- | --- | --- | --- |
                    | [library] | [x.y] | [MIT] | [Why it is needed] | [Other options] | [Low / Medium / High] |
                    """),
            ]),
            section("External Services and APIs", "Describe the external systems the design integrates with, including limits and failure behaviour.", subs=[
                md("Integrations", """
                    | Service | Used for | Protocol / API | SLA / limits | Behaviour when unavailable |
                    | --- | --- | --- | --- | --- |
                    | [Payment provider] | [Charge cards] | [REST, OAuth2] | [99.95%, 100 req/s] | [Queue and retry, notify user] |
                    """),
            ]),
            section("Internal Dependencies", "Show dependencies between internal modules and on shared platform services.", subs=[
                md("Module dependencies", """
                    _List which internal modules depend on which, and any rule you enforce (e.g. "domain must not depend on infrastructure")._

                    - [module A] → [module B]: [reason]
                    """),
            ]),
        ]),
        section("Detailed Design", "Explain how the components are designed internally and which patterns shape them.", children=[
            section("Module Design", "Describe the internal structure of the most important modules.", subs=[
                md("Module structure", """
                    _For each key module: responsibilities, main classes/functions, and how it is tested._
                    """),
            ]),
            section("Design Patterns", "Document the patterns applied, where, and the trade-offs they introduce.", subs=[
                md("Patterns used", """
                    | Pattern | Where | Problem it solves | Trade-offs |
                    | --- | --- | --- | --- |
                    | Repository | Data access layer | Decouples domain from storage | Extra abstraction |
                    | Strategy | [Pricing rules] | Swappable algorithms | More classes |
                    | Observer / Pub-Sub | [Domain events] | Loose coupling between modules | Harder to trace flows |
                    """, "Only patterns actually used; each one justified by a concrete problem."),
            ]),
            section("Interfaces and APIs", "Specify the contracts between components and towards clients.", subs=[
                code("Main service interface", "typescript", """
                    /** Replace with the real contract of the main domain service. */
                    export interface OrderService {
                      create(input: CreateOrderInput): Promise<Order>;
                      get(id: OrderId): Promise<Order | null>;
                      cancel(id: OrderId, reason: string): Promise<void>;
                    }
                    """, "Signatures, inputs/outputs and error cases of the public contract."),
                md("Error handling contract", """
                    | Error | When | HTTP status | Client action |
                    | --- | --- | --- | --- |
                    | [ValidationError] | [Invalid input] | 400 | Fix input |
                    | [NotFound] | [Unknown id] | 404 | — |
                    """),
            ]),
        ]),
        section("Data", "Describe the information the system manages, its structures and how it is stored.", children=[
            section("Data Model", "Show the main entities, their attributes and relationships.", subs=[
                mermaid("Entity-relationship diagram", """
                    erDiagram
                      CUSTOMER ||--o{ ORDER : places
                      ORDER ||--|{ ORDER_ITEM : contains
                      PRODUCT ||--o{ ORDER_ITEM : "appears in"
                      ORDER {
                        string id PK
                        string status
                        datetime createdAt
                      }
                    """),
            ]),
            section("Data Structures and Algorithms", "Explain the in-memory structures and algorithms chosen, with their complexity.", subs=[
                code("Core data structure", "typescript", """
                    /** Example: replace with the structures that matter for performance or correctness. */
                    class LruCache<K, V> {
                      private map = new Map<K, V>();
                      constructor(private capacity: number) {}
                      get(key: K): V | undefined { /* … */ return undefined; }
                      set(key: K, value: V): void { /* … */ }
                    }
                    """),
                md("Complexity", """
                    | Structure / algorithm | Operation | Time | Space | Why this choice |
                    | --- | --- | --- | --- | --- |
                    | [LRU cache] | get / set | O(1) | O(n) | [Hot-path lookups] |
                    """),
            ]),
            section("Storage and Persistence", "Define where data lives, its lifecycle, consistency and backup strategy.", subs=[
                md("Storage", """
                    - **Stores:** [PostgreSQL for …, object storage for …]
                    - **Consistency:** [transactions, eventual consistency, idempotency keys]
                    - **Retention and deletion:** [policy, GDPR requirements]
                    - **Backup and restore:** [frequency, RPO / RTO]
                    - **Migrations:** [tooling and strategy]
                    """),
            ]),
        ]),
        section("Cross-cutting Concerns", "Address qualities that span all components.", children=[
            section("Security", "Describe authentication, authorisation, data protection and the main threats.", subs=[
                md("Security design", """
                    - **Authentication:** [mechanism]
                    - **Authorisation:** [roles / permissions model]
                    - **Data protection:** [encryption at rest and in transit, secrets management]
                    - **Threats and mitigations:** [e.g. STRIDE summary]
                    """),
            ]),
            section("Error Handling and Resilience", "Explain how failures are detected, contained and recovered from.", subs=[
                md("Resilience", """
                    - Timeouts, retries with backoff, circuit breakers: [where]
                    - Idempotency: [which operations, how]
                    - Degraded modes: [what still works when X is down]
                    """),
            ]),
            section("Observability", "Define logs, metrics, traces and alerts needed to operate the system.", subs=[
                md("Signals", """
                    | Signal | What | Tool | Alert when |
                    | --- | --- | --- | --- |
                    | Metric | [Request latency p95] | [Prometheus] | [> target for 5 min] |
                    | Log | [Structured request logs] | [Loki / ELK] | — |
                    | Trace | [End-to-end request] | [OpenTelemetry] | — |
                    """),
            ]),
        ]),
        section("Testing Strategy", "Plan how each requirement and quality attribute will be verified.", subs=[
            md("Test levels", """
                | Level | Scope | Tools | Run when |
                | --- | --- | --- | --- |
                | Unit | Functions and classes | [Vitest / JUnit] | Every commit |
                | Integration | Components with real dependencies | [Testcontainers] | Every commit |
                | End-to-end | User journeys | [Playwright] | Before release |
                | Performance | NFR targets | [k6] | Nightly |
                """),
        ]),
        section("Deployment and Operations", "Describe environments, the delivery pipeline and runbooks.", subs=[
            mermaid("Delivery pipeline", """
                flowchart LR
                  commit[Commit] --> ci[Build and test]
                  ci --> img[Container image]
                  img --> staging[Staging]
                  staging -->|approval| prod[Production]
                """),
            md("Environments and runbooks", """
                - **Environments:** [dev, staging, prod — differences]
                - **Configuration:** [how settings and secrets are provided]
                - **Rollback:** [procedure]
                - **Runbooks:** [links to operational procedures in References]
                """),
        ]),
        section("Risks and Open Questions", "Keep track of what could go wrong and of decisions still to be made.", subs=[
            md("Risk register", """
                | Risk | Likelihood | Impact | Mitigation | Owner |
                | --- | --- | --- | --- | --- |
                | [Risk description] | Medium | High | [Action] | [Name] |
                """),
            md("Open questions", """
                - [ ] _Question_ — needed by [date], owner [name]
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
    global API
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default=API)
    ap.add_argument("--replace", action="store_true", help="delete and recreate templates that already exist")
    args = ap.parse_args()
    API = args.api.rstrip("/")
    existing = {t["id"] for t in call("GET", "/api/templates")}
    for spec in TEMPLATES:
        tid = slug(spec["name"])
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
