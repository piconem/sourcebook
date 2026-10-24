import { arrayMove } from "@dnd-kit/sortable";

import type { FlatItem } from "@sourcebook/shared";

export { outlineNumbers, withDepth, type FlatItem } from "@sourcebook/shared";

export function descendantsOf(items: FlatItem[], id: string): Set<string> {
  const result = new Set<string>();
  const index = items.findIndex((i) => i.id === id);
  const depth = items[index]?.depth ?? 0;
  for (let i = index + 1; i < items.length && items[i].depth > depth; i++) result.add(items[i].id);
  return result;
}

/**
 * Projected depth/parent of the dragged item (dnd-kit "sortable tree" pattern):
 * horizontal offset changes nesting, bounded by neighbours so the outline stays valid.
 * `items` must exclude the dragged item's descendants.
 */
export function getProjection(items: FlatItem[], activeId: string, overId: string, offsetX: number, indent: number) {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const moved = arrayMove(items, activeIndex, overIndex);
  const prev = moved[overIndex - 1];
  const next = moved[overIndex + 1];
  const projected = items[activeIndex].depth + Math.round(offsetX / indent);
  const maxDepth = prev ? prev.depth + 1 : 0;
  const minDepth = next ? next.depth : 0;
  const depth = Math.min(Math.max(projected, minDepth), maxDepth);

  let parentId: string | null = null;
  if (depth > 0 && prev) {
    if (depth === prev.depth) parentId = prev.parentId;
    else if (depth > prev.depth) parentId = prev.id;
    else parentId = moved.slice(0, overIndex).reverse().find((i) => i.depth === depth)?.parentId ?? null;
  }
  return { depth, parentId };
}

/** Applies a drop: moves `activeId` (with its subtree) and returns the full depth-first placement list. */
export function applyDrop(all: FlatItem[], activeId: string, overId: string, parentId: string | null) {
  const subtree = descendantsOf(all, activeId);
  const visible = all.filter((i) => !subtree.has(i.id));
  const from = visible.findIndex((i) => i.id === activeId);
  const to = visible.findIndex((i) => i.id === overId);
  const moved = arrayMove(visible, from, to).map((i) => (i.id === activeId ? { ...i, parentId } : i));
  const at = moved.findIndex((i) => i.id === activeId);
  moved.splice(at + 1, 0, ...all.filter((i) => subtree.has(i.id)));
  // Dropping next to a collapsed section can land between it and its hidden children: regroup depth-first.
  return depthFirst(moved.map(({ id, parentId: p }) => ({ id, parentId: p })));
}

/** Depth-first order of a placement list, keeping the relative order of siblings. */
export function depthFirst(list: { id: string; parentId: string | null }[]) {
  const children = new Map<string | null, string[]>();
  for (const i of list) children.set(i.parentId, [...(children.get(i.parentId) ?? []), i.id]);
  const out: { id: string; parentId: string | null }[] = [];
  const visit = (p: string | null) => {
    for (const id of children.get(p) ?? []) {
      out.push({ id, parentId: p });
      visit(id);
    }
  };
  visit(null);
  return out;
}

/** Items hidden because an ancestor is collapsed. */
export function hiddenByCollapse(items: FlatItem[], collapsed: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>();
  for (const i of items) if (i.parentId && (collapsed.has(i.parentId) || hidden.has(i.parentId))) hidden.add(i.id);
  return hidden;
}

/** Ancestors of `id`, nearest first. */
export function ancestorsOf(items: FlatItem[], id: string): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: string[] = [];
  for (let p = byId.get(id)?.parentId; p; p = byId.get(p)?.parentId) out.push(p);
  return out;
}
