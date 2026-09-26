import type { CommentAnchor } from "@sourcebook/shared";
import { useSyncExternalStore } from "react";

export interface AnchorStatus {
  attached: boolean;
  /** For line anchors: current 1-based line numbers. */
  lines?: { first: number; last: number };
}

export interface BridgeState {
  /** Comment highlighted in both the editor and the comments column. */
  activeId: string | null;
  status: ReadonlyMap<string, AnchorStatus>;
}

/**
 * Per-sub-block link between a text editor (which knows where anchored comments are) and the comments
 * column (which lists them). The editor registers the capabilities; the column and BlockView call them.
 */
export class CommentBridge {
  private state: BridgeState = { activeId: null, status: new Map() };
  private listeners = new Set<() => void>();

  // Provided by the editor (text-based sub-blocks only).
  selectionAnchor: (() => CommentAnchor | null) | null = null;
  reveal: ((commentId: string) => void) | null = null;
  /** Called after the sub-block content was saved: refresh stored anchors that moved or changed. */
  onSaved: (() => Promise<void>) | null = null;

  // Provided by BlockView.
  requestComment: ((anchor: CommentAnchor) => void) | null = null;
  openPanel: (() => void) | null = null;

  get supportsAnchors() {
    return this.selectionAnchor !== null;
  }

  getSnapshot = () => this.state;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private emit(next: BridgeState) {
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  setActive(activeId: string | null) {
    if (activeId !== this.state.activeId) this.emit({ ...this.state, activeId });
  }

  setStatus(status: Map<string, AnchorStatus>) {
    const same =
      status.size === this.state.status.size &&
      [...status].every(([id, s]) => {
        const o = this.state.status.get(id);
        return o && o.attached === s.attached && o.lines?.first === s.lines?.first && o.lines?.last === s.lines?.last;
      });
    if (!same) this.emit({ ...this.state, status });
  }
}

const EMPTY: BridgeState = { activeId: null, status: new Map() };
const noop = () => () => {};

export function useBridge(bridge: CommentBridge | undefined): BridgeState {
  return useSyncExternalStore(bridge?.subscribe ?? noop, bridge?.getSnapshot ?? (() => EMPTY));
}
