import type { ToMarkdownContext } from "../registry.js";

/** Markdown image pointing at the first exported raster/vector artifact, if any. */
export function exportImage(ctx: ToMarkdownContext, alt: string): string | undefined {
  const file = ctx.ref.exports[0];
  return file ? `![${alt}](${file})` : undefined;
}
