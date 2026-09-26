import { z } from "zod";
import type { SubBlockTypeCore } from "../registry.js";
import { exportImage } from "./util.js";

const schema = z.object({ code: z.string() });
export type MermaidContent = z.infer<typeof schema>;

export const mermaidType: SubBlockTypeCore<MermaidContent> = {
  type: "mermaid",
  label: "Mermaid diagram",
  sourceExt: "mmd",
  contentSchema: schema,
  // Starts empty: the editor offers a gallery of diagram kinds with starter templates.
  defaultContent: () => ({ code: "" }),
  serialize: (c) => ({ source: c.code }),
  deserialize: (source) => ({ code: source }),
  toMarkdown: (c, ctx) =>
    exportImage(ctx, "Diagram") ?? (c.code.trim() ? "```mermaid\n" + c.code.trimEnd() + "\n```" : ""),
};
