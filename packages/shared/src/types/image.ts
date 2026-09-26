import { z } from "zod";
import type { SubBlockTypeCore } from "../registry.js";

const schema = z.object({
  /** Path relative to the block folder, e.g. "assets/ab12.png"; empty until uploaded. */
  src: z.string().refine((s) => !s.includes(".."), "src must stay inside the block folder"),
  alt: z.string(),
  caption: z.string(),
});
export type ImageContent = z.infer<typeof schema>;

// Source is a Markdown image reference relative to subblocks/, readable outside the tool.
const IMAGE_RE = /^!\[(.*?)\]\(\.\.\/(\S*?)(?:\s+"(.*)")?\)\s*$/s;
const escapeAlt = (s: string) => s.replace(/[\[\]]/g, "");
const escapeTitle = (s: string) => s.replace(/"/g, "'");

export const imageType: SubBlockTypeCore<ImageContent> = {
  type: "image",
  label: "Image",
  sourceExt: "md",
  contentSchema: schema,
  defaultContent: () => ({ src: "", alt: "", caption: "" }),
  serialize: (c) => ({
    source: c.src
      ? `![${escapeAlt(c.alt)}](../${c.src}${c.caption ? ` "${escapeTitle(c.caption)}"` : ""})\n`
      : "",
  }),
  deserialize: (source) => {
    const m = IMAGE_RE.exec(source.trim());
    return m ? { alt: m[1], src: m[2], caption: m[3] ?? "" } : { src: "", alt: "", caption: "" };
  },
  assetsOf: (c) => (c.src ? [c.src] : []),
  validate: (c) =>
    c.src === "" || c.src.startsWith("assets/")
      ? { ok: true }
      : { ok: false, errors: ["src must point inside the block's assets/ folder"] },
  toMarkdown: (c) =>
    c.src
      ? `![${escapeAlt(c.alt)}](../${c.src}${c.caption ? ` "${escapeTitle(c.caption)}"` : ""})`
      : "",
};
