import type { ReferenceNode } from "@sourcebook/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { api, referenceUrl } from "../api/client";
import { Dialog } from "../components/Dialog";
import { AskAiButton } from "../ai/AskAiButton";
import { ContextMenu } from "../components/ContextMenu";
import { saveBlob } from "../download";
import { PromptDialog } from "../components/PromptDialog";
import { downloadReference, formatSize } from "./ReferenceViewerDialog";
import { flattenFiles, referencesKey, useReferences } from "./ReferencesContext";
import { extOf } from "./viewers/basic";
import { viewerFor } from "./viewers";
import { McpBadge } from "./McpBadge";
import { McpInspectorDialog } from "./McpInspectorDialog";
import { InsertImageDialog } from "./InsertImageDialog";
import type { PickedImage } from "./ReferenceImagePicker";
import { IMAGE_ASSET_EXT } from "@sourcebook/shared";

type Layout = "grid" | "list";
type SortKey = "name" | "size" | "modified";
type Pending =
  | { kind: "folder" }
  | { kind: "rename"; node: ReferenceNode }
  | { kind: "delete"; nodes: ReferenceNode[] };

const DIR_KEY = "sourcebook.references.dir";
const LAYOUT_KEY = "sourcebook.references.layout";
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // ignore
    }
  },
};

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

function findDir(root: ReferenceNode | undefined, path: string): ReferenceNode | undefined {
  if (!root) return undefined;
  if (!path) return root;
  let node: ReferenceNode | undefined = root;
  for (const seg of path.split("/")) {
    node = node?.children?.find((c) => c.kind === "dir" && c.name === seg);
    if (!node) return undefined;
  }
  return node;
}

function allNodes(node: ReferenceNode | undefined): ReferenceNode[] {
  if (!node?.children) return [];
  return node.children.flatMap((c) => [c, ...allNodes(c)]);
}

const typeLabel = (n: ReferenceNode) =>
  n.kind === "dir" ? "Folder" : (viewerFor(n.name)?.label ?? (extOf(n.name) ? extOf(n.name).toUpperCase() : "File"));
const iconOf = (n: ReferenceNode) => (n.kind === "dir" ? "📁" : (viewerFor(n.name)?.icon ?? "📦"));
const isImage = (n: ReferenceNode) => n.kind === "file" && viewerFor(n.name)?.id === "image";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const formatDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";

/**
 * Drive-style file manager for references/: browse folders, open, rename, create and delete.
 * Multiple selection (Ctrl/⌘-click, Shift-click, checkboxes, Ctrl/⌘+A) for ZIP download and deletion.
 */
