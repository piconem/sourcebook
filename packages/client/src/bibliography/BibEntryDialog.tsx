import {
  BIB_TYPES,
  BibKeySchema,
  bibTypeInfo,
  fieldsFromBibtex,
  generateBibtex,
  generateTextCitation,
  parseBibtex,
  suggestKey,
  type BibEntry,
  type BibEntryFields,
} from "@sourcebook/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api/client";
import { keys as queryKeys } from "../api/queries";
import { AskAiButton } from "../ai/AskAiButton";
import { copyText } from "../clipboard";
import { Dialog } from "../components/Dialog";
import { bibUsagesKey, bibliographyKey, citationMarkdown } from "./BibliographyContext";
import { BibDeleteDialog } from "./BibDeleteDialog";

type Form = Record<"key" | "type" | "name" | "authors" | "year" | "venue" | "title" | "abstract" | "description" | "doi" | "url" | "textCitation" | "bibtex", string>;
const TEXT_FIELDS = ["name", "authors", "year", "venue", "title", "abstract", "description", "doi", "url", "textCitation", "bibtex"] as const;

const emptyForm = (): Form => ({ key: "", type: "article", name: "", authors: "", year: "", venue: "", title: "", abstract: "", description: "", doi: "", url: "", textCitation: "", bibtex: "" });
const formOf = (e: BibEntry): Form => ({ ...emptyForm(), ...Object.fromEntries(Object.entries(e).filter(([, v]) => typeof v === "string")), key: e.key, type: e.type });

/** Label of the "venue" field for a type (the BibTeX field it becomes). */
export const VENUE_LABELS: Record<string, string> = {
  journal: "Journal",
  booktitle: "Book / proceedings title",
  publisher: "Publisher",
  school: "School / university",
  institution: "Institution",
  howpublished: "Published as / where",
  organization: "Organization / website",
  holder: "Patent holder",
};

/** The entry's fields from the form (empty strings dropped). */
function fieldsOf(f: Form): BibEntryFields {
  const out: Record<string, string> = { type: f.type };
  for (const k of TEXT_FIELDS) if (f[k].trim()) out[k] = f[k].trim();
  return out as BibEntryFields;
}

/** Fields parsed from BibTeX text, onto the form (key only when `withKey`). */
function fillFromBibtex(f: Form, text: string, withKey: boolean): Form | null {
  const parsed = parseBibtex(text)[0];
  if (!parsed) return null;
  const p = fieldsFromBibtex(parsed);
  const next: Form = { ...f, type: p.type, bibtex: text.trim() };
  for (const k of TEXT_FIELDS) {
    const v = (p as Record<string, string | undefined>)[k];
    if (k !== "bibtex" && v) next[k] = v;
  }
  if (withKey && BibKeySchema.safeParse(p.key).success) next.key = p.key;
  return next;
}

