import { z } from "zod";
import type { SubBlockTypeCore } from "../registry.js";

// Local references written as ../assets/<file> (relative to subblocks/).
const ASSET_REF = /\]\(\s*<?\.\.\/(assets\/[^)\s>]+)/g;

const schema = z.object({ markdown: z.string() });
export type MarkdownContent = z.infer<typeof schema>;

export const markdownType: SubBlockTypeCore<MarkdownContent> = {
  type: "markdown",
  label: "Markdown",
  sourceExt: "md",
  commentAnchor: "text",
  contentSchema: schema,
  defaultContent: () => ({ markdown: "" }),
  serialize: (c) => ({ source: c.markdown }),
  deserialize: (source) => ({ markdown: source }),
  assetsOf: (c) => [...new Set([...c.markdown.matchAll(ASSET_REF)].map((m) => m[1]))],
  toMarkdown: (c) => c.markdown,
};
