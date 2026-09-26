import type { Project } from "@sourcebook/shared";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { outlineNumbers, withDepth } from "../tree";
import { BlockView } from "./BlockView";

const hasIO = () => typeof IntersectionObserver !== "undefined";

/** Mounts its content when it comes near the viewport (then keeps it mounted). */
function LazySection(props: { id: string; root: RefObject<HTMLElement | null>; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(!hasIO());
  useEffect(() => {
    if (mounted || !ref.current) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setMounted(true), {
      root: props.root.current,
      rootMargin: "1200px 0px",
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [mounted, props.root]);
  return (
    <section ref={ref} id={`block-${props.id}`} data-block-id={props.id} className={`doc-section${mounted ? "" : " pending"}`}>
      {mounted ? props.children : null}
    </section>
  );
}

/** Scrolls a section to the top of the scroll area, re-adjusting while sections above finish mounting. */
export function scrollToSection(id: string, root: HTMLElement | null) {
  const target = () => document.getElementById(`block-${id}`);
  let tries = 0;
  const step = () => {
    const el = target();
    if (!el || !root) return;
    const offset = el.getBoundingClientRect().top - root.getBoundingClientRect().top;
    if (Math.abs(offset) > 2) root.scrollBy({ top: offset });
    if (++tries < 12) setTimeout(step, 60);
  };
  target()?.scrollIntoView({ block: "start" });
  setTimeout(step, 30);
}

/**
 * The whole notebook as one scrolling document. Reports the section at the top of the view (scroll spy)
 * and scrolls to a section when `scrollTo` changes.
 */
export function DocumentView(props: {
  project: Project;
  scrollRoot: RefObject<HTMLElement | null>;
  /** Changes to request a scroll ({ id, seq } so the same id can be requested twice). */
  scrollTo: { id: string; seq: number } | null;
  onCurrentChange(id: string): void;
}) {
  const { project, scrollRoot } = props;
  const numbers = useMemo(() => outlineNumbers(withDepth(project.blocks)), [project.blocks]);
  const depths = useMemo(() => new Map(withDepth(project.blocks).map((b) => [b.id, b.depth])), [project.blocks]);
  const suppressSpyUntil = useRef(0);
  const onCurrent = useRef(props.onCurrentChange);
  onCurrent.current = props.onCurrentChange;

  useEffect(() => {
    if (!props.scrollTo) return;
    suppressSpyUntil.current = Date.now() + 900;
    scrollToSection(props.scrollTo.id, scrollRoot.current);
  }, [props.scrollTo, scrollRoot]);

  // Scroll spy: the first section (in document order) crossing the top third of the view is "current".
  const order = project.blocks.map((b) => b.id).join();
  useEffect(() => {
    const root = scrollRoot.current;
    if (!root || !hasIO()) return;
    const visible = new Set<string>();
    const ids = order.split(",");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.blockId!;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        if (Date.now() < suppressSpyUntil.current) return;
        const first = ids.find((id) => visible.has(id));
        if (first) onCurrent.current(first);
      },
      { root, rootMargin: "0px 0px -66% 0px" },
    );
    root.querySelectorAll(".doc-section").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [order, scrollRoot]);

  if (!project.blocks.length) return <p className="muted">No sections yet — create one with “+ Section”.</p>;
  return (
    <div className="document-view">
      {project.blocks.map((b) => (
        <LazySection key={b.id} id={b.id} root={scrollRoot}>
          <BlockView blockId={b.id} number={numbers.get(b.id)} depth={depths.get(b.id) ?? 0} onDeleted={() => {}} />
        </LazySection>
      ))}
    </div>
  );
}
