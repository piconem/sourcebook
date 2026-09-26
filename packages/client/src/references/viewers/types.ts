import type { ReferenceNode } from "@sourcebook/shared";
import type { ComponentType } from "react";

export interface ViewerProps {
  node: ReferenceNode;
  /** Inline URL of the file. */
  url: string;
  /** File content, for viewers with `needsText`. */
  text?: string;
}

/** A way of showing a reference file. Adding a format = registering a viewer. */
export interface ReferenceViewer {
  id: string;
  label: string;
  /** Lower-case extensions without dot. */
  exts: string[];
  /** Whole file names (lower-case) without a useful extension, e.g. "makefile". */
  names?: string[];
  component: ComponentType<ViewerProps>;
  /** The dialog fetches the file as text first (subject to the size limit). */
  needsText?: boolean;
  /** Offer a "Source" tab showing the raw text with highlighting. */
  source?: boolean;
  /** Icon for the tree. */
  icon: string;
}
