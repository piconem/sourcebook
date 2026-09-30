import { DOMParser, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";
import { strFromU8, unzipSync, type Unzipped } from "fflate";

export type { XmlElement, XmlNode };

/** Unzips an OOXML/ODF/EPUB container (entries by path). */
export const unzip = (data: Uint8Array): Unzipped => unzipSync(data);

export function parseXml(text: string): XmlElement {
  const doc = new DOMParser({ onError: () => undefined }).parseFromString(text, "text/xml");
  return doc.documentElement as XmlElement;
}

/** Parsed XML entry of a container, or null when missing. */
export function xmlEntry(files: Unzipped, path: string): XmlElement | null {
  const bytes = files[path];
  return bytes ? parseXml(strFromU8(bytes)) : null;
}

export const localName = (n: XmlNode) => (n as XmlElement).localName ?? n.nodeName.replace(/^.*:/, "");

/** Element children (optionally with a given local name). */
export function children(el: XmlNode | null | undefined, name?: string): XmlElement[] {
  const out: XmlElement[] = [];
  if (!el) return out;
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (!name || localName(c) === name)) out.push(c as XmlElement);
  return out;
}

/** Descendants with a local name, in document order. */
export function descendants(el: XmlNode | null | undefined, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (n: XmlNode) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (localName(c) === name) out.push(c as XmlElement);
      walk(c);
    }
  };
  if (el) walk(el);
  return out;
}

export const child = (el: XmlNode | null | undefined, name: string) => children(el, name)[0] ?? null;

/** Attribute by local name, whatever its prefix. */
export function attr(el: XmlElement | null | undefined, name: string): string | null {
  if (!el) return null;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i)!;
    if ((a.localName ?? a.name.replace(/^.*:/, "")) === name) return a.value;
  }
  return null;
}

/** Attribute in a prefixed namespace (e.g. r:id), ignoring a plain attribute with the same local name. */
export function prefixedAttr(el: XmlElement | null | undefined, name: string): string | null {
  if (!el) return null;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i)!;
    if (a.name.includes(":") && a.name.replace(/^.*:/, "") === name) return a.value;
  }
  return null;
}

/** Resolves a relative path inside a container ("ppt/slides/" + "../media/x.png"). */
export function resolvePath(baseDir: string, rel: string): string {
  const parts = (rel.startsWith("/") ? rel.slice(1) : `${baseDir}${rel}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

/** Relationships of an OOXML part: id → { target, type }. */
export function relationships(files: Unzipped, partPath: string): Map<string, { target: string; type: string }> {
  const dir = partPath.includes("/") ? partPath.slice(0, partPath.lastIndexOf("/") + 1) : "";
  const relsPath = `${dir}_rels/${partPath.slice(dir.length)}.rels`;
  const out = new Map<string, { target: string; type: string }>();
  for (const r of children(xmlEntry(files, relsPath), "Relationship")) {
    const target = attr(r, "Target") ?? "";
    out.set(attr(r, "Id") ?? "", { target: attr(r, "TargetMode") === "External" ? target : resolvePath(dir, target), type: attr(r, "Type") ?? "" });
  }
  return out;
}
