import type { AssetFile, DrawingContent } from "@sourcebook/shared";
import { blobToBase64 } from "../exportUtils";

export async function exportDrawing(content: DrawingContent): Promise<AssetFile[]> {
  const elements = content.elements.filter((e) => !(e as { isDeleted?: boolean }).isDeleted);
  if (!elements.length) return [];
  const { exportToBlob } = await import("@excalidraw/excalidraw");
  const blob = await exportToBlob({
    elements: elements as never,
    appState: { ...content.appState, exportBackground: true, exportWithDarkMode: false } as never,
    files: content.files as never,
    mimeType: "image/png",
    exportPadding: 16,
  });
  return [{ ext: "png", mimeType: "image/png", dataBase64: await blobToBase64(blob) }];
}