export function ReferencesBrowser() {
  const qc = useQueryClient();
  const { tree, open } = useReferences();
  const [dir, setDirState] = useState(() => store.get(DIR_KEY) ?? "");
  const [layout, setLayoutState] = useState<Layout>(() => (store.get(LAYOUT_KEY) === "list" ? "list" : "grid"));
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "name", asc: true });
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null); // last item clicked without Shift (range start)
  const [menu, setMenu] = useState<{ node: ReferenceNode; x: number; y: number } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLDivElement>(null);

  const current = findDir(tree, dir);
  // A folder removed or renamed elsewhere: fall back to the closest existing ancestor.
  useEffect(() => {
    if (!tree || current) return;
    let p = dir;
    while (p && !findDir(tree, p)) p = parentOf(p);
    setDir(p);
  }, [tree, current, dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSelected = (path: string | null) => {
    setSelection(path ? new Set([path]) : new Set());
    anchor.current = path;
  };

  const setDir = (path: string) => {
    setDirState(path);
    store.set(DIR_KEY, path);
    setSelected(null);
    setMenu(null);
  };
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    store.set(LAYOUT_KEY, l);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: referencesKey });
  const refreshNotebook = () => {
    void qc.invalidateQueries({ queryKey: ["block"] });
    void qc.invalidateQueries({ queryKey: ["reference-usages"] });
  };

  const searching = query.trim() !== "";
  // Files the assistant cannot read yet (still converting, failed, unsupported), across all folders.
  const notReady = (n: ReferenceNode) => n.kind === "file" && !!n.mcp && n.mcp.status !== "native" && n.mcp.status !== "ready";
  const allFiles = useMemo(() => allNodes(tree).filter((n) => n.kind === "file"), [tree]);
  const readable = allFiles.filter((n) => n.mcp && !notReady(n)).length;
  const converting = allFiles.filter((n) => ["pending", "converting", "stale"].includes(n.mcp?.status ?? "")).length;
  const [onlyNotReady, setOnlyNotReady] = useState(false);
  const flat = searching || onlyNotReady;
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [inserting, setInserting] = useState<PickedImage | null>(null);
  const isImageFile = (n: ReferenceNode) => n.kind === "file" && IMAGE_ASSET_EXT.test(n.name);
  const items = useMemo(() => {
    const source = searching
      ? allNodes(tree).filter((n) => n.name.toLowerCase().includes(query.trim().toLowerCase()) && (!onlyNotReady || notReady(n)))
      : onlyNotReady
        ? allFiles.filter(notReady)
        : (current?.children ?? []);
    const dirFactor = (n: ReferenceNode) => (n.kind === "dir" ? 0 : 1);
    const cmp = (a: ReferenceNode, b: ReferenceNode) => {
      const byKind = dirFactor(a) - dirFactor(b);
      if (byKind) return byKind;
      const v =
        sort.key === "size"
          ? (a.size ?? 0) - (b.size ?? 0)
          : sort.key === "modified"
            ? (a.modified ?? "").localeCompare(b.modified ?? "")
            : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      return sort.asc ? v : -v;
    };
    return [...source].sort(cmp);
  }, [tree, current, searching, query, sort, onlyNotReady, allFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep only visible items selected (navigation, search, deletions elsewhere).
  useEffect(() => {
    setSelection((s) => {
      const visible = new Set(items.map((n) => n.path));
      const next = new Set([...s].filter((p) => visible.has(p)));
      return next.size === s.size ? s : next;
    });
  }, [items]);

  const selectedNodes = items.filter((n) => selection.has(n.path));
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;

  const toggle = (path: string) => {
    setSelection((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    anchor.current = path;
  };

  const clickItem = (n: ReferenceNode, e: MouseEvent) => {
    const additive = e.ctrlKey || e.metaKey;
    const from = items.findIndex((i) => i.path === anchor.current);
    if (e.shiftKey && from !== -1) {
      const to = items.findIndex((i) => i.path === n.path);
      const range = items.slice(Math.min(from, to), Math.max(from, to) + 1).map((i) => i.path);
      setSelection(new Set([...(additive ? selection : []), ...range]));
    } else if (additive) toggle(n.path);
    else setSelected(n.path);
  };

  const selectAll = () => {
    setSelection(new Set(items.map((n) => n.path)));
    anchor.current = items[0]?.path ?? null;
  };

  /** One file downloads directly; folders or several items become a ZIP. */
  const download = async (nodes: ReferenceNode[]) => {
    setMenu(null);
    if (nodes.length === 1 && nodes[0].kind === "file") return downloadReference(nodes[0].path);
    setStatus({ text: `Preparing a ZIP of ${plural(nodes.length, "item")}…` });
    try {
      const { blob, name } = await api.zipReferences(nodes.map((n) => n.path), flat ? "" : dir);
      saveBlob(blob, name);
      setStatus({ text: `Downloaded ${name} (${formatSize(blob.size)})` });
    } catch (e) {
      setStatus({ text: (e as Error).message, error: true });
    }
  };

  /** Converts files (or folders) to Markdown for the assistant now. */
  const convertNow = async (nodes: ReferenceNode[], force: boolean) => {
    setMenu(null);
    setStatus({ text: `Converting ${plural(nodes.length, "item")} for the assistant…` });
    try {
      const { results } = await api.convertReferences(nodes.map((n) => n.path), force);
      const failed = results.filter((r) => r.status === "failed");
      setStatus({
        text: results.length
          ? `Converted ${plural(results.length - failed.length, "file")} to Markdown${failed.length ? `; ${failed.length} failed (${failed.map((r) => r.path.split("/").pop()).join(", ")})` : ""}.`
          : "Nothing to convert: these files are read by the assistant as they are.",
        error: failed.length > 0,
      });
      await refresh();
    } catch (e) {
      setStatus({ text: (e as Error).message, error: true });
    }
  };
  const convertible = (nodes: ReferenceNode[]) => nodes.some((n) => n.kind === "dir" || n.mcp?.kind === "markdown");

  const openNode = (n: ReferenceNode) => {
    if (n.kind === "dir") {
      setQuery("");
      setDir(n.path);
    } else open(n.path);
  };

  const upload = async (target: string, files: File[]) => {
    if (!files.length) return;
    setStatus({ text: `Uploading ${files.length} file${files.length > 1 ? "s" : ""}…` });
    try {
      const { paths } = await api.uploadReferences(target, files);
      setStatus({ text: `Uploaded ${paths.map((p) => p.split("/").pop()).join(", ")} to references/${target}` });
      await refresh();
      if (target === dir && paths[0]) setSelected(paths[0]);
    } catch (e) {
      setStatus({ text: (e as Error).message, error: true });
      refresh();
    }
  };

  const submitPending = async (value: string) => {
    if (!pending) return;
    setDialogError(null);
    try {
      if (pending.kind === "folder") {
        const { path } = await api.createReferenceFolder(dir ? `${dir}/${value}` : value);
        await refresh();
        setSelected(path);
      } else if (pending.kind === "rename") {
        const old = pending.node.path;
        const { path } = await api.renameReference(old, value);
        await refresh();
        refreshNotebook(); // associations and links in the text follow the rename
        if (dir === old || dir.startsWith(`${old}/`)) setDir(path + dir.slice(old.length));
        setSelected(path);
      } else {
        const { deleted } = await api.deleteReferences(pending.nodes.map((n) => n.path));
        await refresh();
        refreshNotebook();
        setSelected(null);
        setStatus({ text: `Deleted ${deleted.length === 1 ? deleted[0].split("/").pop() : plural(deleted.length, "item")}` });
      }
      setPending(null);
      area.current?.focus();
    } catch (e) {
      setDialogError((e as Error).message);
    }
  };

  const ask = (p: Pending) => {
    setMenu(null);
    setDialogError(null);
    setPending(p);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input:not([type=checkbox]), textarea, select")) return;
    if (e.key === "Backspace" && dir && !searching) setDir(parentOf(dir));
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") selectAll();
    else if (e.key === "Escape" && selection.size) setSelected(null);
    else if (e.key === "Delete" && selectedNodes.length) ask({ kind: "delete", nodes: selectedNodes });
    else if (e.key === "Enter" && selectedNode) openNode(selectedNode);
    else if (e.key === "F2" && selectedNode) ask({ kind: "rename", node: selectedNode });
    else return;
    e.preventDefault();
  };

  const moveSelection = (delta: number) => {
    const i = items.findIndex((n) => n.path === anchor.current);
    const next = items[Math.max(0, Math.min(items.length - 1, i === -1 ? 0 : i + delta))];
    if (next) setSelected(next.path);
  };

  const itemEvents = (n: ReferenceNode) => ({
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      clickItem(n, e);
      setMenu(null);
    },
    onDoubleClick: (e: MouseEvent) => {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) openNode(n);
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selection.has(n.path)) setSelected(n.path);
      setMenu({ node: n, x: e.clientX, y: e.clientY });
    },
    ...(n.kind === "dir"
      ? {
          onDragOver: (e: DragEvent) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
            setDropTarget(n.path);
          },
          onDragLeave: () => setDropTarget((d) => (d === n.path ? null : d)),
          onDrop: (e: DragEvent) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
            setDropTarget(null);
            upload(n.path, Array.from(e.dataTransfer.files));
          },
        }
      : {}),
  });

  const menuButton = (n: ReferenceNode) => (
    <button
      className="icon ref-more"
      title="More actions"
      aria-label={`Actions for ${n.name}`}
      onClick={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        if (!selection.has(n.path)) setSelected(n.path);
        setMenu({ node: n, x: r.right, y: r.bottom });
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      ⋮
    </button>
  );

  const crumbs = dir ? dir.split("/") : [];
  const folders = items.filter((n) => n.kind === "dir").length;
  const checkbox = (n: ReferenceNode) => (
    <input
      type="checkbox"
      className="ref-check"
      checked={selection.has(n.path)}
      aria-label={`Select ${n.name}`}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={() => toggle(n.path)}
    />
  );
  // The context menu acts on the whole selection when opened on a selected item.
  const menuTargets = menu ? (selection.has(menu.node.path) && selectedNodes.length > 1 ? selectedNodes : [menu.node]) : [];
  const deleting = pending?.kind === "delete" ? pending.nodes : null;
  const deletingFiles = deleting ? deleting.reduce((sum, n) => sum + (n.kind === "dir" ? flattenFiles(n).length : 1), 0) : 0;
  const allSelected = items.length > 0 && selectedNodes.length === items.length;
  const sortHeader = (key: SortKey, label: string) => (
    <th>
      <button className="sort" onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}>
        {label} {sort.key === key ? (sort.asc ? "▲" : "▼") : ""}
      </button>
    </th>
  );

  return (
    <div
      ref={area}
      className={`ref-browser${dropTarget === "" ? " drop" : ""}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key) && !(e.target as HTMLElement).closest("input")) {
          e.preventDefault();
          moveSelection(e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1);
          return;
        }
        onKeyDown(e);
      }}
      onClick={() => {
        setSelected(null);
        setMenu(null);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropTarget((d) => d ?? "");
      }}
      onDragLeave={(e) => {
        if (!area.current?.contains(e.relatedTarget as Node)) setDropTarget(null);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropTarget(null);
        upload(dir, Array.from(e.dataTransfer.files));
      }}
    >
      <header className="ref-browser-head">
        <nav className="crumbs" aria-label="Folder path">
          <button className={`crumb${dir ? "" : " current"}`} onClick={() => setDir("")}>
            References
          </button>
          {crumbs.map((seg, i) => {
            const path = crumbs.slice(0, i + 1).join("/");
            return (
              <span key={path} className="crumb-wrap">
                <span className="crumb-sep" aria-hidden="true">›</span>
                <button className={`crumb${path === dir ? " current" : ""}`} onClick={() => setDir(path)}>
                  {seg}
                </button>
              </span>
            );
          })}
        </nav>
        <div className="ref-browser-tools">
          <input
            className="ref-search"
            type="search"
            placeholder="Search all references"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <button onClick={(e) => (e.stopPropagation(), ask({ kind: "folder" }))}>＋ New folder</button>
          <button className="primary" onClick={(e) => (e.stopPropagation(), fileInput.current?.click())}>
            ⤒ Upload
          </button>
          <div className="segmented" role="group" aria-label="Layout">
            <button className={layout === "grid" ? "active" : ""} title="Grid" aria-pressed={layout === "grid"} onClick={(e) => (e.stopPropagation(), setLayout("grid"))}>
              ▦
            </button>
            <button className={layout === "list" ? "active" : ""} title="List" aria-pressed={layout === "list"} onClick={(e) => (e.stopPropagation(), setLayout("list"))}>
              ☰
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              upload(dir, Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
      </header>

      {allFiles.length > 0 && (
        <div className="mcp-bar" onClick={(e) => e.stopPropagation()}>
          <span className={`mcp-bar-count${readable === allFiles.length ? " all" : ""}`} title="Files the assistant can read through MCP: text and images as they are, documents converted to Markdown">
            <span className="mcp-dot" aria-hidden="true" /> {readable} of {plural(allFiles.length, "file")} readable by the assistant
          </span>
          {converting > 0 && <span className="muted small">· {converting} being converted…</span>}
          {(readable < allFiles.length || onlyNotReady) && (
            <label className="check small">
              <input type="checkbox" checked={onlyNotReady} onChange={(e) => setOnlyNotReady(e.target.checked)} />
              Show only files not readable yet
            </label>
          )}
        </div>
      )}

      <div className="ref-selection-bar" onClick={(e) => e.stopPropagation()}>
        {selectedNodes.length > 1 ? (
          <>
            <button className="icon" title="Clear selection (Esc)" aria-label="Clear selection" onClick={() => setSelected(null)}>
              ✕
            </button>
            <span className="ref-selection-name">{selectedNodes.length} selected</span>
            <button onClick={() => download(selectedNodes)}>Download ZIP</button>
            {convertible(selectedNodes) && <button onClick={() => convertNow(selectedNodes, false)}>Convert for the assistant</button>}
            <button className="danger" onClick={() => ask({ kind: "delete", nodes: selectedNodes })}>
              Delete
            </button>
            {!allSelected && (
              <button className="link" onClick={selectAll}>
                Select all {items.length}
              </button>
            )}
          </>
        ) : selectedNode ? (
          <>
            <button className="icon" title="Clear selection (Esc)" aria-label="Clear selection" onClick={() => setSelected(null)}>
              ✕
            </button>
            <span className="ref-selection-name">
              {iconOf(selectedNode)} {selectedNode.name}
            </span>
            <button onClick={() => openNode(selectedNode)}>Open</button>
            {selectedNode.kind === "file" && (
              <AskAiButton className="ask-ai-inline" label="Ask AI" target={() => ({ kind: "reference", path: selectedNode.path })} />
            )}
            <button onClick={() => download([selectedNode])}>{selectedNode.kind === "dir" ? "Download ZIP" : "Download"}</button>
            {selectedNode.mcp?.kind === "markdown" && <button onClick={() => setInspecting(selectedNode.path)}>Assistant content</button>}
            {isImageFile(selectedNode) && <button onClick={() => setInserting({ path: selectedNode.path, caption: "" })}>Insert into a section…</button>}
            <button onClick={() => ask({ kind: "rename", node: selectedNode })}>Rename</button>
            <button className="danger" onClick={() => ask({ kind: "delete", nodes: [selectedNode] })}>
              Delete
            </button>
          </>
        ) : (
          <span className="muted small">
            {searching
              ? `${plural(items.length, "result")} for “${query.trim()}”`
              : `${plural(folders, "folder")}, ${plural(items.length - folders, "file")} · double-click to open · Ctrl/⌘ or Shift + click to select several · right-click for actions · drop files to upload`}
          </span>
        )}
      </div>

      {!tree ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="ref-empty-state">
          <div className="ref-empty-icon" aria-hidden="true">{onlyNotReady && !searching ? "✅" : searching ? "🔍" : "📂"}</div>
          <p>{onlyNotReady && !searching ? "Every file is readable by the assistant." : searching ? "Nothing matches your search." : "This folder is empty."}</p>
          {!searching && <p className="muted">Drop files here, or use Upload. Specs, papers, datasets, diagrams…</p>}
        </div>
      ) : layout === "grid" ? (
        <div className={`ref-grid${selection.size ? " selecting" : ""}`} role="listbox" aria-multiselectable="true" aria-label="References">
          {items.map((n) => (
            <div
              key={n.path}
              role="option"
              aria-selected={selection.has(n.path)}
              className={`ref-card${selection.has(n.path) ? " selected" : ""}${dropTarget === n.path ? " drop" : ""}`}
              title={`references/${n.path}`}
              {...itemEvents(n)}
            >
              <div className={`ref-thumb${n.kind === "dir" ? " folder" : ""}`}>
                {checkbox(n)}
                {isImage(n) ? (
                  <img src={referenceUrl(n.path)} alt="" loading="lazy" />
                ) : (
                  <span className="ref-thumb-icon" aria-hidden="true">{iconOf(n)}</span>
                )}
              </div>
              <div className="ref-card-foot">
                <span className="ref-card-name">{n.name}</span>
                {menuButton(n)}
              </div>
              <span className="ref-card-meta muted">
                {flat && parentOf(n.path) ? `${parentOf(n.path)}/ · ` : ""}
                {n.kind === "dir" ? `${n.children?.length ?? 0} item${n.children?.length === 1 ? "" : "s"}` : formatSize(n.size)}
                {n.kind === "file" && !viewerFor(n.name) ? " · download only" : ""}
              </span>
              {n.kind === "file" && (
                <span className="ref-card-mcp">
                  <McpBadge info={n.mcp} onInspect={() => setInspecting(n.path)} />
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <table className={`ref-list${selection.size ? " selecting" : ""}`}>
          <thead>
            <tr>
              <th className="check-col">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedNodes.length > 0 && !allSelected;
                  }}
                  onChange={() => (allSelected ? setSelected(null) : selectAll())}
                  onClick={(e) => e.stopPropagation()}
                />
              </th>
              {sortHeader("name", "Name")}
              <th>Type</th>
              <th title="Whether the assistant can read the file through MCP (as it is, or converted to Markdown)">Assistant ready</th>
              {sortHeader("size", "Size")}
              {sortHeader("modified", "Modified")}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {items.map((n) => (
              <tr
                key={n.path}
                aria-selected={selection.has(n.path)}
                className={`${selection.has(n.path) ? "selected" : ""}${dropTarget === n.path ? " drop" : ""}`}
                {...itemEvents(n)}
              >
                <td className="check-col">{checkbox(n)}</td>
                <td className="ref-list-name">
                  <span aria-hidden="true">{iconOf(n)}</span> {n.name}
                  {flat && parentOf(n.path) && <span className="muted small"> — {parentOf(n.path)}/</span>}
                </td>
                <td className="muted">{typeLabel(n)}</td>
                <td>{n.kind === "file" && <McpBadge info={n.mcp} onInspect={() => setInspecting(n.path)} />}</td>
                <td className="muted num">{n.kind === "dir" ? `${n.children?.length ?? 0} items` : formatSize(n.size)}</td>
                <td className="muted">{formatDate(n.modified)}</td>
                <td>{menuButton(n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {status && (
        <p className={`ref-status small${status.error ? " render-error" : " muted"}`} onClick={(e) => e.stopPropagation()}>
          {status.text}{" "}
          <button className="link" onClick={() => setStatus(null)}>
            Dismiss
          </button>
        </p>
      )}
      {dropTarget !== null && (
        <div className="ref-drop-hint" aria-hidden="true">
          Drop to upload to references/{dropTarget || dir}
        </div>
      )}

      <McpInspectorDialog path={inspecting} onClose={() => setInspecting(null)} />
      {inserting && (
        <InsertImageDialog
          source={inserting}
          preview={referenceUrl(inserting.path)}
          onClose={() => setInserting(null)}
          onDone={(text) => setStatus({ text })}
        />
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menuTargets.length > 1 ? (
            <>
              <div className="context-menu-title">{menuTargets.length} selected</div>
              <button onClick={() => download(menuTargets)}>Download as ZIP</button>
              {convertible(menuTargets) && <button onClick={() => convertNow(menuTargets, false)}>Convert for the assistant</button>}
              <hr />
              <button className="danger" onClick={() => ask({ kind: "delete", nodes: menuTargets })}>
                Delete {menuTargets.length} items…
              </button>
            </>
          ) : (
            <>
              <button onClick={() => (setMenu(null), openNode(menu.node))}>{menu.node.kind === "dir" ? "Open folder" : "Open"}</button>
              <button onClick={() => download([menu.node])}>{menu.node.kind === "dir" ? "Download as ZIP" : "Download"}</button>
              <button onClick={() => ask({ kind: "rename", node: menu.node })}>Rename…</button>
              {isImageFile(menu.node) && <button onClick={() => (setMenu(null), setInserting({ path: menu.node.path, caption: "" }))}>Insert into a section…</button>}
              {menu.node.mcp?.kind === "markdown" && (
                <>
                  <hr />
                  <button onClick={() => (setMenu(null), setInspecting(menu.node.path))}>Assistant content…</button>
                  <button onClick={() => convertNow([menu.node], true)}>Convert again for the assistant</button>
                </>
              )}
              {menu.node.kind === "dir" && <button onClick={() => convertNow([menu.node], false)}>Convert folder for the assistant</button>}
              <hr />
              <button className="danger" onClick={() => ask({ kind: "delete", nodes: [menu.node] })}>
                Delete…
              </button>
            </>
          )}
        </ContextMenu>
      )}

      <PromptDialog
        open={pending?.kind === "folder" || pending?.kind === "rename"}
        title={pending?.kind === "rename" ? `Rename ${pending.node.kind === "dir" ? "folder" : "file"}` : "New folder"}
        label={pending?.kind === "folder" ? `Name (inside references/${dir})` : "New name"}
        initialValue={pending?.kind === "rename" ? pending.node.name : ""}
        selectStem={pending?.kind === "rename" && pending.node.kind === "file"}
        submitLabel={pending?.kind === "rename" ? "Rename" : "Create"}
        error={dialogError}
        onSubmit={submitPending}
        onClose={() => setPending(null)}
      />
      <Dialog
        open={!!deleting}
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} items?` : `Delete ${deleting?.[0]?.name ?? ""}?`}
        onClose={() => setPending(null)}
        actions={
          <>
            <button onClick={() => setPending(null)}>Cancel</button>
            <button className="danger solid" onClick={() => submitPending("")}>
              Delete
            </button>
          </>
        }
      >
        {deleting && deleting.length > 1 ? (
          <>
            <p>
              These {deleting.length} items ({plural(deletingFiles, "file")} in total) will be permanently deleted:
            </p>
            <ul className="file-list">
              {deleting.slice(0, 10).map((n) => (
                <li key={n.path}>
                  {n.kind === "dir" ? `${n.path}/ (${plural(flattenFiles(n).length, "file")})` : n.path}
                </li>
              ))}
              {deleting.length > 10 && <li>… and {deleting.length - 10} more</li>}
            </ul>
          </>
        ) : deleting?.[0]?.kind === "dir" ? (
          <p>
            The folder <strong>references/{deleting[0].path}</strong> and the {plural(deletingFiles, "file")} it contains will be
            permanently deleted.
          </p>
        ) : (
          <p>
            <strong>references/{deleting?.[0]?.path}</strong> will be permanently deleted.
          </p>
        )}
        {deleting && <ReferenceUsagesNote paths={deleting.map((n) => n.path)} />}
        {dialogError && <p className="render-error">{dialogError}</p>}
      </Dialog>
    </div>
  );
}

/** Where the files about to be deleted are used (associations are removed; links in the text break). */
function ReferenceUsagesNote({ paths }: { paths: string[] }) {
  const usages = useQuery({
    queryKey: ["reference-usages", ...paths],
    queryFn: async () => (await Promise.all(paths.map((p) => api.getReferenceUsages(p)))).flat(),
  });
  const list = usages.data ?? [];
  if (usages.isLoading) return <p className="muted small">Checking where they are used…</p>;
  if (!list.length) return <p className="muted small">Not linked or attached anywhere in the document.</p>;
  return (
    <>
      <p className="small">Used in the document:</p>
      <ul className="file-list small">
        {list.slice(0, 12).map((u, i) => (
          <li key={i}>
            {u.ref} {u.title} — {u.path.split("/").pop()} {u.kind === "text" ? "linked in the text (the link will stop working)" : "attached (removed)"}
          </li>
        ))}
        {list.length > 12 && <li>… and {list.length - 12} more</li>}
      </ul>
    </>
  );
}
