/** How the main area shows the notebook: one section at a time, or the whole document. */
export type ScrollMode = "section" | "document";

const KEY = "sourcebook.scrollMode";

export function loadScrollMode(): ScrollMode {
  try {
    return localStorage.getItem(KEY) === "document" ? "document" : "section";
  } catch {
    return "section";
  }
}

export function saveScrollMode(mode: ScrollMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // preference only
  }
}
