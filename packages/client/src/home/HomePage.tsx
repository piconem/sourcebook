import type { NotebookKind } from "@sourcebook/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { routeHref } from "../router";
import { kindLabel, notebooksKey } from "./NotebookDialogs";
import { NotebookList } from "./NotebookList";

function NavLink({ kind, active }: { kind: NotebookKind; active: boolean }) {
  const { data } = useQuery({ queryKey: notebooksKey(kind), queryFn: () => api.listNotebooks(kind) });
  return (
    <a className={`nav-item${active ? " selected" : ""}`} href={routeHref({ page: "home", kind })} aria-current={active ? "page" : undefined}>
      <span className="nav-icon" aria-hidden="true">
        {kind === "projects" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" />
            <path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 17.5h7M17.5 14v7" />
          </svg>
        )}
      </span>
      <span className="nav-label">{kindLabel(kind, true)}</span>
      <span className="nav-count">{data?.length ?? ""}</span>
    </a>
  );
}

/** Home: projects and templates collections. */
export function HomePage({ kind }: { kind: NotebookKind }) {
  return (
    <div className="app home">
      <aside className="sidebar">
        <nav className="sidebar-nav home-nav" aria-label="Workspace">
          <NavLink kind="projects" active={kind === "projects"} />
          <NavLink kind="templates" active={kind === "templates"} />
        </nav>
      </aside>
      <main className="main">
        <NotebookList key={kind} kind={kind} />
      </main>
    </div>
  );
}
