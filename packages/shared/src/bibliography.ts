import { z } from "zod";

// ---------------------------------------------------------------- types

/** Entry types: the 14 classic BibTeX types plus common biblatex ones for non-paper sources. */
export const BIB_TYPES = [
  { id: "article", label: "Article (journal)", venue: "journal" },
  { id: "book", label: "Book", venue: "publisher" },
  { id: "booklet", label: "Booklet", venue: "howpublished" },
  { id: "conference", label: "Conference paper", venue: "booktitle" },
  { id: "inbook", label: "Part of a book", venue: "publisher" },
  { id: "incollection", label: "Chapter in a collection", venue: "booktitle" },
  { id: "inproceedings", label: "Paper in proceedings", venue: "booktitle" },
  { id: "manual", label: "Manual / documentation", venue: "organization" },
  { id: "mastersthesis", label: "Master's thesis", venue: "school" },
  { id: "misc", label: "Miscellaneous", venue: "howpublished" },
  { id: "phdthesis", label: "PhD thesis", venue: "school" },
  { id: "proceedings", label: "Proceedings", venue: "publisher" },
  { id: "techreport", label: "Technical report", venue: "institution" },
  { id: "unpublished", label: "Unpublished", venue: "howpublished" },
  { id: "online", label: "Online resource / website", venue: "organization" },
  { id: "software", label: "Software / repository", venue: "publisher" },
  { id: "dataset", label: "Dataset", venue: "publisher" },
  { id: "report", label: "Report", venue: "institution" },
  { id: "patent", label: "Patent", venue: "holder" },
  { id: "video", label: "Video", venue: "publisher" },
] as const;

export type BibType = (typeof BIB_TYPES)[number]["id"];
export const bibTypeInfo = (type: string) => BIB_TYPES.find((t) => t.id === type) ?? BIB_TYPES.find((t) => t.id === "misc")!;

// ---------------------------------------------------------------- schema

/** Citation key: the entry id, also used as the BibTeX key and in `bib:` links. */
export const BibKeySchema = z.string().regex(/^[A-Za-z][\w:.-]{0,63}$/, "Use 1–64 characters: letters, digits, _ : . - (starting with a letter)");

const text = (max: number) => z.string().max(max).optional();

export const BibEntryFieldsSchema = z.object({
  type: z.enum(BIB_TYPES.map((t) => t.id) as [BibType, ...BibType[]]),
  /** Short human label, e.g. "Knuth 1984"; used as the link text of citations. */
  name: z.string().trim().min(1, "Name is required").max(200),
  authors: text(2000),
  year: text(20),
  /** Journal, conference, publisher, website… (mapped to the right BibTeX field for the type). */
  venue: text(500),
  title: text(1000),
  abstract: text(20000),
  description: text(20000),
  doi: text(300),
  url: text(2000),
  textCitation: text(5000),
  bibtex: text(50000),
});
export type BibEntryFields = z.infer<typeof BibEntryFieldsSchema>;

