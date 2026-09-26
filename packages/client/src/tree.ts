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
  return moved.map(({ id, parentId: p }) => ({ id, parentId: p }));
}
