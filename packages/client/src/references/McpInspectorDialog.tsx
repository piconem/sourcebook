import { assistantView, estimateTokens, splitParts, type McpManifest, type McpPart } from "@sourcebook/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, mcpFigureUrl, mcpPageUrl } from "../api/client";
import { copyText } from "../clipboard";
import { Dialog } from "../components/Dialog";
import { referencesKey } from "./ReferencesContext";
import { formatSize } from "./ReferenceViewerDialog";
import { MarkdownViewer } from "./viewers/rich";
import { InsertImageDialog } from "./InsertImageDialog";
import type { PickedImage } from "./ReferenceImagePicker";

type Tab = "markdown" | "figures" | "pages" | "assistant" | "details";

export const mcpContentKey = (path: string) => ["mcp-content", path] as const;

const kindLabel: Record<string, string> = {
  text: "Text",
  "text+figures": "Text + figures",
  scan: "Scan",
  figures: "Images, no text",
  vector: "Drawing, no text",
  blank: "Blank",
};

function partKind(p: McpPart): string {
  const bits = [p.kind ? kindLabel[p.kind] : ""];
  if (p.invisibleText) bits.push("scanner OCR text");
  if (p.garbled) bits.push("unreadable text layer");
  if (p.transcribed) bits.push(`transcribed by ${p.transcribed.by}`);
  return bits.filter(Boolean).join(" · ");
}

