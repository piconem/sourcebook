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
import type { Notification, Project } from "@sourcebook/shared";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { api } from "../api/client";
import { keys, useNotifications } from "../api/queries";
import { BellIcon } from "../notifications/NotificationsButton";
import type { Target } from "../router";
import { ancestorsOf, applyDrop, descendantsOf, getProjection, hiddenByCollapse, outlineNumbers, withDepth, type FlatItem } from "../tree";

const INDENT = 18;

const storage = {
  get(key: string): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  },
  set(key: string, ids: string[]) {
    try {
      localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      // per-browser convenience only
    }
  },
};

/** Unread notifications about a section (or its sub-blocks / comments), and whether they are about it directly. */
interface SectionNews {
  own: Notification[];
  /** In hidden sub-sections (the section is collapsed). */
  nested: Notification[];
}

function Row(props: {
  item: FlatItem;
  number: string;
  depth: number;
  selected: boolean;
  /** undefined: no sub-sections. */
  collapsed?: boolean;
  news?: SectionNews;
  onSelect(): void;
  onToggle(): void;
  onOpenNews(): void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.item.id });
  const news = props.news;
  const count = news ? new Set([...news.own, ...news.nested].map((n) => n.id)).size : 0;
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <li
      ref={setNodeRef}
      className={`tree-row${props.selected ? " selected" : ""}${isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition, paddingLeft: 8 + props.depth * INDENT }}
      onClick={props.onSelect}
      {...attributes}
      {...listeners}
    >
      {props.collapsed === undefined ? (
        <span className="tree-toggle-space" aria-hidden="true" />
      ) : (
        <button
          className={`tree-toggle${props.collapsed ? " collapsed" : ""}`}
          aria-label={props.collapsed ? `Expand ${props.item.title}` : `Collapse ${props.item.title}`}
          aria-expanded={!props.collapsed}
          title={props.collapsed ? "Expand sub-sections" : "Collapse sub-sections"}
          onPointerDown={stop}
          onClick={(e) => (stop(e), props.onToggle())}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <span className="num">{props.number}</span>
      <span className="title">{props.item.title}</span>
      {count > 0 && (
        <button
          className={`tree-news${news!.own.length ? "" : " nested"}`}
          title={`${count} unread notification${count === 1 ? "" : "s"}${news!.own.length ? "" : " in sub-sections"}:\n${[...news!.own, ...news!.nested]
            .filter((n, i, list) => list.findIndex((m) => m.id === n.id) === i)
            .map((n) => `• ${n.author.name}: ${n.summary}`)
            .join("\n")}\nClick to go to the changed part (again for the next one)`}
          aria-label={`${count} unread notification${count === 1 ? "" : "s"}`}
          onPointerDown={stop}
          onClick={(e) => (stop(e), props.onOpenNews())}
        >
          <BellIcon />
          {count > 1 && <span>{count > 9 ? "9+" : count}</span>}
        </button>
      )}
    </li>
  );
}

export function OutlineTree(props: {
  project: Project;
  /** Where the collapsed sections are remembered (per browser), e.g. "projects/<id>". */
  storageKey: string;
  selectedId: string | null;
  onSelect(id: string): void;
  /** Goes to a changed part (sub-block or comment) from a notification badge. */
  onGoTo(t: Target): void;
}) {
  const qc = useQueryClient();
  const all = useMemo(() => withDepth(props.project.blocks), [props.project]);
  const numbers = useMemo(() => outlineNumbers(all), [all]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const collapseKey = `sourcebook.outline.collapsed.${props.storageKey}`;
  const [collapsed, setCollapsedState] = useState<ReadonlySet<string>>(() => new Set(storage.get(collapseKey)));
  useEffect(() => setCollapsedState(new Set(storage.get(collapseKey))), [collapseKey]);
  const setCollapsed = (next: Set<string>) => {
    setCollapsedState(next);
    storage.set(collapseKey, [...next]);
  };
  const parents = useMemo(() => new Set(all.map((i) => i.parentId).filter((p): p is string => !!p)), [all]);
  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };
  // Reveal the selected section (e.g. reached from a notification or a link) when it is inside a collapsed one.
  useEffect(() => {
    if (!props.selectedId) return;
    const closed = ancestorsOf(all, props.selectedId).filter((a) => collapsed.has(a));
    if (closed.length) setCollapsed(new Set([...collapsed].filter((c) => !closed.includes(c))));
  }, [props.selectedId, all]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unread notifications per section; a collapsed section also shows those of its hidden sub-sections.
  const { data: notifications = [] } = useNotifications();
  const hiddenIds = useMemo(() => hiddenByCollapse(all, collapsed), [all, collapsed]);
  const news = useMemo(() => {
    const map = new Map<string, SectionNews>();
    const entry = (id: string) => map.get(id) ?? (map.set(id, { own: [], nested: [] }), map.get(id)!);
    for (const n of notifications) {
      if (n.read) continue;
      for (const blockId of new Set(n.targets.map((t) => t.blockId))) {
        if (!numbers.has(blockId)) continue;
        if (!hiddenIds.has(blockId)) entry(blockId).own.push(n);
        else {
          const shown = ancestorsOf(all, blockId).find((a) => !hiddenIds.has(a));
          if (shown) entry(shown).nested.push(n);
        }
      }
    }
    return map;
  }, [notifications, all, numbers, hiddenIds]);
  // The badge only navigates: notifications are marked read from the bell on the block or the top-bar menu.
  // Repeated clicks go through the changed parts of the section (and of its hidden sub-sections) in turn.
  const newsTurn = useRef(new Map<string, number>());
  const openNews = (id: string) => {
    const n = news.get(id);
    const inside = new Set([id, ...descendantsOf(all, id)]);
    const targets: Target[] = [];
    for (const item of [...(n?.own ?? []), ...(n?.nested ?? [])]) {
      for (const t of item.targets) {
        if (!inside.has(t.blockId)) continue;
        const target: Target = { sectionId: t.blockId, ...(t.subBlockId ? { subBlockId: t.subBlockId } : {}), ...(t.commentId ? { commentId: t.commentId } : {}) };
        if (!targets.some((x) => JSON.stringify(x) === JSON.stringify(target))) targets.push(target);
      }
    }
    if (!targets.length) return props.onSelect(id);
    const turn = newsTurn.current.get(id) ?? 0;
    newsTurn.current.set(id, turn + 1);
    props.onGoTo(targets[turn % targets.length]);
  };

  // Collapsed sub-sections are hidden; while dragging, the dragged block's subtree travels with it too.
  const visible = useMemo(() => {
    const hidden = new Set(hiddenIds);
    if (activeId) for (const id of descendantsOf(all, activeId)) hidden.add(id);
    return all.filter((i) => !hidden.has(i.id));
  }, [all, activeId, hiddenIds]);
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
      {parents.size > 0 && (
        <div className="tree-tools">
          <button className="link small" onClick={() => setCollapsed(new Set())} disabled={collapsed.size === 0}>
            Expand all
          </button>
          <button className="link small" onClick={() => setCollapsed(new Set(parents))} disabled={[...parents].every((p) => collapsed.has(p))}>
            Collapse all
          </button>
        </div>
      )}
      <SortableContext items={visible.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="tree">
          {visible.map((item) => (
            <Row
              key={item.id}
              item={item}
              number={numbers.get(item.id)!}
              depth={item.id === activeId && projection ? projection.depth : item.depth}
              selected={item.id === props.selectedId}
              collapsed={parents.has(item.id) ? collapsed.has(item.id) : undefined}
              news={news.get(item.id)}
              onSelect={() => props.onSelect(item.id)}
              onToggle={() => toggle(item.id)}
              onOpenNews={() => openNews(item.id)}
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
