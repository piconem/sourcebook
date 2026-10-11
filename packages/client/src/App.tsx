import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NotebookEvent, NotebookKind } from "@sourcebook/shared";
import { useQuery } from "@tanstack/react-query";
import { api, setNotebookBase } from "./api/client";
import { keys, useProject } from "./api/queries";
import { BlockView } from "./components/BlockView";
import { ExportDialog } from "./components/ExportDialog";
import { DocumentView } from "./components/DocumentView";
import { OutlineTree } from "./components/OutlineTree";
import { SidebarResizer, useSidebarWidth } from "./components/SidebarResizer";
import { loadScrollMode, saveScrollMode, type ScrollMode } from "./components/scrollMode";
import { HomePage } from "./home/HomePage";
import { AskAiButton } from "./ai/AskAiButton";
import { AskAiProvider } from "./ai/AskAiContext";
import { ExternalChanges, ExternalChangesContext, subscribeProjectEvents } from "./live/externalChanges";
import { kindLabel } from "./home/NotebookDialogs";
import { recordRoute, routeHref, targetKey, useRoute, type Target } from "./router";
import { FocusContext, type FocusRequest } from "./live/focus";
import { EditorActions } from "./notifications/EditorActions";
import { ReloadDialog } from "./notifications/ReloadDialog";
import { outlineNumbers, withDepth } from "./tree";
import { TopBar } from "./components/TopBar";
import { ReferencesBrowser } from "./references/ReferencesBrowser";
import { ReferencesProvider, useReferences } from "./references/ReferencesContext";
import { BibliographyPage } from "./bibliography/BibliographyPage";
import { BibliographyProvider, useBibliography } from "./bibliography/BibliographyContext";
import { BibIcon } from "./bibliography/CitationsButton";