/** What Sourcebook generated for the assistant from a reference file: Markdown, page images, details. */
export function McpInspectorDialog({ path, onClose }: { path: string | null; onClose(): void }) {
  const qc = useQueryClient();
  const content = useQuery({ queryKey: mcpContentKey(path ?? ""), queryFn: () => api.getMcpContent(path!), enabled: !!path });
  const [tab, setTab] = useState<Tab>("markdown");
  const [rendered, setRendered] = useState(true);
  const [page, setPage] = useState<number | null>(null);
  const [figure, setFigure] = useState<string | null>(null);
  const [inserting, setInserting] = useState<PickedImage | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!path) return;
    setTab("markdown");
    setPage(null);
    setFigure(null);
    setDone(null);
    setError(null);
  }, [path]);

  const data = content.data;
  const m = data?.manifest;
  const parts = useMemo(() => (data ? splitParts(data.markdown) : []), [data]);
  const view = useMemo(() => (path && data && !m?.error ? assistantView(path, data) : ""), [path, data, m?.error]);
  const isPdf = m?.format === "pdf";
  const figures = useMemo(() => m?.parts.flatMap((p) => p.figures ?? []) ?? [], [m]);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: mcpContentKey(path ?? "") });
    await qc.invalidateQueries({ queryKey: referencesKey });
  };
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const version = m?.createdAt ?? "";

  return (
    <>
    <McpInsertFigure source={inserting} onClose={() => setInserting(null)} onDone={setDone} />
    <Dialog
      open={!!path}
      wide
      title={`Assistant content · ${path?.split("/").pop() ?? ""}`}
      onClose={onClose}
      actions={
        <>
          <span className="muted small">Generated from references/{path} — the file itself is never modified.</span>
          {m && (
            <button
              className="danger"
              disabled={!!busy}
              onClick={() =>
                act("delete", async () => {
                  await api.deleteMcpContent(path!);
                  onClose();
                })
              }
              title="Delete the generated files (they are created again automatically)"
            >
              Delete generated
            </button>
          )}
          {isPdf && (
            <button disabled={!!busy} onClick={() => act("pages", () => api.renderPageImages(path!, "all"))} title="Render an image of every page">
              {busy === "pages" ? "Rendering…" : "Render all page images"}
            </button>
          )}
          <button disabled={!!busy} onClick={() => act("convert", () => api.convertReferences([path!], true))}>
            {busy === "convert" ? "Converting…" : "Convert again"}
          </button>
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {content.isLoading ? (
        <p className="muted">Loading…</p>
      ) : content.error ? (
        <p className="muted">Not converted yet. It is converted automatically in a moment, or use “Convert again”.</p>
      ) : m?.error ? (
        <div className="notice render-error">
          <strong>The conversion failed:</strong> {m.error}
          <p className="small">The assistant cannot read this file. If it is damaged or password-protected, save it again (e.g. as PDF) and upload it.</p>
        </div>
      ) : m && data ? (
        <>
          <div className="mcp-summary">
            <span>
              <strong>{m.format.toUpperCase()}</strong> → Markdown
            </span>
            {m.unit !== "document" && (
              <span>
                {m.parts.length} {m.unit}
                {m.parts.length === 1 ? "" : "s"}
              </span>
            )}
            <span>{estimateTokens(view).toLocaleString()} tokens (approx.)</span>
            {isPdf && <span>{figures.length} figure{figures.length === 1 ? "" : "s"}</span>}
            {isPdf && <span>{m.parts.filter((p) => p.image).length} page images</span>}
            {m.parts.some((p) => p.needsImage && !p.transcribed) && (
              <span className="mcp-tone-warn">{m.parts.filter((p) => p.needsImage && !p.transcribed).length} page(s) readable only as images</span>
            )}
          </div>
          <div className="tabs" role="tablist">
            {(["markdown", ...(figures.length ? ["figures"] : []), ...(isPdf ? ["pages"] : []), "assistant", "details"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t === "markdown" ? "Markdown" : t === "figures" ? `Figures (${figures.length})` : t === "pages" ? "Pages" : t === "assistant" ? "What the assistant sees" : "Details"}
              </button>
            ))}
          </div>
          {error && <p className="render-error">{error}</p>}

          {tab === "markdown" && (
            <div className="mcp-tab">
              <div className="mcp-tab-tools">
                <div className="segmented" role="group" aria-label="Markdown view">
                  <button className={rendered ? "active" : ""} onClick={() => setRendered(true)}>
                    Rendered
                  </button>
                  <button className={!rendered ? "active" : ""} onClick={() => setRendered(false)}>
                    Source
                  </button>
                </div>
                <span className="muted small">content.md · {formatSize(new Blob([data.markdown]).size)}</span>
              </div>
              {rendered ? <MarkdownViewer node={{ name: "content.md", path: "content.md", kind: "file" }} url="" text={data.markdown} /> : <pre className="mcp-source">{data.markdown}</pre>}
            </div>
          )}

          {tab === "figures" && (
            <div className="mcp-tab">
              {figure === null ? (
                <div className="mcp-figures">
                  {figures.map((f) => (
                    <button key={f.id} className="mcp-figure" onClick={() => setFigure(f.id)} title={f.caption ?? "No caption"}>
                      <img src={mcpFigureUrl(path!, f.id, version)} alt={f.caption ?? f.id} loading="lazy" />
                      <span className="mcp-figure-caption">
                        <span className="mcp-figure-id">
                          <strong>{f.id}</strong> · page {f.page}
                        </span>
                        <span className="mcp-figure-text">{f.caption ?? "No caption"}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                (() => {
                  const i = figures.findIndex((f) => f.id === figure);
                  const f = figures[i];
                  return (
                    <div className="mcp-figure-detail">
                      <div className="mcp-tab-tools">
                        <button onClick={() => setFigure(null)}>← All figures</button>
                        <button disabled={i <= 0} onClick={() => setFigure(figures[i - 1].id)}>
                          ‹
                        </button>
                        <strong>
                          {f.id} ({i + 1} of {figures.length})
                        </strong>
                        <button disabled={i >= figures.length - 1} onClick={() => setFigure(figures[i + 1].id)}>
                          ›
                        </button>
                        <button className="link" onClick={() => (setTab("pages"), setPage(f.page))}>
                          Page {f.page}
                        </button>
                        <span className="muted small">{f.kind === "image" ? "image" : f.kind === "drawing" ? "vector drawing" : "image + drawing"}</span>
                        <button className="primary" onClick={() => setInserting({ path: path!, figure: f.id, caption: f.caption ?? "" })}>
                          Insert into a section…
                        </button>
                      </div>
                      {done && <p className="notice small">{done}</p>}
                      <p className="mcp-figure-full-caption">{f.caption ?? <span className="muted">No caption found next to this figure.</span>}</p>
                      <div className="mcp-figure-image">
                        <img src={mcpFigureUrl(path!, f.id, version)} alt={f.caption ?? f.id} />
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          )}

          {tab === "pages" && (
            <div className="mcp-tab">
              {page === null ? (
                <div className="mcp-pages">
                  {m.parts.map((p) => (
                    <button key={p.n} className={`mcp-page${p.needsImage && !p.transcribed ? " needs-image" : ""}`} onClick={() => setPage(p.n)} title={partKind(p)}>
                      {p.image ? <img src={mcpPageUrl(path!, p.n, version + (p.image ?? ""))} alt={`Page ${p.n}`} loading="lazy" /> : <span className="mcp-page-none">No image</span>}
                      <span className="mcp-page-label">
                        {p.n} · {p.kind ? kindLabel[p.kind] : ""}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                (() => {
                  const p = m.parts.find((x) => x.n === page)!;
                  const text = parts.find((x) => x.n === page)?.text ?? "";
                  return (
                    <div className="mcp-page-detail">
                      <div className="mcp-tab-tools">
                        <button onClick={() => setPage(null)}>← All pages</button>
                        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                          ‹
                        </button>
                        <strong>
                          Page {page} of {m.parts.length}
                        </strong>
                        <button disabled={page >= m.parts.length} onClick={() => setPage(page + 1)}>
                          ›
                        </button>
                        <span className="muted small">{partKind(p)}</span>
                        {!p.image && (
                          <button disabled={!!busy} onClick={() => act("page", () => api.renderPageImages(path!, [page]))}>
                            {busy === "page" ? "Rendering…" : "Render image"}
                          </button>
                        )}
                      </div>
                      <div className="mcp-side-by-side">
                        <div className="mcp-page-image">{p.image ? <img src={mcpPageUrl(path!, p.n, version + p.image)} alt={`Page ${p.n}`} /> : <p className="muted">No image rendered for this page.</p>}</div>
                        <pre className="mcp-source">{text.trim()}</pre>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          )}

          {tab === "assistant" && (
            <div className="mcp-tab">
              <div className="mcp-tab-tools">
                <span className="muted small">
                  Returned by read_reference (the MCP tool) for this file · about {estimateTokens(view).toLocaleString()} tokens
                  {m.parts.some((p) => p.image) ? "; page images are sent separately with read_reference_pages" : ""}.
                </span>
                <button
                  onClick={async () => {
                    if (await copyText(view)) {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }
                  }}
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <pre className="mcp-source">{view}</pre>
            </div>
          )}

          {tab === "details" && (
            <div className="mcp-tab mcp-details">
              <dl>
                <dt>Source</dt>
                <dd>
                  references/{m.source.path} · {formatSize(m.source.size)} · modified {new Date(m.source.mtimeMs).toLocaleString()}
                </dd>
                <dt>SHA-256</dt>
                <dd className="mono small">{m.source.sha256}</dd>
                <dt>Converted</dt>
                <dd>
                  {new Date(m.createdAt).toLocaleString()} with {m.converter}
                </dd>
                <dt>Files</dt>
                <dd className="mono small">
                  references/.mcp/{m.source.path}/ content.md, manifest.json{m.parts.some((p) => p.image) ? `, pages/ (${m.parts.filter((p) => p.image).length})` : ""}
                </dd>
              </dl>
              {m.warnings.length > 0 && (
                <ul className="mcp-warnings">
                  {m.warnings.map((w, i) => (
                    <li key={i}>⚠ {w}</li>
                  ))}
                </ul>
              )}
              <table className="ref-list mcp-parts">
                <thead>
                  <tr>
                    <th>{m.unit === "document" ? "Part" : m.unit[0].toUpperCase() + m.unit.slice(1)}</th>
                    <th>Title</th>
                    {isPdf && <th>Content</th>}
                    <th className="num">Characters</th>
                    {isPdf && <th className="num">Images</th>}
                    {isPdf && <th>Page image</th>}
                  </tr>
                </thead>
                <tbody>
                  {m.parts.map((p) => (
                    <tr key={p.n} className={p.needsImage && !p.transcribed ? "mcp-row-warn" : undefined}>
                      <td>{p.n}</td>
                      <td>{p.title ?? ""}</td>
                      {isPdf && <td>{partKind(p)}</td>}
                      <td className="num">{p.chars.toLocaleString()}</td>
                      {isPdf && <td className="num">{p.imageCoverage ? `${Math.round(p.imageCoverage * 100)}%` : ""}</td>}
                      {isPdf && <td>{p.image ? "✓" : p.needsImage ? "needed" : ""}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </Dialog>
    </>
  );
}

export type { McpManifest };

/** The insert dialog for the inspector (kept outside the main dialog markup). */
export function McpInsertFigure(props: { source: PickedImage | null; onClose(): void; onDone(msg: string): void }) {
  return <InsertImageDialog source={props.source} preview={props.source?.figure ? mcpFigureUrl(props.source.path, props.source.figure) : undefined} onClose={props.onClose} onDone={props.onDone} />;
}
