import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { keys } from "../api/queries";
import { AssociationsButton } from "../components/AssociationsButton";
import { bibMatches } from "./CitePickerDialog";
import { bibByline, useOptionalBibliography } from "./BibliographyContext";

/** Open book icon. */
export function BibIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 5.5C4.5 4 7.5 4 12 6c4.5-2 7.5-2 10-.5V19c-2.5-1.5-5.5-1.5-10 .5-4.5-2-7.5-2-10-.5z" />
      <path d="M12 6v13.5" />
    </svg>
  );
}

/** 📚 Bibliography sources associated with a whole section or sub-block; `inText` are keys cited in its text. */
export function CitationsButton(props: { blockId: string; subBlockId?: string; citations: string[] | undefined; inText?: string[] }) {
  const bib = useOptionalBibliography();
  const qc = useQueryClient();
  if (!bib) return null;
  const current = props.citations ?? [];
  const what = props.subBlockId ? "sub-block" : "section";
  const item = (k: string) => {
    const e = bib.byKey.get(k);
    return { id: k, label: e?.name ?? k, detail: e ? bibByline(e) || e.key : "missing source", title: e?.title ?? "Not in the bibliography", missing: !e };
  };
  return (
    <AssociationsButton
      variant="citations"
      icon={<BibIcon />}
      label="Sources"
      tooltip={(n) => (n ? `${n} source${n === 1 ? "" : "s"} associated with this ${what}` : `Associate sources from the bibliography with this ${what}`)}
      heading={`Sources of the whole ${what}`}
      empty="None yet."
      items={current.map(item)}
      inText={(props.inText ?? []).filter((k) => !current.includes(k)).map(item)}
      inTextLabel="Cited in the text"
      searchPlaceholder={bib.entries.length ? "Add a source: search…" : "The bibliography is empty"}
      candidates={(q) =>
        bib.entries.filter((e) => !current.includes(e.key) && bibMatches(e, q)).map((e) => ({ id: e.key, label: e.name, detail: e.title ?? bibByline(e) }))
      }
      onOpen={bib.open}
      onChange={async (next) => {
        try {
          if (props.subBlockId) await api.setSubBlockCitations(props.blockId, props.subBlockId, next);
          else await api.setSectionCitations(props.blockId, next);
        } finally {
          void qc.invalidateQueries({ queryKey: keys.block(props.blockId) });
          void qc.invalidateQueries({ queryKey: ["bibliography-usages"] });
        }
      }}
      newLabel="New source…"
      onNew={(add) => bib.create((e) => add(e.key))}
    />
  );
}
