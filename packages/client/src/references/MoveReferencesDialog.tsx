import type { ReferenceNode } from "@sourcebook/shared";
import { useEffect, useState } from "react";
import { Dialog } from "../components/Dialog";

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Every folder of the tree (root first), depth-first, with its depth. */
function folders(node: ReferenceNode, depth = 0): { path: string; name: string; depth: number }[] {
  const subs = (node.children ?? []).filter((c) => c.kind === "dir");
  return [{ path: node.path, name: depth === 0 ? "references" : node.name, depth }, ...subs.flatMap((c) => folders(c, depth + 1))];
}

/** Picks the folder to move files/folders into; folders being moved (and their contents) cannot be chosen. */
export function MoveReferencesDialog(props: {
  nodes: ReferenceNode[] | null;
  tree: ReferenceNode | undefined;
  error: string | null;
  onMove(dir: string): void;
  onClose(): void;
}) {
  const { nodes, tree } = props;
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => setTarget(null), [nodes]);
  const moving = nodes ?? [];
  const inside = (path: string) => moving.some((n) => n.kind === "dir" && (path === n.path || path.startsWith(`${n.path}/`)));
  // Already there: every moved item's parent is the folder.
  const already = (path: string) => moving.every((n) => parentOf(n.path) === path);
  const list = tree ? folders(tree) : [];
  return (
    <Dialog
      open={!!nodes}
      title={moving.length === 1 ? `Move ${moving[0].name}` : `Move ${moving.length} items`}
      onClose={props.onClose}
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button className="primary" disabled={target === null} onClick={() => target !== null && props.onMove(target)}>
            Move here
          </button>
        </>
      }
    >
      <p className="small">Choose the destination folder. Links and associations in the document follow the files.</p>
      <ul className="ref-move-list" role="listbox" aria-label="Destination folder">
        {list.map((f) => {
          const disabled = inside(f.path) || already(f.path);
          return (
            <li key={f.path || "/"}>
              <button
                role="option"
                aria-selected={target === f.path}
                className={target === f.path ? "selected" : ""}
                disabled={disabled}
                style={{ paddingLeft: 8 + f.depth * 16 }}
                title={disabled ? (inside(f.path) ? "Cannot move a folder inside itself" : "Already in this folder") : `references/${f.path}`}
                onClick={() => setTarget(f.path)}
                onDoubleClick={() => !disabled && props.onMove(f.path)}
              >
                📁 {f.name}
              </button>
            </li>
          );
        })}
      </ul>
      {props.error && <p className="render-error">{props.error}</p>}
    </Dialog>
  );
}
