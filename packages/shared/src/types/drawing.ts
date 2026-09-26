import { z } from "zod";
import type { SubBlockTypeCore } from "../registry.js";
import { exportImage } from "./util.js";

/** Excalidraw scene file (see https://docs.excalidraw.com — "excalidraw" JSON schema). */
const schema = z.looseObject({
  type: z.literal("excalidraw"),
  version: z.number(),
  elements: z.array(z.unknown()),
  appState: z.record(z.string(), z.unknown()),
  files: z.record(z.string(), z.unknown()),
});
export type DrawingContent = z.infer<typeof schema>;

export const drawingType: SubBlockTypeCore<DrawingContent> = {
  type: "drawing",
  label: "Drawing",
  sourceExt: "excalidraw",
  contentSchema: schema,
  defaultContent: () => ({
    type: "excalidraw",
    version: 2,
    source: "sourcebook",
    elements: [],
    appState: {},
    files: {},
  }),
  serialize: (c) => ({ source: JSON.stringify(c, null, 2) }),
  deserialize: (source) => schema.parse(JSON.parse(source)),
  toMarkdown: (_c, ctx) => exportImage(ctx, "Drawing") ?? "",
};
