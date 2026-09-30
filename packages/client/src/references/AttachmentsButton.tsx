import { useQueryClient } from "@tanstack/react-query";
import { useContext } from "react";
import { api } from "../api/client";
import { keys } from "../api/queries";
import { AssociationsButton } from "../components/AssociationsButton";
import { ReferencesContext } from "./ReferencesContext";
import { viewerFor } from "./viewers";

/** Paperclip icon. */
export function PaperclipIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2L9.8 17a1.8 1.8 0 0 1-2.6-2.6l8-8" />
    </svg>
  );
}

const folderOf = (path: string) => (path.includes("/") ? `references/${path.slice(0, path.lastIndexOf("/") + 1)}` : "references/");

/** 📎 Reference files attached to a whole section or sub-block; `inText` are files linked from its text. */
export function AttachmentsButton(props: { blockId: string; subBlockId?: string; paths: string[] | undefined; inText?: string[] }) {
  const refs = useContext(ReferencesContext);
  const qc = useQueryClient();
  if (!refs) return null;
  const current = props.paths ?? [];
  const what = props.subBlockId ? "sub-block" : "section";
  const known = new Set(refs.files.map((f) => f.path));
  const item = (p: string) => {
    const name = p.split("/").pop()!;
    return { id: p, label: `${viewerFor(name)?.icon ?? "📦"} ${name}`, detail: known.has(p) ? folderOf(p) : "missing file", title: `references/${p}`, missing: !known.has(p) };
  };
  return (
    <AssociationsButton
      variant="attachments"
      icon={<PaperclipIcon />}
      label="Reference files"
      tooltip={(n) => (n ? `${n} reference file${n === 1 ? "" : "s"} attached to this ${what}` : `Attach reference files to this ${what}`)}
      heading={`Files of the whole ${what}`}
      empty="None yet."
      items={current.map(item)}
      inText={(props.inText ?? []).filter((p) => !current.includes(p)).map(item)}
      inTextLabel="Linked in the text"
      searchPlaceholder={refs.files.length ? "Attach a file: search…" : "No reference files yet"}
      candidates={(q) => refs.files.filter((f) => !current.includes(f.path) && f.path.toLowerCase().includes(q.trim().toLowerCase())).map((f) => item(f.path))}
      onOpen={refs.open}
      onChange={async (next) => {
        try {
          await api.setAttachedReferences(props.blockId, props.subBlockId ?? null, next);
        } finally {
          void qc.invalidateQueries({ queryKey: keys.block(props.blockId) });
        }
      }}
    />
  );
}
