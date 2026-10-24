import {
  CSV_DELIMITERS,
  compareCells,
  parseCsv,
  sniffDelimiter,
  stringifyCsv,
  summarizeColumns,
  type CsvContent,
  type CsvDelimiter,
  type TextRange,
} from "@sourcebook/shared";
import { useContext, useMemo, useRef, useState } from "react";
import { referenceUrl } from "../../api/client";
import { AskAiButton } from "../../ai/AskAiButton";
import { useCommentAnchoring, type AnchorAdapter } from "../../comments/useCommentAnchoring";
import { useBridge } from "../../comments/bridge";
import { CodeMirror } from "../../components/CodeMirror";
import { saveBlob } from "../../download";
import { ReferencesContext } from "../../references/ReferencesContext";
import type { SubBlockProps } from "../types";

/** Data rows per page of the table. */
export const PAGE_SIZE = 100;
type View = "table" | "summary" | "text";
/** Data rows (1-based record indices: record 0 is the header) a comment is attached to. */
type RowSpan = { first: number; last: number };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString(undefined, { maximumFractionDigits: 3 }));
const colName = (header: string[], c: number) => header[c] || `Column ${c + 1}`;

/**
 * A data set: a table (sort, filter, edit cells, add/remove rows and columns), a per-column summary and the raw
 * CSV text. Comments attach to rows (source lines); the gutter shows them and opens them.
 */
