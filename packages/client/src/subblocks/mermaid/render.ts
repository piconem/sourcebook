import type { AssetFile } from "@sourcebook/shared";
import { svgToPng, dataUrlToAsset, textToAsset } from "../exportUtils";

let seq = 0;
let loaded: Promise<typeof import("mermaid").default> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const mermaid = () => (loaded ??= import("mermaid").then(({ default: m }) => m));

/**
 * Renders with the mermaid theme matching `scheme`. Mermaid's config is global, so renders are
 * serialized: a dark preview and a light export never interleave their initialize/render calls.
 */
export function renderMermaid(code: string, scheme: "light" | "dark" = "light"): Promise<string> {
  const run = async () => {
    const m = await mermaid();
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: scheme === "dark" ? "dark" : "default",
      // SVG text labels (no foreignObject) keep the SVG rasterizable to PNG.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    const { svg } = await m.render(`sb-mermaid-${++seq}`, code);
    return svg;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

export async function exportMermaid(code: string): Promise<AssetFile[]> {
  if (!code.trim()) return [];
  // Exports always use the light theme: they end up in documents, not in the editor.
  const svg = await renderMermaid(code, "light");
  const assets = [textToAsset(svg, "svg", "image/svg+xml")];
  try {
    assets.unshift(dataUrlToAsset(await svgToPng(svg), "png"));
  } catch {
    // Keep the SVG export if rasterization is not possible for this diagram.
  }
  return assets;
}
