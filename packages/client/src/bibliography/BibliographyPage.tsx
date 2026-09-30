import { BIB_TYPES, bibTypeInfo, generateBibtex, generateTextCitation, parseBibtex, type BibEntry } from "@sourcebook/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useAskAi } from "../ai/AskAiContext";
import { copyText } from "../clipboard";
import { ContextMenu } from "../components/ContextMenu";
import { Dialog } from "../components/Dialog";
import { saveBlob } from "../download";
import { BibDeleteDialog } from "./BibDeleteDialog";
import { bibByline, bibliographyKey, citationMarkdown, useBibliography } from "./BibliographyContext";

type SortKey = "name" | "type" | "authors" | "year" | "title";

/** Import BibTeX (pasted or from a .bib file), with a preview of new and duplicate keys. */
function ImportBibDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { byKey } = useBibliography();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseBibtex(text), [text]);
  const duplicates = parsed.filter((p) => byKey.has(p.key)).length;
  const close = () => {
    setText("");
    setResult(null);
    setError(null);
    onClose();
  };
  const run = async () => {
    try {
      setError(null);
      const r = await api.importBibtex(text, replace ? "replace" : "skip");
      void qc.invalidateQueries({ queryKey: bibliographyKey });
      setResult(
        [
          r.created.length && `${r.created.length} added`,
          r.replaced.length && `${r.replaced.length} replaced`,
          r.skipped.length && `${r.skipped.length} skipped (already present: ${r.skipped.join(", ")})`,
        ]
          .filter(Boolean)
          .join(" · ") || "Nothing imported.",
      );
      if (r.errors.length) setError(r.errors.join("\n"));
      if (!r.errors.length) setText("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog
      open={open}
      wide
      title="Import BibTeX"
      onClose={close}
      actions={
        <>
          <span className="muted small">
            {parsed.length ? `${parsed.length} entr${parsed.length === 1 ? "y" : "ies"} found${duplicates ? `, ${duplicates} with a key already in the bibliography` : ""}` : "Paste one or more entries, or choose a .bib file."}
          </span>
          <button onClick={close}>Close</button>
          <button className="primary" disabled={!parsed.length} onClick={run}>
            Import
          </button>
        </>
      }
    >
      <div className="bibl-import-tools">
        <button onClick={() => fileInput.current?.click()}>Choose .bib file…</button>
        <input
          ref={fileInput}
          type="file"
          accept=".bib,.bibtex,.txt,text/plain,application/x-bibtex"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) setText(await f.text());
          }}
        />
        <label className="check">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Replace entries whose key already exists (otherwise they are skipped)
        </label>
      </div>
      <textarea
        className="mono bibl-import-text"
        rows={12}
        spellCheck={false}
        value={text}
        placeholder={"@article{knuth1984literate,\n  author  = {Knuth, Donald E.},\n  title   = {Literate Programming},\n  journal = {The Computer Journal},\n  year    = {1984}\n}"}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
      />
      {parsed.length > 0 && (
        <ul className="bibl-import-preview">
          {parsed.slice(0, 50).map((p, i) => (
            <li key={i} className={byKey.has(p.key) ? "dup" : undefined}>
              <code>@{p.type}{"{"}{p.key || "?"}{"}"}</code> {p.fields.title?.replace(/[{}]/g, "") ?? ""}
              {byKey.has(p.key) && <span className="muted small"> — {replace ? "will replace the existing entry" : "already present, skipped"}</span>}
            </li>
          ))}
          {parsed.length > 50 && <li className="muted">… and {parsed.length - 50} more</li>}
        </ul>
      )}
      {result && <p className="import-ok">{result}</p>}
      {error && <pre className="render-error">{error}</pre>}
    </Dialog>
  );
}

