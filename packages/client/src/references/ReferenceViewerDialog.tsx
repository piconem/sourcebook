import type { ReferenceNode } from "@sourcebook/shared";
import { Suspense, useEffect, useState } from "react";
import { referenceUrl } from "../api/client";
import { CodeMirror } from "../components/CodeMirror";
import { Dialog } from "../components/Dialog";
import { extOf } from "./viewers/basic";
import { MAX_TEXT_PREVIEW, viewerFor } from "./viewers";

export const formatSize = (n?: number) =>
  n === undefined ? "" : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

export function downloadReference(path: string) {
  const a = Object.assign(document.createElement("a"), { href: referenceUrl(path, true), download: path.split("/").pop() });
  a.click();
}

export function ReferenceViewerDialog({ node, missing, onClose }: { node: ReferenceNode | null; missing: boolean; onClose(): void }) {
  const viewer = node ? viewerFor(node.name) : undefined;
  const tooLarge = !!viewer?.needsText && (node?.size ?? 0) > MAX_TEXT_PREVIEW;
  const [text, setText] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "source">("preview");

  useEffect(() => {
    setText(undefined);
    setError(null);
    setTab("preview");
    if (!node || !viewer?.needsText || tooLarge || missing) return;
    let cancelled = false;
    fetch(referenceUrl(node.path))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((t) => !cancelled && setText(t), (e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [node?.path, node?.modified, viewer, tooLarge, missing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!node) return <Dialog open={false} title="" onClose={onClose}>{null}</Dialog>;

  const download = <button onClick={() => downloadReference(node.path)}>Download</button>;

  // Not previewable (or missing / too large): an informative popup instead of the viewer.
  if (missing || !viewer || tooLarge) {
    return (
      <Dialog open title={node.name} onClose={onClose} actions={<>{!missing && download}<button className="primary" onClick={onClose}>OK</button></>}>
        {missing ? (
          <p>
            <strong>references/{node.path}</strong> does not exist (it may have been renamed or deleted).
          </p>
        ) : tooLarge ? (
          <p>
            This file is {formatSize(node.size)}: previews are limited to {formatSize(MAX_TEXT_PREVIEW)}. Download it to open
            it with an application on your computer.
          </p>
        ) : (
          <>
            <p>
              <strong>.{extOf(node.name) || "(no extension)"}</strong> files can't be previewed in the browser.
            </p>
            <p className="muted">
              Office documents, archives and other binary formats need an application on your computer: download the
              file to open it.
            </p>
          </>
        )}
      </Dialog>
    );
  }

  const View = viewer.component;
  const url = referenceUrl(node.path);
  const ready = !viewer.needsText || text !== undefined;
  return (
    <Dialog
      open
      wide
      title={node.name}
      onClose={onClose}
      actions={
        <>
          <span className="muted small">
            references/{node.path} · {viewer.label} · {formatSize(node.size)}
          </span>
          <a className="button-like" href={url} target="_blank" rel="noreferrer">
            Open in new tab
          </a>
          {download}
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {viewer.source && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>
            Preview
          </button>
          <button role="tab" aria-selected={tab === "source"} className={tab === "source" ? "active" : ""} onClick={() => setTab("source")}>
            Source
          </button>
        </div>
      )}
      <div className="ref-viewer">
        {error && <p className="render-error">Could not load the file: {error}</p>}
        {!error && !ready && <p className="muted">Loading…</p>}
        {!error && ready && tab === "source" && (
          <CodeMirror key={node.path} initialValue={text ?? ""} ext={extOf(node.name)} readOnly maxHeight="none" />
        )}
        {!error && ready && tab === "preview" && (
          <Suspense fallback={<p className="muted">Loading viewer…</p>}>
            <View key={node.path} node={node} url={url} text={text} />
          </Suspense>
        )}
      </div>
    </Dialog>
  );
}
