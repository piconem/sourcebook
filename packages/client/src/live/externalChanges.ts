import type { NotebookEvent } from "@sourcebook/shared";
import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useSyncExternalStore } from "react";
import { CLIENT_ID, notebookBase } from "../api/client";
import { keys } from "../api/queries";
import { referencesKey } from "../references/ReferencesContext";
import { bibliographyKey } from "../bibliography/BibliographyContext";

/** Latest external content change per sub-block (revision and who made it). */
export class ExternalChanges {
  private changes = new Map<string, { rev: number; origin: string }>();
  private listeners = new Set<() => void>();
  record(subBlockId: string, rev: number, origin: string) {
    this.changes.set(subBlockId, { rev, origin });
    this.listeners.forEach((l) => l());
  }
  get = (subBlockId: string) => this.changes.get(subBlockId);
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const ExternalChangesContext = createContext<ExternalChanges | null>(null);

export function useExternalChange(subBlockId: string) {
  const store = useContext(ExternalChangesContext);
  return useSyncExternalStore(store?.subscribe ?? (() => () => {}), () => store?.get(subBlockId));
}

/** "the assistant", "another window", … for an event origin. */
export const originLabel = (origin: string | undefined) =>
  origin === "mcp" ? "the assistant" : origin?.startsWith("web-") ? "another window" : "another client";

/**
 * Subscribes to the open project's live events: data changed elsewhere (another tab, the assistant via
 * MCP, a script) is refetched; sub-block content changes are recorded for conflict handling.
 * Returns an unsubscribe function.
 */
export function subscribeProjectEvents(qc: QueryClient, changes: ExternalChanges, onReload?: (ev: NotebookEvent) => void): () => void {
  if (typeof EventSource === "undefined") return () => {};
  const es = new EventSource(`${notebookBase()}/events`);
  es.onmessage = (m) => {
    let ev: NotebookEvent;
    try {
      ev = JSON.parse(m.data);
    } catch {
      return;
    }
    if (ev.type === "notifications") {
      // Also from this tab: other components (e.g. the menu in another window) follow the read state.
      void qc.invalidateQueries({ queryKey: keys.notifications });
      return;
    }
    if (ev.type === "reload") {
      void qc.invalidateQueries({ queryKey: keys.notifications });
      onReload?.(ev);
      return;
    }
    if (ev.origin === CLIENT_ID) return;
    if (ev.type === "blocks" || ev.type === "block") {
      void qc.invalidateQueries({ queryKey: keys.project });
      void qc.invalidateQueries({ queryKey: keys.projectComments });
      if (ev.blockId) void qc.invalidateQueries({ queryKey: keys.block(ev.blockId) });
    } else if (ev.type === "subblock" && ev.blockId && ev.subBlockId) {
      changes.record(ev.subBlockId, ev.rev ?? 0, ev.origin);
      void qc.invalidateQueries({ queryKey: keys.block(ev.blockId) });
    } else if (ev.type === "comments" && ev.blockId && ev.subBlockId) {
      void qc.invalidateQueries({ queryKey: keys.comments(ev.blockId, ev.subBlockId) });
      void qc.invalidateQueries({ queryKey: keys.projectComments });
      void qc.invalidateQueries({ queryKey: keys.block(ev.blockId) });
    } else if (ev.type === "references") {
      void qc.invalidateQueries({ queryKey: referencesKey });
      void qc.invalidateQueries({ queryKey: ["mcp-content"] });
    } else if (ev.type === "bibliography") {
      void qc.invalidateQueries({ queryKey: bibliographyKey });
      void qc.invalidateQueries({ queryKey: ["bibliography-usages"] });
    }
  };
  return () => es.close();
}