/** The project's bibliography: searchable, sortable list of sources, with import/export. */
export function BibliographyPage() {
  const { entries, loaded, open, create } = useBibliography();
  const askAi = useAskAi();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });
  const [importing, setImporting] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: BibEntry } | null>(null);
  const [deleting, setDeleting] = useState<BibEntry | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = entries.filter(
      (e) =>
        (!type || e.type === type) &&
        (!q || [e.key, e.name, e.authors, e.title, e.year, e.venue, e.description, e.doi, e.abstract].some((v) => v?.toLowerCase().includes(q))),
    );
    const val = (e: BibEntry) => (sort.key === "type" ? bibTypeInfo(e.type).label : (e[sort.key] ?? ""));
    list.sort((a, b) => val(a).localeCompare(val(b), undefined, { numeric: true, sensitivity: "base" }) * (sort.desc ? -1 : 1));
    return list;
  }, [entries, query, type, sort]);
  const usedTypes = BIB_TYPES.filter((t) => entries.some((e) => e.type === t.id));

  const copy = async (label: string, text: string) => {
    if (await copyText(text)) {
      setFlash(`${label} copied`);
      setTimeout(() => setFlash(null), 1800);
    }
  };
  const exportBib = async () => saveBlob(new Blob([await api.exportBibtex()], { type: "application/x-bibtex" }), "bibliography.bib");
  const header = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
      <button className="sort" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }))}>
        {label} {sort.key === key ? (sort.desc ? "▾" : "▴") : ""}
      </button>
    </th>
  );

  return (
    <div className="ref-browser bibl-page">
      <header className="ref-browser-head">
        <h2 className="bibl-title">
          Bibliography <span className="muted">{entries.length ? `· ${entries.length}` : ""}</span>
        </h2>
        <div className="ref-browser-tools">
          <input className="ref-search" type="search" placeholder="Search sources" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="bibl-type-filter" aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {usedTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <button onClick={() => setImporting(true)}>⤓ Import .bib</button>
          <button disabled={!entries.length} onClick={exportBib}>
            ⤒ Export .bib
          </button>
          <button className="primary" onClick={() => create()}>
            ＋ New source
          </button>
        </div>
      </header>
      {flash && <p className="notice bibl-flash">{flash}</p>}

      {!loaded ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="bibl-empty">
          <p>
            <strong>No sources yet.</strong>
          </p>
          <p className="muted">
            Add papers, books, websites, software, datasets or videos you rely on. Cite them in Markdown with the ❝ Cite button (they become links like{" "}
            <code>[Knuth 1984](bib:knuth1984)</code>), or associate them with whole sections and sub-blocks with 📚. Exports include a References section and a
            bibliography.bib file for LaTeX.
          </p>
          <p>
            <button className="primary" onClick={() => create()}>
              ＋ New source
            </button>{" "}
            <button onClick={() => setImporting(true)}>⤓ Import .bib</button>
          </p>
        </div>
      ) : (
        <table className="ref-list bibl-table">
          <thead>
            <tr>
              {header("name", "Name")}
              {header("type", "Type")}
              {header("authors", "Authors")}
              {header("year", "Year")}
              {header("title", "Title")}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr
                key={e.key}
                tabIndex={0}
                onClick={() => open(e.key)}
                onKeyDown={(ev) => ev.key === "Enter" && open(e.key)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  setMenu({ x: ev.clientX, y: ev.clientY, entry: e });
                }}
              >
                <td>
                  <div className="bibl-name">{e.name}</div>
                  <code className="bibl-key">{e.key}</code>
                </td>
                <td className="muted">{bibTypeInfo(e.type).label}</td>
                <td className="bibl-authors" title={e.authors}>
                  {bibByline({ ...e, year: undefined })}
                </td>
                <td>{e.year}</td>
                <td className="bibl-cell-title" title={e.title}>
                  {e.title}
                  {(e.doi || e.url) && (
                    <a
                      className="bibl-ext"
                      href={e.doi ? `https://doi.org/${e.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}` : e.url}
                      target="_blank"
                      rel="noreferrer"
                      title={e.doi ? `DOI ${e.doi}` : e.url}
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      ↗
                    </a>
                  )}
                </td>
                <td>
                  <button
                    className="icon ref-more"
                    aria-label={`Actions for ${e.name}`}
                    title="More actions"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                      setMenu({ x: r.left, y: r.bottom + 4, entry: e });
                    }}
                  >
                    ⋮
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No sources match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {(() => {
            const e = menu.entry;
            const item = (label: string, run: () => void, danger = false) => (
              <button className={danger ? "danger" : undefined} onClick={() => (setMenu(null), run())}>
                {label}
              </button>
            );
            return (
              <>
                {item("Open / edit", () => open(e.key))}
                {item("Copy citation link", () => copy("Citation link", citationMarkdown(e)))}
                {item("Copy BibTeX", () => copy("BibTeX", e.bibtex?.trim() || generateBibtex(e)))}
                {item("Copy text citation", () => copy("Text citation", e.textCitation?.trim() || generateTextCitation(e)))}
                {askAi && item("Ask AI…", () => askAi({ kind: "bibliography", key: e.key, name: e.name, title: e.title }))}
                <hr />
                {item("Delete…", () => setDeleting(e), true)}
              </>
            );
          })()}
        </ContextMenu>
      )}
      <ImportBibDialog open={importing} onClose={() => setImporting(false)} />
      <BibDeleteDialog entry={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
