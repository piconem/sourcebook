import { useMemo, useState } from "react";
import { parseBibtex, parseDelimited } from "../parsers";
import type { ViewerProps } from "./types";

const MAX_ROWS = 2000;

export function TableViewer({ node, text }: ViewerProps) {
  const tsv = node.name.toLowerCase().endsWith(".tsv");
  const { rows, truncated } = useMemo(() => parseDelimited(text ?? "", tsv ? "\t" : ",", MAX_ROWS + 1), [text, tsv]);
  const [head, ...body] = rows;
  if (!head) return <p className="muted">Empty file.</p>;
  return (
    <div className="ref-table-wrap">
      <table className="ref-table">
        <thead>
          <tr>
            <th className="rownum">#</th>
            {head.map((h, i) => <th key={i}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {body.slice(0, MAX_ROWS).map((r, i) => (
            <tr key={i}>
              <td className="rownum">{i + 1}</td>
              {head.map((_h, j) => <td key={j}>{r[j] ?? ""}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {(truncated || body.length > MAX_ROWS) && (
        <p className="muted small">Showing the first {MAX_ROWS} rows. Download the file to see everything.</p>
      )}
    </div>
  );
}

function JsonNode({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const label = name !== undefined && <span className="json-key">{name}: </span>;
  if (value === null || typeof value !== "object") {
    const cls = value === null ? "null" : typeof value;
    return (
      <div className="json-leaf">
        {label}
        <span className={`json-${cls}`}>{JSON.stringify(value)}</span>
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <details className="json-node" open={depth < 2}>
      <summary>
        {label}
        <span className="muted">{summary}</span>
      </summary>
      {entries.map(([k, v]) => <JsonNode key={k} name={k} value={v} depth={depth + 1} />)}
    </details>
  );
}

export function JsonViewer({ text }: ViewerProps) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text ?? "") };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [text]);
  if (!parsed.ok) return <p className="render-error">Invalid JSON: {parsed.error} — see the Source tab.</p>;
  return (
    <div className="json-tree">
      <JsonNode value={parsed.value} depth={0} />
    </div>
  );
}

export function BibViewer({ text }: ViewerProps) {
  const entries = useMemo(() => parseBibtex(text ?? ""), [text]);
  const [q, setQ] = useState("");
  const shown = entries.filter((e) =>
    !q ? true : [e.key, ...Object.values(e.fields)].join(" ").toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="bib">
      <input className="bib-search" placeholder={`Search ${entries.length} entries…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <ol className="bib-list">
        {shown.map((e) => (
          <li key={e.key}>
            <div className="bib-title">{e.fields.title ?? <em>(no title)</em>}</div>
            <div className="muted small">
              {[e.fields.author, e.fields.journal ?? e.fields.booktitle ?? e.fields.publisher, e.fields.year]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <div className="bib-meta">
              <code>{e.key}</code> <span className="muted">@{e.type}</span>
              {e.fields.doi && (
                <a href={`https://doi.org/${e.fields.doi}`} target="_blank" rel="noreferrer noopener">
                  DOI
                </a>
              )}
              {e.fields.url && (
                <a href={e.fields.url} target="_blank" rel="noreferrer noopener">
                  URL
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!shown.length && <p className="muted">No entries{q ? " match" : " found"}.</p>}
    </div>
  );
}
