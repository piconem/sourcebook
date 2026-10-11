import type { NotebookKind } from "@sourcebook/shared";
import { useSyncExternalStore } from "react";

/** A place inside a project: a section, optionally one of its sub-blocks and one of that sub-block's comments. */
export interface Target {
  sectionId: string;
  subBlockId?: string;
  commentId?: string;
}

/**
 * App locations, kept in the URL hash so reloads, browser history and shared links work:
 * #/projects, #/templates/<id>, #/projects/<id>/s/<sectionId>/b/<subBlockId>/c/<commentId>, …
 * Ids (not outline numbers) are used so links survive moving and renumbering sections.
 */
export type Route = { page: "home"; kind: NotebookKind } | { page: "editor"; kind: NotebookKind; id: string; target?: Target };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const kind: NotebookKind = parts[0] === "templates" ? "templates" : "projects";
  if (!parts[1]) return { page: "home", kind };
  const route: Route = { page: "editor", kind, id: parts[1] };
  const seg = new Map<string, string>();
  for (let i = 2; i + 1 < parts.length; i += 2) seg.set(parts[i], parts[i + 1]);
  const sectionId = seg.get("s");
  if (sectionId) {
    const subBlockId = seg.get("b");
    const commentId = subBlockId ? seg.get("c") : undefined;
    route.target = { sectionId, ...(subBlockId ? { subBlockId } : {}), ...(commentId ? { commentId } : {}) };
  }
  return route;
}

export function routeHref(r: Route): string {
  if (r.page === "home") return `#/${r.kind}`;
  let href = `#/${r.kind}/${encodeURIComponent(r.id)}`;
  const t = r.target;
  if (t) {
    href += `/s/${encodeURIComponent(t.sectionId)}`;
    if (t.subBlockId) {
      href += `/b/${encodeURIComponent(t.subBlockId)}`;
      if (t.commentId) href += `/c/${encodeURIComponent(t.commentId)}`;
    }
  }
  return href;
}

/** Full URL of a location (for "Copy link"). */
export const absoluteHref = (r: Route) => `${window.location.origin}${window.location.pathname}${routeHref(r)}`;

export function navigate(r: Route) {
  window.location.hash = routeHref(r);
}

/** Records a location without a hashchange event (the caller already shows it). */
export function recordRoute(r: Route, { replace = false } = {}) {
  const href = routeHref(r);
  if (window.location.hash === href) return;
  if (replace) window.history.replaceState(window.history.state, "", href);
  else window.history.pushState(window.history.state, "", href);
}

/** Stable string for a target (to tell whether it changed). */
export const targetKey = (t: Target | undefined) => (t ? [t.sectionId, t.subBlockId ?? "", t.commentId ?? ""].join("/") : "");

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  window.addEventListener("popstate", cb);
  return () => {
    window.removeEventListener("hashchange", cb);
    window.removeEventListener("popstate", cb);
  };
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}