export const BibEntrySchema = BibEntryFieldsSchema.extend({
  key: BibKeySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BibEntry = z.infer<typeof BibEntrySchema>;

export const BibliographyFileSchema = z.object({ version: z.literal(1), entries: z.array(BibEntrySchema) });
export type BibliographyFile = z.infer<typeof BibliographyFileSchema>;

export const CreateBibEntryBodySchema = BibEntryFieldsSchema.extend({
  key: BibKeySchema.optional(),
  /** Fill missing bibtex / textCitation from the other fields. */
  generate: z.boolean().optional(),
});
export type CreateBibEntryBody = z.infer<typeof CreateBibEntryBodySchema>;

export const UpdateBibEntryBodySchema = BibEntryFieldsSchema.partial().extend({
  /** Rename the key: citations and associations are updated everywhere. */
  key: BibKeySchema.optional(),
  generate: z.boolean().optional(),
});
export type UpdateBibEntryBody = z.infer<typeof UpdateBibEntryBodySchema>;

export const ImportBibtexBodySchema = z.object({
  bibtex: z.string().min(1).max(5_000_000),
  onDuplicate: z.enum(["skip", "replace"]).default("skip"),
});

export const GenerateBibBodySchema = BibEntryFieldsSchema.partial().extend({ key: z.string().optional(), type: BibEntryFieldsSchema.shape.type.default("misc") });

export const CitationsBodySchema = z.object({ keys: z.array(BibKeySchema).max(500) });

export interface BibUsage {
  /** Whole section / sub-block associated with the entry, or a Markdown sub-block citing it in its text. */
  kind: "section" | "subblock" | "text";
  blockId: string;
  subBlockId?: string;
  /** Outline reference, e.g. "§2.1" or "§2.1#3". */
  ref: string;
  title: string;
}

export interface ImportBibResult {
  created: string[];
  replaced: string[];
  skipped: string[];
  errors: string[];
}

// ---------------------------------------------------------------- BibTeX parsing

export interface ParsedBibtex {
  type: string;
  key: string;
  fields: Record<string, string>;
  /** Source text of the entry as written. */
  raw: string;
}

const MONTHS: Record<string, string> = {
  jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June",
  jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December",
};

/**
 * BibTeX reader: `@type{key, field = {…} | "…" | number | macro # …}` with nested braces, `@string` macros,
 * `@comment`/`@preamble` skipped. Values are returned without outer braces, whitespace collapsed.
 */
export function parseBibtex(input: string): ParsedBibtex[] {
  const entries: ParsedBibtex[] = [];
  const macros: Record<string, string> = { ...MONTHS };
  let i = 0;
  const s = input;

  const skipWs = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const balanced = (open: string, close: string): string => {
    let depth = 0;
    const start = i;
    for (; i < s.length; i++) {
      if (s[i] === "\\") {
        i++;
        continue;
      }
      if (s[i] === open) depth++;
      else if (s[i] === close && --depth === 0) return s.slice(start + 1, i++);
    }
    return s.slice(start + 1);
  };
  const quoted = (): string => {
    let depth = 0;
    const start = ++i;
    for (; i < s.length; i++) {
      if (s[i] === "\\") {
        i++;
        continue;
      }
      if (s[i] === "{") depth++;
      else if (s[i] === "}") depth--;
      else if (s[i] === '"' && depth === 0) return s.slice(start, i++);
    }
    return s.slice(start);
  };
  /** value := part ( '#' part )* */
  const value = (): string => {
    let out = "";
    for (;;) {
      skipWs();
      if (s[i] === "{") out += balanced("{", "}");
      else if (s[i] === '"') out += quoted();
      else {
        const m = /^[^\s,#}\)]+/.exec(s.slice(i, i + 200));
        if (!m) break;
        i += m[0].length;
        const word = m[0];
        out += /^\d+$/.test(word) ? word : (macros[word.toLowerCase()] ?? word);
      }
      skipWs();
      if (s[i] === "#") {
        i++;
        continue;
      }
      break;
    }
    return out;
  };

  while ((i = s.indexOf("@", i)) !== -1) {
    const start = i;
    const head = /^@([a-zA-Z]+)\s*([{(])/.exec(s.slice(i, i + 60));
    if (!head) {
      i++;
      continue;
    }
    const type = head[1].toLowerCase();
    const close = head[2] === "{" ? "}" : ")";
    i += head[0].length;
    if (type === "comment" || type === "preamble") {
      i--;
      balanced(head[2], close);
      continue;
    }
    if (type === "string") {
      skipWs();
      const name = /^[A-Za-z][\w-]*/.exec(s.slice(i))?.[0];
      if (name) {
        i += name.length;
        skipWs();
        if (s[i] === "=") {
          i++;
          macros[name.toLowerCase()] = value();
        }
      }
      const end = s.indexOf(close, i);
      i = end === -1 ? s.length : end + 1;
      continue;
    }
    skipWs();
    const keyMatch = /^[^,\s}\)]*/.exec(s.slice(i))!;
    const key = keyMatch[0];
    i += key.length;
    const fields: Record<string, string> = {};
    for (;;) {
      skipWs();
      if (s[i] === ",") {
        i++;
        skipWs();
      }
      if (i >= s.length || s[i] === close) {
        i++;
        break;
      }
      const name = /^([A-Za-z][\w:-]*)\s*=\s*/.exec(s.slice(i));
      if (!name) {
        // Malformed: skip to the end of the entry.
        const end = s.indexOf(`\n@`, i);
        i = end === -1 ? s.length : end + 1;
        break;
      }
      i += name[0].length;
      fields[name[1].toLowerCase()] = value().replace(/\s+/g, " ").trim();
    }
    entries.push({ type, key, fields, raw: s.slice(start, i).trim() });
  }
  return entries;
}

/** Removes BibTeX braces and common escapes for display. */
export const bibPlain = (v: string | undefined) =>
  (v ?? "").replace(/\\([&%$#_{}])/g, "$1").replace(/[{}]/g, "").replace(/\\url/g, "").trim();

/** Maps a parsed BibTeX entry onto Sourcebook fields. */
export function fieldsFromBibtex(p: ParsedBibtex): BibEntryFields & { key: string } {
  const f = p.fields;
  const type = (BIB_TYPES.some((t) => t.id === p.type) ? p.type : "misc") as BibType;
  const venue = f.journal ?? f.journaltitle ?? f.booktitle ?? f.publisher ?? f.school ?? f.institution ?? f.organization ?? f.howpublished;
  const authors = bibPlain(f.author ?? f.editor);
  const year = bibPlain(f.year ?? f.date?.slice(0, 4));
  const firstAuthor = authors.split(/\s+and\s+/i)[0]?.split(",")[0]?.trim().split(/\s+/).pop();
  const name = [firstAuthor || bibPlain(f.title).split(/\s+/).slice(0, 3).join(" ") || p.key, year].filter(Boolean).join(" ");
  const clean = (v: string | undefined) => (v ? bibPlain(v) : undefined) || undefined;
  return {
    key: p.key,
    type,
    name,
    authors: authors || undefined,
    year: year || undefined,
    venue: clean(venue),
    title: clean(f.title),
    abstract: clean(f.abstract),
    description: clean(f.note ?? f.annote),
    doi: clean(f.doi),
    url: clean(f.url?.replace(/^\\url\{(.*)\}$/, "$1")),
    bibtex: p.raw,
  };
}

// ---------------------------------------------------------------- generation

const escapeBib = (v: string) => v.replace(/([&%$#_])/g, "\\$1");
/** Braces around the title keep capitalisation (e.g. acronyms) in most styles. */
const protect = (v: string) => `{${escapeBib(v)}}`;

/** "Knuth, Donald E.; Lamport, Leslie" or "D. Knuth and L. Lamport" → BibTeX "and"-separated list. */
export function bibAuthors(authors: string): string {
  const parts = authors.includes(" and ") ? authors.split(/\s+and\s+/) : authors.split(/\s*;\s*|\s*\n\s*/);
  return parts.map((a) => a.trim()).filter(Boolean).join(" and ");
}

/** A citation key from the fields, e.g. "knuth1984literate". */
export function suggestKey(f: Partial<BibEntryFields>): string {
  const ascii = (v: string) => v.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  // First author's last name; without authors, the first word of the short name (e.g. "tsx", "React docs").
  const author =
    ascii(bibAuthors(f.authors ?? "").split(" and ")[0] ?? "").split(",")[0].trim().split(/\s+/).pop() ||
    (f.title ? (ascii(f.name ?? "").split(/[^A-Za-z0-9]+/).find((w) => /^[A-Za-z]/.test(w)) ?? "") : "");
  const words = ascii(f.title ?? f.name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => /[a-z]/.test(w));
  const stop = ["with", "from", "that", "this", "into", "towards", "the", "and", "for"];
  const word = words.find((w) => w.length > 3 && !stop.includes(w)) ?? words.find((w) => !stop.includes(w)) ?? "";
  const prefix = author.toLowerCase().replace(/[^a-z0-9]/g, "");
  const year = (f.year ?? "").replace(/\D/g, "").slice(0, 4);
  const key = `${prefix}${year}${word === prefix && !year ? "" : word}`;
  return /^[a-z]/.test(key) ? key.slice(0, 60) : `ref${key}`.slice(0, 60);
}

/** BibTeX for an entry, built from its fields. */
export function generateBibtex(e: Partial<BibEntryFields> & { key?: string; type: string }): string {
  const info = bibTypeInfo(e.type);
  const key = e.key || suggestKey(e);
  const fields: [string, string][] = [];
  if (e.authors) fields.push(["author", bibAuthors(e.authors)]);
  if (e.title) fields.push(["title", protect(e.title)]);
  if (e.venue) fields.push([info.venue, escapeBib(e.venue)]);
  if (e.year) fields.push(["year", e.year]);
  if (e.doi) fields.push(["doi", e.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")]);
  if (e.url) fields.push(["url", e.url]);
  if (e.type === "online" && e.url) fields.push(["urldate", new Date().toISOString().slice(0, 10)]);
  if (e.abstract) fields.push(["abstract", escapeBib(e.abstract)]);
  if (e.description) fields.push(["note", escapeBib(e.description)]);
  const width = Math.max(0, ...fields.map(([k]) => k.length));
  const body = fields.map(([k, v]) => `  ${k.padEnd(width)} = {${v}}`).join(",\n");
  return `@${e.type}{${key}${body ? `,\n${body}` : ""}\n}`;
}

/** "Donald E. Knuth" → "Knuth, D. E."; already "Knuth, Donald E." → "Knuth, D. E.". */
function shortAuthor(a: string): string {
  const [last, first] = a.includes(",") ? a.split(",").map((x) => x.trim()) : [a.trim().split(/\s+/).pop() ?? "", a.trim().split(/\s+/).slice(0, -1).join(" ")];
  const initials = (first ?? "").split(/[\s-]+/).filter(Boolean).map((n) => `${n[0].toUpperCase()}.`).join(" ");
  return initials ? `${last}, ${initials}` : last;
}

/** Human-readable reference (author–year style), skipping missing parts. */
export function generateTextCitation(e: Partial<BibEntryFields>): string {
  const authors = e.authors ? bibAuthors(e.authors).split(" and ").map(shortAuthor) : [];
  const who = authors.length > 2 ? `${authors.slice(0, -1).join(", ")}, & ${authors.at(-1)}` : authors.join(" & ");
  const parts: string[] = [];
  if (who) parts.push(`${who}${e.year ? ` (${e.year}).` : "."}`);
  else if (e.year) parts.push(`(${e.year}).`);
  if (e.title) parts.push(/[.?!]$/.test(e.title) ? e.title : `${e.title}.`);
  if (e.venue) parts.push(`${e.venue}.`);
  if (e.doi) parts.push(`https://doi.org/${e.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}`);
  else if (e.url) parts.push(e.url);
  return parts.join(" ") || e.name || "";
}

// ---------------------------------------------------------------- citations in Markdown

/** Link target used to cite an entry in Markdown: [Knuth 1984](bib:knuth1984). */
export const bibHref = (key: string) => `bib:${key}`;
const CITE = /\]\(\s*<?bib:([A-Za-z][\w:.-]*)>?\s*\)/g;

/** Keys cited with bib: links in a Markdown text, in order of first appearance. */
export function citedKeys(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(CITE)].map((m) => m[1]))];
}

/** Replaces bib:old with bib:new in Markdown links. */
export function renameCitations(markdown: string, oldKey: string, newKey: string): string {
  const re = new RegExp(`(\\]\\(\\s*<?)bib:${oldKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=>?\\s*\\))`, "g");
  return markdown.replace(re, `$1bib:${newKey}`);
}
