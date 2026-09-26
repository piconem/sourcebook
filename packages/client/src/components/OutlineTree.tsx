import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@sourcebook/shared";
import { useMemo, useState } from "react";
import { api } from "../api/client";
import { keys } from "../api/queries";
import { applyDrop, descendantsOf, getProjection, outlineNumbers, withDepth, type FlatItem } from "../tree";

const INDENT = 18;

function Row(props: { item: FlatItem; number: string; depth: number; selected: boolean; onSelect(): void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.item.id });
  return (
    <li
      ref={setNodeRef}
      className={`tree-row${props.selected ? " selected" : ""}${isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition, paddingLeft: 8 + props.depth * INDENT }}
      onClick={props.onSelect}
      {...attributes}
      {...listeners}
    >
      <span className="num">{props.number}</span>
      <span className="title">{props.item.title}</span>
    </li>
  );
}

export function OutlineTree(props: { project: Project; selectedId: string | null; onSelect(id: string): void }) {
  const qc = useQueryClient();
  const all = useMemo(() => withDepth(props.project.blocks), [props.project]);
  const numbers = useMemo(() => outlineNumbers(all), [all]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // While dragging, the dragged block's subtree travels with it and is hidden from the list.
  const visible = useMemo(() => {
    if (!activeId) return all;
    const hidden = descendantsOf(all, activeId);
    return all.filter((i) => !hidden.has(i.id));
  }, [all, activeId]);
  const projection =
    activeId && overId ? getProjection(visible, activeId, overId, offsetX, INDENT) : null;

  const reset = () => {
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    const proj = projection;
    reset();
    if (!over || !proj) return;
    const placement = applyDrop(all, String(active.id), String(over.id), proj.parentId);
    const unchanged = placement.every((p, i) => p.id === all[i].id && p.parentId === all[i].parentId);
    if (unchanged) return;
    // Optimistic: reorder locally, then let the server renumber folders.
    const byId = new Map(props.project.blocks.map((b) => [b.id, b]));
    qc.setQueryData<Project>(keys.project, {
      ...props.project,
      blocks: placement.map((p) => ({ ...byId.get(p.id)!, parentId: p.parentId })),
    });
    try {
      qc.setQueryData(keys.project, await api.reorderBlocks({ blocks: placement }));
    } finally {
      qc.invalidateQueries({ queryKey: keys.project });
      qc.invalidateQueries({ queryKey: ["block"] });
    }
  };

  const active = activeId ? all.find((i) => i.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active: a }: DragStartEvent) => (setActiveId(String(a.id)), setOverId(String(a.id)))}
      onDragMove={({ delta }: DragMoveEvent) => setOffsetX(delta.x)}
      onDragOver={({ over }) => setOverId(over ? String(over.id) : null)}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
    >
      <SortableContext items={visible.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="tree">
          {visible.map((item) => (
            <Row
              key={item.id}
              item={item}
              number={numbers.get(item.id)!}
              depth={item.id === activeId && projection ? projection.depth : item.depth}
              selected={item.id === props.selectedId}
              onSelect={() => props.onSelect(item.id)}
            />
          ))}
        </ul>
      </SortableContext>
      <DragOverlay>
        {active && (
          <div className="tree-row overlay">
            <span className="num">{numbers.get(active.id)}</span>
            <span className="title">{active.title}</span>
            {descendantsOf(all, active.id).size > 0 && (
              <span className="badge">+{descendantsOf(all, active.id).size}</span>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
