import type { BibEntry } from "@sourcebook/shared";
import { referencePathOfHref } from "@sourcebook/shared";
import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const linkDecorationsKey = new PluginKey<DecorationSet>("linkDecorations");

/** Key of a `bib:` link href, or null. */
export const bibKeyOf = (href: string | null | undefined) => (href?.startsWith("bib:") ? decodeURIComponent(href.slice(4)) : null);

export type LinkKind = "bib" | "ref" | "url";

/** What a link points to: a bibliography entry, a reference file or anything else. */
export function classifyLink(href: string): { kind: "bib"; key: string } | { kind: "ref"; path: string } | { kind: "url"; href: string } {
  const key = bibKeyOf(href);
  if (key !== null) return { kind: "bib", key };
  const path = referencePathOfHref(href);
  if (path !== null) return { kind: "ref", path };
  return { kind: "url", href };
}

export interface LinkLookup {
  /** Bibliography entries by key (null: unknown, nothing is flagged). */
  bib: Map<string, BibEntry> | null;
  /** Existing reference file paths (null: unknown). */
  refs: Set<string> | null;
}

/** A link in the document: its whole range (possibly across bold/italic parts) and target. */
export interface LinkRange {
  from: number;
  to: number;
  href: string;
  text: string;
}

/** All links of a document, adjacent pieces with the same href merged. */
export function linkRanges(doc: PmNode): LinkRange[] {
  const out: LinkRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const href = node.marks.find((m) => m.type.name === "link")?.attrs.href as string | undefined;
    if (!href) return;
    const last = out[out.length - 1];
    if (last && last.href === href && last.to === pos) {
      last.to = pos + node.nodeSize;
      last.text += node.text ?? "";
    } else out.push({ from: pos, to: pos + node.nodeSize, href, text: node.text ?? "" });
  });
  return out;
}

const ICONS: Record<Exclude<LinkKind, "url">, string> = {
  bib: '<path d="M2 5.5C4.5 4 7.5 4 12 6c4.5-2 7.5-2 10-.5V19c-2.5-1.5-5.5-1.5-10 .5-4.5-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/>',
  ref: '<path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2L9.8 17a1.8 1.8 0 0 1-2.6-2.6l8-8"/>',
};

function icon(kind: Exclude<LinkKind, "url">, missing: boolean): HTMLElement {
  const span = document.createElement("span");
  span.className = `md-link-icon md-link-icon-${kind}${missing ? " missing" : ""}`;
  span.contentEditable = "false";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg>`;
  return span;
}

function build(doc: PmNode, lookup: () => LinkLookup): DecorationSet {
  const { bib, refs } = lookup();
  const decos: Decoration[] = [];
  for (const link of linkRanges(doc)) {
    const target = classifyLink(link.href);
    if (target.kind === "url") {
      decos.push(Decoration.inline(link.from, link.to, { class: "md-link md-link-url", title: `${link.href} — click to edit` }));
      continue;
    }
    let missing = false;
    let title: string;
    if (target.kind === "bib") {
      const e = bib?.get(target.key);
      missing = !!bib && !e;
      title = e ? `${[e.name, e.title, e.year].filter(Boolean).join(" · ")} — bib:${target.key}` : `bib:${target.key} is not in the bibliography`;
    } else {
      missing = !!refs && !refs.has(target.path);
      title = missing ? `references/${target.path} does not exist` : `references/${target.path}`;
    }
    decos.push(
      Decoration.widget(link.from, () => icon(target.kind as "bib" | "ref", missing), { side: -1, ignoreSelection: true, key: `${target.kind}:${missing}:${link.href}` }),
      Decoration.inline(link.from, link.to, { class: `md-link md-link-${target.kind}${missing ? " missing" : ""}`, title: `${title} — click to edit` }),
    );
  }
  return DecorationSet.create(doc, decos);
}

/**
 * Shows what links point to: citations of bibliography entries and reference files get an icon and a
 * tooltip, and are flagged when their target is missing. Dispatch a transaction with `linkDecorationsKey`
 * meta to refresh after the bibliography or the references change.
 */
export const LinkDecorations = (lookup: () => LinkLookup) =>
  Extension.create({
    name: "linkDecorations",
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: linkDecorationsKey,
          state: {
            init: (_, state) => build(state.doc, lookup),
            apply: (tr, old) => (tr.docChanged || tr.getMeta(linkDecorationsKey) ? build(tr.doc, lookup) : old),
          },
          props: { decorations: (state) => linkDecorationsKey.getState(state) },
        }),
      ];
    },
  });
