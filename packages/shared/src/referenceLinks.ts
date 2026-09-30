/**
 * Links from Markdown sub-blocks to reference files: `[text](../../../references/<encoded path>)`
 * (relative to blocks/NNN/subblocks/).
 */
const LINK = /(\]\()((?:\.\.\/)+references\/)([^)\s?#]+)/g;

const encodeRefPath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Reference path of a link target, if it points into references/. */
export function referencePathOfHref(href: string): string | null {
  const m = /^(?:\.\.\/)+references\/([^?#]+)/.exec(href);
  return m ? decode(m[1]) : null;
}

/** Reference paths linked from a Markdown text, in order, without duplicates. */
export function linkedReferences(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(LINK)].map((m) => decode(m[3])))];
}

/** Rewrites links to a moved file or folder (`from` → `to`), including files inside a moved folder. */
export function renameReferenceLinks(markdown: string, from: string, to: string): string {
  return markdown.replace(LINK, (all, open: string, prefix: string, enc: string) => {
    const path = decode(enc);
    if (path === from) return `${open}${prefix}${encodeRefPath(to)}`;
    if (path.startsWith(`${from}/`)) return `${open}${prefix}${encodeRefPath(to + path.slice(from.length))}`;
    return all;
  });
}

/** Moves a path (file, or anything inside a moved folder); null when not affected. */
export function movedReferencePath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : null;
}

/** True when `path` is `removed` or inside it. */
export const isUnderReference = (path: string, removed: string) => path === removed || path.startsWith(`${removed}/`);
