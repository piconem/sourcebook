import type { NotebookKind } from "@sourcebook/shared";
import { useSyncExternalStore } from "react";

/** App locations, kept in the URL hash so reloads and browser history work: #/projects, #/templates/<id>, … */
export type Route = { page: "home"; kind: NotebookKind } | { page: "editor"; kind: NotebookKind; id: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const kind: NotebookKind = parts[0] === "templates" ? "templates" : "projects";
  return parts[1] ? { page: "editor", kind, id: parts[1] } : { page: "home", kind };
}

export const routeHref = (r: Route) =>
  r.page === "home" ? `#/${r.kind}` : `#/${r.kind}/${encodeURIComponent(r.id)}`;

export function navigate(r: Route) {
  window.location.hash = routeHref(r);
}

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}
