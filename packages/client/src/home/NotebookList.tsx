import type { NotebookKind, ProjectSummary } from "@sourcebook/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type MouseEvent } from "react";
import { api } from "../api/client";
import { fullTime, relativeTime } from "../comments/time";
import { ContextMenu } from "../components/ContextMenu";
import { saveBlob } from "../download";
import { navigate, routeHref } from "../router";
import { ImportTemplateDialog } from "./ImportTemplateDialog";
import { DeleteNotebookDialog, kindLabel, NotebookFormDialog, notebooksKey, type NotebookForm } from "./NotebookDialogs";

type SortKey = "name" | "sections" | "updatedAt" | "createdAt";
type FormState = { mode: "create" | "edit"; kind: NotebookKind; initial: NotebookForm; target?: ProjectSummary };

/** Overleaf-style list of projects or templates. */
export function NotebookList({ kind }: { kind: NotebookKind }) {
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: notebooksKey(kind), queryFn: () => api.listNotebooks(kind) });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "updatedAt", asc: false });
  const [menu, setMenu] = useState<{ item: ProjectSummary; x: number; y: number } | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [notice, setNotice] = useState<{ text: string; open?: ProjectSummary; error?: boolean } | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const exportTemplate = async (t: ProjectSummary) => {
    setMenu(null);
    try {
      const { blob, name } = await api.exportTemplate(t.id);
      saveBlob(blob, name);
      setNotice({ text: `Exported “${t.name}” as ${name}.` });
    } catch (e) {
      setNotice({ text: `Export failed: ${(e as Error).message}`, error: true });
    }
  };

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: notebooksKey("projects") }), qc.invalidateQueries({ queryKey: notebooksKey("templates") })]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data ?? []).filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q));
    const cmp = (a: ProjectSummary, b: ProjectSummary) => {
      const v =
        sort.key === "name"
          ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
          : sort.key === "sections"
            ? a.sections - b.sections
            : a[sort.key].localeCompare(b[sort.key]);
      return sort.asc ? v : -v;
    };
    return [...list].sort(cmp);
  }, [data, query, sort]);

  const create = (targetKind: NotebookKind, from = "", name = "") =>
    setForm({ mode: "create", kind: targetKind, initial: { name, description: "", from } });

  const submitForm = async (f: NotebookForm) => {
    if (!form) return;
    if (form.mode === "edit" && form.target) {
      await api.updateNotebook(form.target.kind, form.target.id, { name: f.name, description: f.description });
      setForm(null);
      await refresh();
      return;
    }
    const [fromKind, fromId] = f.from.split("/") as [NotebookKind, string];
    const created = await api.createNotebook(form.kind, {
      name: f.name,
      description: f.description,
      ...(f.from ? { from: { kind: fromKind, id: fromId } } : {}),
    });
    setForm(null);
    await refresh();
    if (created.kind === kind) navigate({ page: "editor", kind: created.kind, id: created.id });
    else setNotice({ text: `${kindLabel(created.kind)} “${created.name}” created.`, open: created });
  };

  const openMenu = (item: ProjectSummary, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ item, x: e.type === "contextmenu" ? e.clientX : r.right, y: e.type === "contextmenu" ? e.clientY : r.bottom });
  };

  const sortHeader = (key: SortKey, label: string, className?: string) => (
    <th className={className} aria-sort={sort.key === key ? (sort.asc ? "ascending" : "descending") : undefined}>
      <button className="sort" onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : key === "name" }))}>
        {label} {sort.key === key ? (sort.asc ? "▲" : "▼") : ""}
      </button>
    </th>
  );

  const noun = kindLabel(kind).toLowerCase();
  return (
    <section className="notebook-list">
      <header className="notebook-list-head">
        <h1>{kindLabel(kind, true)}</h1>
        <input className="ref-search" type="search" placeholder={`Search ${kindLabel(kind, true).toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        {kind === "templates" && (
          <>
            <button onClick={() => importInput.current?.click()} title="Import a template exported as ZIP">
              ⤒ Import template
            </button>
            <input
              ref={importInput}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => {
                setImportFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </>
        )}
        <button className="primary" onClick={() => create(kind)}>
          ＋ New {noun}
        </button>
      </header>
      {kind === "templates" && (
        <p className="muted small notebook-list-intro">
          Templates are reusable project structures: edit them like a project, then start new projects from them.
        </p>
      )}
      {notice && (
        <p className={`notice${notice.error ? " render-error" : ""}`}>
          {notice.text}{" "}
          {notice.open && (
            <a href={routeHref({ page: "editor", kind: notice.open.kind, id: notice.open.id })}>Open it</a>
          )}{" "}
          <button className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}
      {error && <p className="render-error">{(error as Error).message}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && items.length === 0 && (
        <div className="ref-empty-state">
          <div className="ref-empty-icon" aria-hidden="true">{query ? "🔍" : kind === "projects" ? "📘" : "🧩"}</div>
          <p>{query ? "Nothing matches your search." : `No ${noun}s yet.`}</p>
          {!query && (
            <button className="primary" onClick={() => create(kind)}>
              Create your first {noun}
            </button>
          )}
        </div>
      )}
      {items.length > 0 && (
        <table className="ref-list notebook-table">
          <thead>
            <tr>
              {sortHeader("name", "Name")}
              {sortHeader("sections", "Sections", "num")}
              {sortHeader("updatedAt", "Last modified")}
              {sortHeader("createdAt", "Created")}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} onContextMenu={(e) => openMenu(p, e)} onDoubleClick={() => navigate({ page: "editor", kind: p.kind, id: p.id })}>
                <td className="notebook-name">
                  <a href={routeHref({ page: "editor", kind: p.kind, id: p.id })}>{p.name}</a>
                  {p.description && <span className="muted small notebook-desc">{p.description}</span>}
                  {p.createdFrom && (
                    <span className="muted small notebook-origin">
                      from {p.createdFrom.kind === "templates" ? "template" : "project"} “{p.createdFrom.name}”
                    </span>
                  )}
                </td>
                <td className="muted num">{p.sections}</td>
                <td className="muted" title={fullTime(p.updatedAt)}>
                  {relativeTime(p.updatedAt)}
                </td>
                <td className="muted" title={fullTime(p.createdAt)}>
                  {new Date(p.createdAt).toLocaleDateString()}
                </td>
                <td>
                  <button className="icon ref-more" aria-label={`Actions for ${p.name}`} title="Actions" onClick={(e) => openMenu(p, e)}>
                    ⋮
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button onClick={() => navigate({ page: "editor", kind: menu.item.kind, id: menu.item.id })}>Open</button>
          <button
            onClick={() => {
              setMenu(null);
              setForm({ mode: "edit", kind: menu.item.kind, target: menu.item, initial: { name: menu.item.name, description: menu.item.description, from: "" } });
            }}
          >
            Rename / edit…
          </button>
          <button onClick={() => (setMenu(null), create(kind, `${menu.item.kind}/${menu.item.id}`, `${menu.item.name} (copy)`))}>Duplicate…</button>
          {kind === "projects" ? (
            <button onClick={() => (setMenu(null), create("templates", `projects/${menu.item.id}`, `${menu.item.name} template`))}>Save as template…</button>
          ) : (
            <>
              <button onClick={() => (setMenu(null), create("projects", `templates/${menu.item.id}`, ""))}>New project from this template…</button>
              <button onClick={() => exportTemplate(menu.item)}>Export as ZIP</button>
            </>
          )}
          <hr />
          <button className="danger" onClick={() => (setMenu(null), setDeleting(menu.item))}>
            Delete…
          </button>
        </ContextMenu>
      )}

      {form && (
        <NotebookFormDialog open mode={form.mode} kind={form.kind} initial={form.initial} onSubmit={submitForm} onClose={() => setForm(null)} />
      )}
      <ImportTemplateDialog
        file={importFile}
        onClose={() => setImportFile(null)}
        onImported={async (t) => {
          setImportFile(null);
          await refresh();
          setNotice({ text: `Template “${t.name}” imported.`, open: t });
        }}
      />
      <DeleteNotebookDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await api.deleteNotebook(deleting!.kind, deleting!.id);
          setDeleting(null);
          await refresh();
        }}
      />
    </section>
  );
}
