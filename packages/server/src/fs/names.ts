export function slugify(title: string, fallback = "block"): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || fallback;
}

export const pad = (n: number, width: number) => String(n).padStart(width, "0");

export const blockFolderName = (order: number, title: string) => `${pad(order, 3)}-${slugify(title)}`;

/** Base file name (no extension) for a sub-block, e.g. "02-mermaid". */
export const subBlockBaseName = (order: number, type: string) => `${pad(order, 2)}-${slugify(type, "subblock")}`;
