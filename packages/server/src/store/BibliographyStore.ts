import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  BibEntryFieldsSchema,
  BibKeySchema,
  BibliographyFileSchema,
  fieldsFromBibtex,
  generateBibtex,
  generateTextCitation,
  parseBibtex,
  suggestKey,
  type BibEntry,
  type BibUsage,
  type CreateBibEntryBody,
  type ImportBibResult,
  type UpdateBibEntryBody,
} from "@sourcebook/shared";
import { HttpError, badRequest, notFound } from "../errors.js";
import { readJson, writeJsonAtomic } from "../fs/atomic.js";
import { Mutex } from "../fs/mutex.js";
import type { NotebookStore } from "./NotebookStore.js";

export const BIBLIOGRAPHY_FILE = "bibliography.json";

/** Sets the citation key of a BibTeX entry text: "@article{old," → "@article{new,". */
export function withKey(bibtex: string, key: string): string {
  return bibtex.replace(/^(\s*@[A-Za-z]+\s*[{(]\s*)[^,\s]*(\s*,)/, `$1${key}$2`);
}

/**
 * A project's bibliography: entries in bibliography.json (sorted by name). Associations with sections and
 * sub-blocks, and bib: links in text, live in the notebook; renames and deletions keep them consistent.
 */
export class BibliographyStore {
  private mutex = new Mutex();
  private entries: BibEntry[] | null = null;
  private readonly file: string;

  constructor(
    root: string,
    private readonly notebook: NotebookStore,
  ) {
    this.file = join(root, BIBLIOGRAPHY_FILE);
  }

  private async load(): Promise<BibEntry[]> {
    if (!this.entries) {
      this.entries = existsSync(this.file) ? BibliographyFileSchema.parse(await readJson(this.file)).entries : [];
    }
    return this.entries;
  }

  private async save(entries: BibEntry[]) {
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || a.key.localeCompare(b.key));
    this.entries = entries;
    await writeJsonAtomic(this.file, { version: 1, entries });
    this.notebook.notify({ type: "bibliography" });
  }

  async list(opts: { q?: string; type?: string } = {}): Promise<BibEntry[]> {
    const q = opts.q?.trim().toLowerCase();
    return (await this.load()).filter(
      (e) =>
        (!opts.type || e.type === opts.type) &&
        (!q || [e.key, e.name, e.authors, e.title, e.year, e.venue, e.description, e.doi].some((v) => v?.toLowerCase().includes(q))),
    );
  }

  async get(key: string): Promise<BibEntry> {
    const e = (await this.load()).find((x) => x.key === key);
    if (!e) throw notFound(`Bibliography entry "${key}"`);
    return e;
  }

  async has(keys: string[]): Promise<string[]> {
    const known = new Set((await this.load()).map((e) => e.key));
    return keys.filter((k) => !known.has(k));
  }

  /** A free key based on `base` (base, base-b, base-c…). */
  private freeKey(entries: BibEntry[], base: string): string {
    const taken = new Set(entries.map((e) => e.key));
    if (!taken.has(base)) return base;
    for (let i = 1; ; i++) {
      const k = `${base}-${String.fromCharCode(97 + ((i - 1) % 26))}${i > 26 ? Math.floor(i / 26) : ""}`;
      if (!taken.has(k)) return k;
    }
  }

  /** Fills missing BibTeX and text citation when asked to. */
  private complete(e: BibEntry, generate?: boolean): BibEntry {
    if (!generate) return e;
    return {
      ...e,
      textCitation: e.textCitation?.trim() ? e.textCitation : generateTextCitation(e),
      bibtex: e.bibtex?.trim() ? withKey(e.bibtex, e.key) : generateBibtex(e),
    };
  }

  create(body: CreateBibEntryBody): Promise<BibEntry> {
    return this.mutex.run(async () => {
      const entries = await this.load();
      const { generate, key: requested, ...fields } = body;
      const fromBibtex = fields.bibtex ? parseBibtex(fields.bibtex)[0]?.key : undefined;
      const wanted = requested ?? (fromBibtex && BibKeySchema.safeParse(fromBibtex).success ? fromBibtex : undefined);
      if (wanted && entries.some((e) => e.key === wanted)) throw new HttpError(409, `The key "${wanted}" is already used`);
      const key = wanted ?? this.freeKey(entries, suggestKey(fields));
      const now = new Date().toISOString();
      const entry = this.complete({ ...fields, key, createdAt: now, updatedAt: now }, generate);
      await this.save([...entries, entry]);
      return entry;
    });
  }

  /** Updates fields; a new key renames the entry and every citation of it (links and associations). */
  update(key: string, body: UpdateBibEntryBody): Promise<BibEntry> {
    return this.mutex.run(async () => {
      const entries = await this.load();
      const i = entries.findIndex((e) => e.key === key);
      if (i < 0) throw notFound(`Bibliography entry "${key}"`);
      const { generate, key: newKey, ...fields } = body;
      if (newKey && newKey !== key && entries.some((e) => e.key === newKey)) throw new HttpError(409, `The key "${newKey}" is already used`);
      const merged = { ...entries[i], ...fields, key: newKey ?? key, updatedAt: new Date().toISOString() };
      const parsed = BibEntryFieldsSchema.safeParse(merged);
      if (!parsed.success) throw badRequest("Invalid bibliography entry", parsed.error.issues);
      let entry = this.complete(merged, generate);
      if (newKey && newKey !== key) {
        if (entry.bibtex) entry = { ...entry, bibtex: withKey(entry.bibtex, newKey) };
        await this.notebook.renameCitationKey(key, newKey);
      }
      const next = [...entries];
      next[i] = entry;
      await this.save(next);
      return entry;
    });
  }

  /** Deletes an entry; if it is used, refuses (409 with the usages) unless `force`, which drops associations. */
  delete(key: string, force = false): Promise<{ removedAssociations: number }> {
    return this.mutex.run(async () => {
      const entries = await this.load();
      if (!entries.some((e) => e.key === key)) throw notFound(`Bibliography entry "${key}"`);
      const usages = await this.notebook.citationUsages(key);
      if (usages.length && !force) {
        throw new HttpError(409, `"${key}" is used in ${usages.length} place(s); delete with force to remove its associations`, { usages });
      }
      const associations = usages.filter((u) => u.kind !== "text").length;
      if (associations) await this.notebook.removeCitationKey(key);
      await this.save(entries.filter((e) => e.key !== key));
      return { removedAssociations: associations };
    });
  }

  usages(key: string): Promise<BibUsage[]> {
    return this.notebook.citationUsages(key).then((list) => list.map(({ key: _k, ...u }) => u));
  }

  /** Imports BibTeX text (one or more entries). */
  import(bibtex: string, onDuplicate: "skip" | "replace"): Promise<ImportBibResult> {
    return this.mutex.run(async () => {
      const entries = [...(await this.load())];
      const result: ImportBibResult = { created: [], replaced: [], skipped: [], errors: [] };
      const parsed = parseBibtex(bibtex);
      if (!parsed.length) result.errors.push("No BibTeX entries found.");
      const now = new Date().toISOString();
      for (const p of parsed) {
        const f = fieldsFromBibtex(p);
        const keyOk = BibKeySchema.safeParse(f.key);
        const valid = BibEntryFieldsSchema.safeParse(f);
        if (!keyOk.success || !valid.success) {
          result.errors.push(`@${p.type}{${p.key || "?"}}: ${keyOk.success ? valid.error!.issues[0].message : "invalid key"}`);
          continue;
        }
        const entry: BibEntry = { ...valid.data, key: f.key, textCitation: generateTextCitation(valid.data), createdAt: now, updatedAt: now };
        const at = entries.findIndex((e) => e.key === f.key);
        if (at >= 0 && onDuplicate === "skip") result.skipped.push(f.key);
        else if (at >= 0) {
          entries[at] = { ...entry, createdAt: entries[at].createdAt };
          result.replaced.push(f.key);
        } else {
          entries.push(entry);
          result.created.push(f.key);
        }
      }
      if (result.created.length || result.replaced.length) await this.save(entries);
      return result;
    });
  }

  /** All entries as a .bib file (stored BibTeX with the current key, or generated). */
  async exportBib(keys?: string[]): Promise<string> {
    const entries = (await this.load()).filter((e) => !keys || keys.includes(e.key));
    return entries.map((e) => (e.bibtex?.trim() ? withKey(e.bibtex.trim(), e.key) : generateBibtex(e))).join("\n\n") + (entries.length ? "\n" : "");
  }
}