/** Sidebar entry opening the References file manager in the main area. */
function ReferencesNavItem({ active, onClick }: { active: boolean; onClick(): void }) {
  const { files } = useReferences();
  return (
    <button className={`nav-item${active ? " selected" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick}>
      <span className="nav-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      </span>
      <span className="nav-label">References</span>
      <span className="nav-count">{files.length}</span>
    </button>
  );
}

/** Sidebar entry opening the project's bibliography. */
function BibliographyNavItem({ active, onClick }: { active: boolean; onClick(): void }) {
  const { entries } = useBibliography();
  return (
    <button className={`nav-item${active ? " selected" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick}>
      <span className="nav-icon" aria-hidden="true">
        <BibIcon size={16} />
      </span>
      <span className="nav-label">Bibliography</span>
      <span className="nav-count">{entries.length}</span>
    </button>
  );
}

/** Editor for one project or template (the notebook API base is set before anything is fetched). */
function ProjectEditor({
  kind,
  id,
  scrollMode,
  target,
  actionsSlot,
}: {
  kind: NotebookKind;
  id: string;
  scrollMode: ScrollMode;
  /** Section / sub-block / comment named by the URL. */
  target?: Target;
  /** Top bar element where the editor's own buttons (notifications, comments) are rendered. */
  actionsSlot: HTMLElement | null;
}) {
  const qc = useQueryClient();
  useState(() => {
    setNotebookBase(kind, id);
    // Drop cached notebook data of the previously opened project/template.
    qc.removeQueries({ predicate: (q) => !["user", "notebooks", "summary"].includes(String(q.queryKey[0])) });
    return 0;
  });
  const { data: project, error } = useProject();
  // Live updates: changes made by the assistant (MCP), other windows or scripts appear here.
  const [changes] = useState(() => new ExternalChanges());
  // Reload requested by an application / assistant after a group of changes.
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
  const [reloadRequest, setReloadRequest] = useState<NotebookEvent | null>(null);
  useEffect(() => subscribeProjectEvents(qc, changes, setReloadRequest), [qc, changes]);
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState<"block" | "references" | "bibliography">("block");
  const [scrollTo, setScrollTo] = useState<{ id: string; seq: number } | null>(null);
  const main = useRef<HTMLElement>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  // Target of the URL already shown (so recording our own navigation in the URL does not trigger it again).
  const shownTarget = useRef<string | null>(null);
  const record = (t: Target, replace = false) => {
    shownTarget.current = targetKey(t);
    recordRoute({ page: "editor", kind, id, target: t }, { replace });
  };
  /** Shows a section and, optionally, scrolls to one of its sub-blocks / comments. */
  const show = (t: Target) => {
    setSelected(t.sectionId);
    setPage("block");
    // In document mode, selecting = scrolling to the section.
    setScrollTo((s) => ({ id: t.sectionId, seq: (s?.seq ?? 0) + 1 }));
    if (t.subBlockId) setFocus((f) => ({ ...t, seq: (f?.seq ?? 0) + 1, delay: scrollMode === "document" ? 800 : 120 }));
  };
  /** Navigates to a place (links, notifications, comment list) and records it in the URL. */
  const goTo = (t: Target) => {
    record(t);
    show(t);
  };
  const selectBlock = (blockId: string) => goTo({ sectionId: blockId });
  // Scroll spy (document mode): keep the URL on the section in view, without adding history entries.
  const onCurrentChange = (blockId: string) => {
    setSelected(blockId);
    if (target?.sectionId !== blockId) record({ sectionId: blockId }, true);
  };
  // Switching mode: keep the current section in view.
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      if (scrollMode === "section") return;
    }
    if (scrollMode === "document" && selected) setScrollTo((s) => ({ id: selected, seq: (s?.seq ?? 0) + 1 }));
    else main.current?.scrollTo({ top: 0 });
  }, [scrollMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!project) return;
    if (!selected || !project.blocks.some((b) => b.id === selected)) setSelected(project.blocks[0]?.id ?? null);
  }, [project, selected]);

  // Opening a link (or going back/forward in history) shows the place it names.
  const tKey = targetKey(target);
  useEffect(() => {
    if (!project || !target || tKey === shownTarget.current) return;
    if (!project.blocks.some((b) => b.id === target.sectionId)) return;
    shownTarget.current = tKey;
    show(target);
  }, [project, tKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const addBlock = async (parentId: string | null) => {
    const title = window.prompt(parentId ? "Sub-section title" : "Section title");
    if (!title?.trim()) return;
    const created = await api.createBlock({ title: title.trim(), parentId });
    await qc.invalidateQueries({ queryKey: keys.project });
    selectBlock(created.id);
  };

  if (error)
    return (
      <div className="editor-error">
        <p className="render-error">
          {(error as { status?: number }).status === 404
            ? `This ${kindLabel(kind).toLowerCase()} does not exist (it may have been deleted).`
            : `Cannot reach the Sourcebook server: ${(error as Error).message}`}
        </p>
        <a href={routeHref({ page: "home", kind })}>← Back to {kindLabel(kind, true)}</a>
      </div>
    );
  if (!project) return <p className="muted editor-error">Loading…</p>;

  return (
    <ExternalChangesContext.Provider value={changes}>
    <FocusContext.Provider value={focus}>
    <AskAiProvider project={{ kind, id, name: project.name }}>
    <ReferencesProvider>
    <BibliographyProvider onGoTo={selectBlock}>
    <div className="app" style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <h1 title={project.name}>{project.name}</h1>
          {kind === "templates" && <span className="badge-template" title="Projects created from this template start with a copy of it">Template</span>}
          <AskAiButton target={() => ({ kind: "document" })} />
          <button
            className="icon"
            title="Export combined Markdown (ZIP)"
            aria-label="Export combined Markdown"
            onClick={() => setExporting(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
          </button>
        </div>
        <nav className="sidebar-nav" aria-label="Project">
          <ReferencesNavItem active={page === "references"} onClick={() => setPage("references")} />
          <BibliographyNavItem active={page === "bibliography"} onClick={() => setPage("bibliography")} />
        </nav>
        <div className="sidebar-label">Structure</div>
        <OutlineTree project={project} selectedId={page === "block" ? selected : null} onSelect={selectBlock} />
        <div className="sidebar-actions">
          <button onClick={() => addBlock(null)}>+ Section</button>
          <button disabled={!selected} onClick={() => addBlock(selected)}>
            + Sub-section
          </button>
        </div>
      </aside>
      <SidebarResizer width={sidebarWidth} onChange={setSidebarWidth} />
      <main
        ref={main}
        className={`main${page !== "block" ? " main-references" : ""}${scrollMode === "document" && page === "block" ? " main-document" : ""}`}
      >
        {page === "references" ? (
          <ReferencesBrowser />
        ) : page === "bibliography" ? (
          <BibliographyPage />
        ) : scrollMode === "document" ? (
          <DocumentView project={project} scrollRoot={main} scrollTo={scrollTo} onCurrentChange={onCurrentChange} />
        ) : selected ? (
          <BlockView
            key={selected}
            blockId={selected}
            number={outlineNumbers(withDepth(project.blocks)).get(selected)}
            depth={withDepth(project.blocks).find((b) => b.id === selected)?.depth}
            onDeleted={() => setSelected(null)}
          />
        ) : (
          <p className="muted">No sections yet — create one with “+ Section”.</p>
        )}
      </main>
      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
      <ReloadDialog request={reloadRequest} project={project} onClose={() => setReloadRequest(null)} goTo={goTo} />
      {actionsSlot && createPortal(<EditorActions project={project} goTo={goTo} />, actionsSlot)}
    </div>
    </BibliographyProvider>
    </ReferencesProvider>
    </AskAiProvider>
    </FocusContext.Provider>
    </ExternalChangesContext.Provider>
  );
}

/** Root: home (projects / templates) or the editor of one of them, from the URL hash. */
export function App() {
  const route = useRoute();
  const [scrollMode, setScrollModeState] = useState<ScrollMode>(loadScrollMode);
  const setScrollMode = (m: ScrollMode) => {
    saveScrollMode(m);
    setScrollModeState(m);
  };
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const summary = useQuery({
    queryKey: ["summary", route.kind, route.page === "editor" ? route.id : ""],
    queryFn: () => api.getNotebookSummary(route.kind, (route as { id: string }).id),
    enabled: route.page === "editor",
  });
  return (
    <div className="shell">
      <TopBar
        crumb={route.page === "editor" ? { kind: route.kind, name: summary.data?.name ?? route.id } : undefined}
        scrollMode={route.page === "editor" ? scrollMode : undefined}
        onScrollModeChange={setScrollMode}
        actionsSlot={route.page === "editor" ? setActionsSlot : undefined}
      />
      {route.page === "home" ? (
        <HomePage kind={route.kind} />
      ) : (
        <ProjectEditor
          key={`${route.kind}/${route.id}`}
          kind={route.kind}
          id={route.id}
          scrollMode={scrollMode}
          target={route.target}
          actionsSlot={actionsSlot}
        />
      )}
    </div>
  );
}
