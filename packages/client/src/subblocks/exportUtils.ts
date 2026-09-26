import type { AssetFile } from "@sourcebook/shared";

export const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export const dataUrlToAsset = (dataUrl: string, ext: string): AssetFile => {
  const [head, data] = dataUrl.split(",");
  return { ext, mimeType: head.slice(5).split(";")[0], dataBase64: data };
};

export const textToAsset = (text: string, ext: string, mimeType: string): AssetFile => ({
  ext,
  mimeType,
  dataBase64: btoa(unescape(encodeURIComponent(text))),
});

/** Rasterizes an SVG string to a PNG data URL (SVG must not contain foreignObject). */
export async function svgToPng(svg: string, scale = 2): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG rasterization failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(img.width * scale);
    canvas.height = Math.ceil(img.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
