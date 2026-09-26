import type { AssetFile } from "@sourcebook/shared";
import { toPng } from "html-to-image";
import { dataUrlToAsset } from "../exportUtils";
import { renderLatex } from "./EquationEditor";

/** Renders the equation off-screen with KaTeX and rasterizes it to PNG. */
export async function exportEquation(latex: string): Promise<AssetFile[]> {
  if (!latex.trim()) return [];
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;padding:8px;background:#fff;color:#000;font-size:20px";
  host.innerHTML = renderLatex(latex);
  document.body.appendChild(host);
  try {
    return [dataUrlToAsset(await toPng(host, { pixelRatio: 2, backgroundColor: "#fff" }), "png")];
  } finally {
    host.remove();
  }
}