export function CsvEditor({ blockId, subBlock, onChange, commentBridge, refLabel }: SubBlockProps<CsvContent>) {
  const [text, setText] = useState(subBlock.content.csv);
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(subBlock.content.delimiter as CsvDelimiter);
  const [view, setView] = useState<View>("table");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ col: number; asc: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<RowSpan | null>(null);
  const [textKey, setTextKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const refs = useContext(ReferencesContext);

  const parsed = useMemo(() => parseCsv(text, delimiter), [text, delimiter]);
  const rows = parsed.rows;
  const header = rows[0] ?? [];
  const data = rows.slice(1);
  const width = Math.max(header.length, ...data.map((r) => r.length), 1);
  const textRef = useRef(text);
  textRef.current = text;
  const spansRef = useRef(parsed.spans);
  spansRef.current = parsed.spans;

  // ---- comments attached to rows ----
  const rowComments = useRef(new Map<string, RowSpan>());
  const [anchors, setAnchors] = useState<{ byRow: Map<number, string[]>; active: string | null }>({ byRow: new Map(), active: null });
  const publish = (active: string | null) => {
    const byRow = new Map<number, string[]>();
    for (const [id, span] of rowComments.current) for (let r = span.first; r <= span.last; r++) byRow.set(r, [...(byRow.get(r) ?? []), id]);
    setAnchors({ byRow, active });
  };
  const bridge = useBridge(commentBridge);
  const adapter = useMemo<AnchorAdapter | null>(() => {
    if (!commentBridge) return null;
    const recordsOf = (r: TextRange): RowSpan | null => {
      const spans = spansRef.current;
      const first = spans.findIndex((s) => s.to >= r.from);
      let last = first;
      while (last + 1 < spans.length && spans[last + 1].from < r.to) last++;
      return first < 0 ? null : { first, last };
    };
    return {
      getText: () => textRef.current,
      getRanges: () => {
        const spans = spansRef.current;
        const out = new Map<string, TextRange>();
        for (const [id, s] of rowComments.current) if (spans[s.first] && spans[s.last]) out.set(id, { from: spans[s.first].from, to: spans[s.last].to });
        return out;
      },
      setRanges: (ranges, active) => {
        rowComments.current = new Map();
        for (const [id, r] of ranges) {
          const span = recordsOf(r);
          if (span) rowComments.current.set(id, span);
        }
        publish(active);
      },
      getSelection: () => {
        const spans = spansRef.current;
        const s = selectedRef.current;
        return s && spans[s.first] && spans[s.last] ? { from: spans[s.first].from, to: spans[s.last].to } : null;
      },
      reveal: (r) => {
        const span = recordsOf(r);
        if (!span) return;
        setView("table");
        revealRow(span.first);
      },
    };
  }, [commentBridge]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const { onDocChanged } = useCommentAnchoring({ blockId, subBlockId: subBlock.id, commentCount: subBlock.commentCount ?? 0, bridge: commentBridge, unit: "lines", adapter });

  /** Saves new rows. `removed`: the record deleted, so comments stay on the same rows (a comment only on it detaches). */
  const commit = (next: string[][], d: CsvDelimiter = delimiter, removed?: number) => {
    if (removed !== undefined) {
      for (const [id, s] of [...rowComments.current]) {
        if (s.first === removed && s.last === removed) rowComments.current.delete(id);
        else rowComments.current.set(id, { first: s.first > removed ? s.first - 1 : s.first, last: s.last >= removed ? s.last - 1 : s.last });
      }
      publish(anchors.active);
    }
    const csv = stringifyCsv(next, d);
    textRef.current = csv;
    setText(csv);
    onChange({ csv, delimiter: d });
    onDocChanged();
  };
  const setCell = (record: number, col: number, value: string) => {
    const next = rows.map((r) => [...r]);
    while (next.length <= record) next.push([]);
    const row = next[record];
    while (row.length <= col) row.push("");
    row[col] = value;
    commit(next);
  };

  // ---- table view: filter, sort, pages ----
  const order = useMemo(() => {
    const q = query.trim().toLowerCase();
    let idx = data.map((_, i) => i + 1).filter((rec) => !q || rows[rec].some((v) => v.toLowerCase().includes(q)));
    if (sort) idx = [...idx].sort((a, b) => (sort.asc ? 1 : -1) * compareCells(rows[a][sort.col] ?? "", rows[b][sort.col] ?? ""));
    return idx;
  }, [rows, query, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(order.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = order.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const revealRow = (record: number) => {
    setQuery("");
    setSort(null);
    setPage(Math.floor(Math.max(0, record - 1) / PAGE_SIZE));
    setSelected({ first: record, last: record });
    setTimeout(() => document.getElementById(`csv-${subBlock.id}-r${record}`)?.scrollIntoView?.({ block: "center" }));
  };
  const selectRow = (record: number, extend: boolean) =>
    setSelected((s) => (extend && s ? { first: Math.min(s.first, record), last: Math.max(s.last, record) } : { first: record, last: record }));
  const summary = useMemo(() => (view === "summary" ? summarizeColumns(header, data) : []), [view, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- structure ----
  const addRow = () => {
    commit([...(rows.length ? rows : [Array(width).fill("")]), Array(width).fill("")]);
    setQuery("");
    setSort(null);
    setPage(Math.floor(data.length / PAGE_SIZE));
  };
  const deleteRow = (record: number) => {
    commit(rows.filter((_, i) => i !== record), delimiter, record);
    setSelected(null);
  };
  const addColumn = () => commit((rows.length ? rows : [[]]).map((r, i) => [...r, ...Array(Math.max(0, width - r.length)).fill(""), i === 0 ? `column${width + 1}` : ""]));
  const deleteColumn = (col: number) => {
    const filled = data.filter((r) => (r[col] ?? "").trim()).length;
    if (filled && !window.confirm(`Delete the column “${colName(header, col)}” and its ${filled} value(s)?`)) return;
    commit(rows.map((r) => r.filter((_, i) => i !== col)));
    if (sort?.col === col) setSort(null);
  };

  // ---- import / export ----
  const replaceWith = (csv: string, source: string) => {
    if (data.length && !window.confirm(`Replace the ${data.length} row(s) of this data set with ${source}?`)) return;
    const d = sniffDelimiter(csv);
    const normalized = csv.replace(/\r\n?/g, "\n");
    rowComments.current = new Map();
    setDelimiter(d);
    textRef.current = normalized;
    setText(normalized);
    setTextKey((k) => k + 1);
    onChange({ csv: normalized, delimiter: d });
    onDocChanged();
    setPage(0);
    setSort(null);
    setNotice(`Imported ${source}: ${Math.max(0, parseCsv(normalized, d).rows.length - 1)} rows.`);
  };
  const csvReferences = (refs?.files ?? []).filter((f) => /\.(csv|tsv|txt)$/i.test(f.name));

  const rowComment = (record: number) => {
    if (!commentBridge) return;
    setSelected({ first: record, last: record });
    selectedRef.current = { first: record, last: record };
    const anchor = commentBridge.selectionAnchor?.();
    if (anchor) commentBridge.requestComment?.(anchor);
  };
  const linesOf = (s: RowSpan) => {
    const spans = parsed.spans;
    return spans[s.first] && spans[s.last] ? { first: spans[s.first].firstLine, last: spans[s.last].lastLine } : null;
  };

  return (
    <div className="csv-sub">
      <div className="sub-toolbar csv-toolbar">
        <div className="segmented" role="tablist" aria-label="View">
          {(["table", "summary", "text"] as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
              {v === "table" ? "Table" : v === "summary" ? "Summary" : "CSV"}
            </button>
          ))}
        </div>
        <span className="muted small csv-size">
          {data.length} row{data.length === 1 ? "" : "s"} × {header.length} column{header.length === 1 ? "" : "s"}
        </span>
        <label className="small">
          Delimiter{" "}
          <select
            value={delimiter}
            onChange={(e) => {
              const d = e.target.value as CsvDelimiter;
              setDelimiter(d);
              commit(rows, d);
              setTextKey((k) => k + 1);
            }}
          >
            {CSV_DELIMITERS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => fileInput.current?.click()} title="Replace the data with a CSV file from your computer">
          Import file…
        </button>
        {csvReferences.length > 0 && (
          <select
            aria-label="Import from references"
            value=""
            onChange={async (e) => {
              const path = e.target.value;
              if (!path) return;
              const res = await fetch(referenceUrl(path), { credentials: "same-origin" });
              if (res.ok) replaceWith(await res.text(), `references/${path}`);
              else setNotice(`Cannot read references/${path}`);
            }}
          >
            <option value="">From references…</option>
            {csvReferences.map((f) => (
              <option key={f.path} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={() => saveBlob(new Blob([text], { type: "text/csv" }), `${(subBlock.title || "data").replace(/[^\w.-]+/g, "_")}.csv`)} title="Download as .csv">
          Download
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) replaceWith(await f.text(), f.name);
          }}
        />
      </div>
      {notice && (
        <p className="muted small csv-notice">
          {notice}{" "}
          <button className="link small" onClick={() => setNotice(null)}>
            OK
          </button>
        </p>
      )}

      {view === "text" ? (
        <CodeMirror
          key={textKey}
          initialValue={text}
          ext="csv"
          onChange={(value) => {
            textRef.current = value;
            setText(value);
            onChange({ csv: value, delimiter });
            onDocChanged();
          }}
        />
      ) : view === "summary" ? (
        <div className="csv-table-wrap">
          <table className="csv-summary">
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
                <th>Filled</th>
                <th>Distinct</th>
                <th>Min</th>
                <th>Max</th>
                <th>Mean</th>
                <th>Most frequent</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((c, i) => (
                <tr key={i}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>
                    <span className={`csv-kind ${c.kind}`}>{c.kind}</span>
                  </td>
                  <td>
                    {c.filled}
                    {c.empty > 0 && <span className="muted"> ({c.empty} empty)</span>}
                  </td>
                  <td>{c.distinct}</td>
                  <td>{c.min ?? ""}</td>
                  <td>{c.max ?? ""}</td>
                  <td>{c.mean !== undefined ? fmt(c.mean) : ""}</td>
                  <td className="csv-top">{c.top?.map((t) => `${t.value} (${t.count})`).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!summary.length && <p className="muted small">No columns yet.</p>}
        </div>
      ) : (
        <>
          <div className="csv-table-tools">
            <input
              type="search"
              className="ref-search"
              placeholder="Filter rows…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
            {query && (
              <span className="muted small">
                {order.length} of {data.length} rows
              </span>
            )}
            {sort && (
              <button className="link small" onClick={() => setSort(null)}>
                Original order
              </button>
            )}
            <span className="csv-spacer" />
            {commentBridge && (
              <button
                type="button"
                className="comment-lines-btn"
                disabled={!selected}
                title="Comment on the selected rows (click a row number; Shift+click for several)"
                onClick={() => {
                  const anchor = commentBridge.selectionAnchor?.();
                  if (anchor) commentBridge.requestComment?.(anchor);
                }}
              >
                💬+ Comment {selected && selected.last > selected.first ? "rows" : "row"}
              </button>
            )}
            {selected && linesOf(selected) && (
              <AskAiButton
                className="comment-lines-btn ask-ai-inline"
                label={selected.last > selected.first ? "Ask AI about rows" : "Ask AI about row"}
                target={() => ({ kind: "selection", ref: refLabel ?? subBlock.id, id: subBlock.id, type: "csv", title: subBlock.title, lines: linesOf(selected)! })}
              />
            )}
            <button type="button" onClick={addRow}>
              ＋ Row
            </button>
            <button type="button" onClick={addColumn}>
              ＋ Column
            </button>
          </div>
          <div className="csv-table-wrap">
            <table className="csv-table">
              <thead>
                <tr>
                  <th className="csv-gutter" aria-label="Row" />
                  {Array.from({ length: width }, (_, c) => (
                    <th key={c}>
                      <div className="csv-head">
                        <input
                          className="csv-cell"
                          value={header[c] ?? ""}
                          placeholder={`Column ${c + 1}`}
                          aria-label={`Name of column ${c + 1}`}
                          onChange={(e) => setCell(0, c, e.target.value)}
                        />
                        <button
                          className="icon csv-sort"
                          title="Sort by this column"
                          aria-label={`Sort by ${colName(header, c)}`}
                          onClick={() => setSort((s) => (s?.col === c ? (s.asc ? { col: c, asc: false } : null) : { col: c, asc: true }))}
                        >
                          {sort?.col === c ? (sort.asc ? "▲" : "▼") : "↕"}
                        </button>
                        <button className="icon csv-del" title="Delete this column" aria-label={`Delete column ${colName(header, c)}`} onClick={() => deleteColumn(c)}>
                          ✕
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((rec) => {
                  const ids = anchors.byRow.get(rec) ?? [];
                  const isSelected = !!selected && rec >= selected.first && rec <= selected.last;
                  const isActive = !!bridge.activeId && ids.includes(bridge.activeId);
                  return (
                    <tr key={rec} id={`csv-${subBlock.id}-r${rec}`} className={`${isSelected ? "selected" : ""}${ids.length ? " commented" : ""}${isActive ? " active" : ""}`}>
                      <td className="csv-gutter">
                        <button className="csv-rownum" title="Select this row (Shift+click: several)" onClick={(e) => selectRow(rec, e.shiftKey)}>
                          {rec}
                        </button>
                        {ids.length > 0 && (
                          <button
                            className="csv-comments"
                            title={`${ids.length} comment${ids.length === 1 ? "" : "s"} on this row`}
                            aria-label={`${ids.length} comment${ids.length === 1 ? "" : "s"} on row ${rec}`}
                            onClick={() => {
                              commentBridge?.setActive(ids[0]);
                              commentBridge?.openPanel?.();
                            }}
                          >
                            💬{ids.length > 1 ? ids.length : ""}
                          </button>
                        )}
                        {commentBridge && (
                          <button className="csv-add-comment" title="Comment on this row" aria-label={`Comment on row ${rec}`} onClick={() => rowComment(rec)}>
                            +
                          </button>
                        )}
                        <button className="csv-del-row" title="Delete this row" aria-label={`Delete row ${rec}`} onClick={() => deleteRow(rec)}>
                          ✕
                        </button>
                      </td>
                      {Array.from({ length: width }, (_, c) => (
                        <td key={c}>
                          <input className="csv-cell" value={rows[rec][c] ?? ""} aria-label={`Row ${rec}, ${colName(header, c)}`} onChange={(e) => setCell(rec, c, e.target.value)} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!data.length && <p className="muted small csv-empty">No rows yet: add one, import a file or paste CSV in the CSV view.</p>}
            {data.length > 0 && !order.length && <p className="muted small csv-empty">No row matches the filter.</p>}
          </div>
          {pages > 1 && (
            <div className="csv-pages small">
              <button disabled={current === 0} onClick={() => setPage(current - 1)}>
                ‹ Previous
              </button>
              <span>
                Page {current + 1} of {pages} · rows {current * PAGE_SIZE + 1}–{Math.min(order.length, (current + 1) * PAGE_SIZE)} of {order.length}
              </span>
              <button disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                Next ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
