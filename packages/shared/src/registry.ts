import type { z } from "zod";
import type { AnchorText } from "./anchors.js";
import type { AssetFile, SubBlockRef, ValidationResult } from "./schemas.js";

export interface ToMarkdownContext {
  ref: SubBlockRef;
  /** Project-relative path of the block's subblocks/ folder, e.g. "blocks/001-intro/subblocks". */
  subBlocksDir: string;
  /** Project-relative path of the block folder. */
  blockDir: string;
}

export interface DeserializeContext {
  /** Extension of the source file being read, without the dot. */
  sourceExt: string;
}

/**
 * Contract every sub-block type implements. Core Block/REST logic only talks to
 * types through this interface — adding a type means registering a new definition.
 */
export interface SubBlockTypeCore<TContent = unknown> {
  type: string;
  label: string;
  /** Extension of the editable source file stored on disk (default for new sub-blocks). */
  sourceExt: string;
  /** When the extension depends on content (e.g. a code file's language). */
  sourceExtFor?(content: TContent): string;
  contentSchema: z.ZodType<TContent>;
  defaultContent(): TContent;
  serialize(content: TContent): { source: string; assets?: AssetFile[] };
  deserialize(source: string, assets?: AssetFile[], ctx?: DeserializeContext): TContent;
  validate?(content: TContent): ValidationResult;
  /** Comments can point at a range of this type's text ("text") or at source lines ("lines"). */
  commentAnchor?: "text" | "lines";
  /**
   * For "text" anchors: the anchorable text derived from the source, with a mapping to source lines
   * (used to create anchors from line numbers and to report where comments are). Defaults to the source.
   */
  anchorText?(source: string): AnchorText;
  /** Files in the block's assets/ folder this content references (block-relative, e.g. "assets/x.png"). */
  assetsOf?(content: TContent): string[];
  /**
   * Markdown fragment used when compiling the whole notebook into one document. Local links and images
   * are relative to the block's subblocks/ folder (like the source files themselves); the compiler
   * rebases them onto the combined document.
   */
  toMarkdown(content: TContent, ctx: ToMarkdownContext): string;
}

export interface Registry<T extends SubBlockTypeCore<any>> {
  register(def: T): void;
  get(type: string): T | undefined;
  list(): T[];
}

export function createRegistry<T extends SubBlockTypeCore<any>>(defs: T[] = []): Registry<T> {
  const map = new Map<string, T>();
  const registry: Registry<T> = {
    register(def) {
      if (map.has(def.type)) throw new Error(`Sub-block type "${def.type}" already registered`);
      map.set(def.type, def);
    },
    get: (type) => map.get(type),
    list: () => [...map.values()],
  };
  defs.forEach((d) => registry.register(d));
  return registry;
}
