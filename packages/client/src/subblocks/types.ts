import type { AssetFile, SubBlock, SubBlockTypeCore } from "@sourcebook/shared";
import type { ComponentType } from "react";
import type { CommentBridge } from "../comments/bridge";

export interface SubBlockProps<TContent> {
  blockId: string;
  subBlock: SubBlock & { content: TContent };
  /** Report edited content; persisted (debounced) by the surrounding frame. */
  onChange(content: TContent): void;
  /** Persists pending changes immediately (e.g. before an action that depends on saved state). */
  saveNow(): Promise<void>;
  /** Present for types with `commentAnchor`: lets the editor show and create text/line comments. */
  commentBridge?: CommentBridge;
}

/** Frontend half of a sub-block type: the shared core contract plus UI. */
export interface ClientSubBlockType<TContent = any> extends SubBlockTypeCore<TContent> {
  component: ComponentType<SubBlockProps<TContent>>;
  icon: string;
  /** Renders exported artifacts (PNG/SVG) from content; sent with each save. */
  exportArtifacts?(content: TContent): Promise<AssetFile[]>;
}
