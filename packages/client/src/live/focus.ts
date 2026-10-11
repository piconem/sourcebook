import { createContext } from "react";
import type { Target } from "../router";

/** Request to bring a sub-block (and possibly one of its comments) into view, e.g. from a link or a notification. */
export interface FocusRequest extends Target {
  /** Changes on every request, so the same place can be requested twice. */
  seq: number;
  /** Wait before scrolling (document mode re-aligns the section for a moment after scrolling to it). */
  delay: number;
}

export const FocusContext = createContext<FocusRequest | null>(null);

/** Briefly highlights an element that was navigated to. */
export function flash(el: Element | null | undefined) {
  if (!el) return;
  el.classList.remove("flash-target");
  void (el as HTMLElement).offsetWidth; // restart the animation
  el.classList.add("flash-target");
  setTimeout(() => el.classList.remove("flash-target"), 2200);
}