/** Create or edit a bibliography entry. */
export function BibEntryDialog(props: {
  open: boolean;
  entry: BibEntry | null;
  /** Opened for a key that is not in the bibliography (e.g. a broken citation). */
  missingKey?: string;
  onClose(): void;
  onSaved(entry: BibEntry, isNew: boolean): void;
  onGoTo?(blockId: string): void;
}) {
  const { entry } = props;
  const isNew = !entry;
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState<{ field: "bibtex" | "textCitation"; value: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const usages = useQuery({
    queryKey: bibUsagesKey(entry?.key ?? ""),
    queryFn: () => api.getBibUsages(entry!.key),
    enabled: props.open && !!entry,
  });

  // Reset the form when the dialog opens or switches to another entry (not on every live update).
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!props.open) {
      shownFor.current = null;
      return;
    }
    const id = entry?.key ?? "(new)";
    if (shownFor.current === id) return;
    shownFor.current = id;
    setForm(entry ? formOf(entry) : emptyForm());
    setError(null);
    setNotice(null);
    setConfirmReplace(null);
  }, [props.open, entry]);

  if (props.missingKey)
    return (
      <Dialog open={props.open} title="Source not found" onClose={props.onClose} actions={<button onClick={props.onClose}>Close</button>}>
        <p>
          The citation <code>bib:{props.missingKey}</code> points to a key that is not in the bibliography. Add a source with that key, or change the link.
        </p>
      </Dialog>
    );

  const set = (k: keyof Form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setNotice(null);
  };
  const venueLabel = VENUE_LABELS[bibTypeInfo(form.type).venue] ?? "Venue";
  const keyError = form.key.trim() && !BibKeySchema.safeParse(form.key.trim()).success ? BibKeySchema.safeParse(form.key.trim()).error!.issues[0].message : null;
  const renamed = !!entry && form.key.trim() !== entry.key && !!form.key.trim();
  const used = usages.data?.length ?? 0;

  const generate = (field: "bibtex" | "textCitation") => {
    const fields = fieldsOf(form);
    const value =
      field === "bibtex" ? generateBibtex({ ...fields, key: form.key.trim() || entry?.key || suggestKey(fields) }) : generateTextCitation(fields);
    if (form[field].trim() && form[field].trim() !== value) setConfirmReplace({ field, value });
    else set(field, value);
  };
  const fillFields = () => {
    const next = fillFromBibtex(form, form.bibtex, isNew || !form.key.trim());
    if (!next) return setError("No BibTeX entry found: paste an entry like @article{key, author = {…}, title = {…}}.");
    setError(null);
    setForm(next);
    setNotice("Fields filled from the BibTeX.");
  };
  const copy = async (what: string, text: string) => {
    if (await copyText(text)) {
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500);
    }
  };

  const save = async () => {
    const fields = fieldsOf(form);
    if (!form.name.trim()) return setError("The name (a short label such as “Knuth 1984”) is required.");
    if (keyError) return setError(`Key: ${keyError}`);
    setSaving(true);
    setError(null);
    try {
      const saved = entry
        ? await api.updateBibEntry(entry.key, {
            // Cleared fields are sent empty so they are removed.
            ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, form[k].trim()])),
            type: form.type as BibEntry["type"],
            name: form.name.trim(),
            ...(renamed ? { key: form.key.trim() } : {}),
          })
        : await api.createBibEntry({ ...fields, ...(form.key.trim() ? { key: form.key.trim() } : {}) });
      qc.setQueryData<BibEntry[]>(bibliographyKey, (list) => (list ? [...list.filter((e) => e.key !== (entry?.key ?? saved.key)), saved] : list));
      void qc.invalidateQueries({ queryKey: bibliographyKey });
      if (renamed) {
        // Citations in the text and associations were rewritten on the server.
        void qc.invalidateQueries({ queryKey: ["block"] });
        void qc.invalidateQueries({ queryKey: queryKeys.project });
      }
      void qc.invalidateQueries({ queryKey: ["bibliography-usages"] });
      shownFor.current = saved.key;
      setForm(formOf(saved));
      setNotice(isNew ? null : renamed ? `Saved. Key renamed: ${used} citation(s) updated.` : "Saved.");
      props.onSaved(saved, isNew);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? e.message : `Not saved: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const labelled = (label: string, k: keyof Form, opts: { rows?: number; placeholder?: string; wide?: boolean; hint?: string } = {}) => (
    <label className={`field${opts.wide ? " wide" : ""}`}>
      <span>
        {label}
        {opts.hint && <span className="muted small"> — {opts.hint}</span>}
      </span>
      {opts.rows ? (
        <textarea rows={opts.rows} value={form[k]} placeholder={opts.placeholder} onChange={(e) => set(k, e.target.value)} />
      ) : (
        <input value={form[k]} placeholder={opts.placeholder} onChange={(e) => set(k, e.target.value)} />
      )}
    </label>
  );

  return (
    <>
      <Dialog
        open={props.open}
        wide
        title={isNew ? "New source" : `Source · ${entry.name}`}
        onClose={props.onClose}
        actions={
          <>
            {entry && (
              <>
                <button className="danger" onClick={() => setDeleting(true)}>
                  Delete…
                </button>
                <AskAiButton className="ask-ai-btn ask-ai-inline" label="Ask AI" target={() => ({ kind: "bibliography", key: entry.key, name: entry.name, title: entry.title })} />
              </>
            )}
            <span className="muted small bibl-foot-hint">
              {entry ? (
                <>
                  Cite it in text as <code>{citationMarkdown(entry)}</code>
                </>
              ) : (
                "Tip: paste a BibTeX entry below to fill the fields."
              )}
            </span>
            <button onClick={props.onClose}>{isNew ? "Cancel" : "Close"}</button>
            <button className="primary" disabled={saving} onClick={save}>
              {saving ? "Saving…" : isNew ? "Add source" : "Save"}
            </button>
          </>
        }
      >
        <div className="bibl-form">
          <label className="field">
            <span>Type</span>
            <select value={form.type} onChange={(e) => set("type", e.target.value)}>
              {BIB_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} (@{t.id})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              Key (id) <span className="muted small">— used in citations: bib:key</span>
            </span>
            <input
              className="mono"
              value={form.key}
              placeholder={isNew ? `automatic, e.g. ${suggestKey(fieldsOf(form)) || "knuth1984literate"}` : ""}
              onChange={(e) => set("key", e.target.value.replace(/\s/g, ""))}
            />
            {keyError && <span className="field-error">{keyError}</span>}
            {renamed && (
              <span className="notice small">
                Renaming updates {usages.isSuccess ? `the ${used} place(s) that use it` : "every citation and association"} (links in the text included).
              </span>
            )}
          </label>
          {labelled("Name", "name", { placeholder: "Short label shown in citations, e.g. Knuth 1984, React docs" })}
          {labelled("Year", "year", { placeholder: "1984" })}
          {labelled("Authors", "authors", { wide: true, placeholder: "Knuth, Donald E. and Lamport, Leslie — or one per line; organisations in {braces}", hint: "separate with “and”, “;” or new lines" })}
          {labelled("Title", "title", { wide: true })}
          {labelled(venueLabel, "venue", { placeholder: `→ BibTeX field “${bibTypeInfo(form.type).venue}”` })}
          {labelled("DOI", "doi", { placeholder: "10.1093/comjnl/27.2.97" })}
          {labelled("Link", "url", { wide: true, placeholder: "https://…" })}
          {labelled("Abstract", "abstract", { wide: true, rows: 3 })}
          {labelled("Description", "description", { wide: true, rows: 2, placeholder: "Your notes: why this source matters here (exported as BibTeX note)" })}

          <div className="field wide">
            <span className="bibl-field-head">
              Text citation
              <span className="bibl-field-tools">
                <button type="button" onClick={() => generate("textCitation")} title="Build it from the fields">
                  ⚙ Generate
                </button>
                <button type="button" disabled={!form.textCitation.trim()} onClick={() => copy("text", form.textCitation)}>
                  {copied === "text" ? "Copied ✓" : "Copy"}
                </button>
              </span>
            </span>
            <textarea rows={2} value={form.textCitation} placeholder="Knuth, D. E. (1984). Literate Programming. The Computer Journal." onChange={(e) => set("textCitation", e.target.value)} />
          </div>
          <div className="field wide">
            <span className="bibl-field-head">
              BibTeX
              <span className="bibl-field-tools">
                <button type="button" disabled={!form.bibtex.trim()} onClick={fillFields} title="Fill the fields above from this BibTeX">
                  ⤴ Fill fields from BibTeX
                </button>
                <button type="button" onClick={() => generate("bibtex")} title="Build the BibTeX from the fields">
                  ⚙ Generate
                </button>
                <button type="button" disabled={!form.bibtex.trim()} onClick={() => copy("bibtex", form.bibtex)}>
                  {copied === "bibtex" ? "Copied ✓" : "Copy"}
                </button>
              </span>
            </span>
            <textarea
              className="mono"
              rows={7}
              value={form.bibtex}
              spellCheck={false}
              placeholder={"Paste a BibTeX entry (Google Scholar, DBLP, Zotero…) or press Generate.\n@article{knuth1984literate,\n  author = {Knuth, Donald E.},\n  title  = {Literate Programming},\n  …\n}"}
              onChange={(e) => set("bibtex", e.target.value)}
              onPaste={(e) => {
                // Pasting into an empty new entry fills its fields directly.
                const text = e.clipboardData.getData("text");
                if (!isNew || form.name.trim() || form.bibtex.trim()) return;
                const next = fillFromBibtex(form, text, true);
                if (!next) return;
                e.preventDefault();
                setForm(next);
                setNotice("Fields filled from the pasted BibTeX.");
              }}
            />
          </div>
          {confirmReplace && (
            <div className="notice wide bibl-confirm" role="alert">
              <span>Replace the current {confirmReplace.field === "bibtex" ? "BibTeX" : "text citation"} with the generated one?</span>
              <pre>{confirmReplace.value}</pre>
              <span className="bibl-field-tools">
                <button onClick={() => setConfirmReplace(null)}>Keep current</button>
                <button
                  className="primary"
                  onClick={() => {
                    set(confirmReplace.field, confirmReplace.value);
                    setConfirmReplace(null);
                  }}
                >
                  Replace
                </button>
              </span>
            </div>
          )}
          {error && <p className="render-error wide">{error}</p>}
          {notice && <p className="notice wide">{notice}</p>}

          {entry && (
            <div className="field wide">
              <span className="bibl-field-head">
                Used in
                <span className="bibl-field-tools">
                  <button type="button" onClick={() => copy("cite", citationMarkdown(entry))} title="Markdown link to paste in a Markdown sub-block">
                    {copied === "cite" ? "Copied ✓" : "Copy citation link"}
                  </button>
                </span>
              </span>
              {usages.isLoading ? (
                <span className="muted small">Loading…</span>
              ) : used === 0 ? (
                <span className="muted small">Not cited or associated yet. Use ❝ Cite in a Markdown toolbar, or 📚 on a section or sub-block.</span>
              ) : (
                <ul className="bibl-usages">
                  {usages.data!.map((u, i) => (
                    <li key={i}>
                      <button className="link" disabled={!props.onGoTo} onClick={() => props.onGoTo?.(u.blockId)}>
                        {u.ref}
                      </button>{" "}
                      {u.title} <span className="muted small">— {u.kind === "text" ? "cited in the text" : u.kind === "section" ? "associated with the whole section" : "associated with the sub-block"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Dialog>
      {entry && <BibDeleteDialog entry={deleting ? entry : null} onClose={() => setDeleting(false)} onDeleted={props.onClose} />}
    </>
  );
}
