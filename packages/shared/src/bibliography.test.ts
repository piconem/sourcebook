import { describe, expect, it } from "vitest";
import {
  BibEntryFieldsSchema,
  bibAuthors,
  citedKeys,
  fieldsFromBibtex,
  generateBibtex,
  generateTextCitation,
  parseBibtex,
  renameCitations,
  suggestKey,
} from "./bibliography.js";

const SAMPLE = `% a comment line
@string{ tcj = "The Computer Journal" }
@comment{ ignored {with braces} }
@Article{knuth84,
  author  = {Donald E. {Knuth}},
  title   = "Literate {P}rogramming",
  journal = tcj,
  year    = 1984,
  month   = may,
  doi     = {10.1093/comjnl/27.2.97},
  note    = {Seminal paper} # " on " # {WEB}
}
@misc(tsx, title={{tsx}: TypeScript Execute}, howpublished={GitHub}, url={https://github.com/privatenumber/tsx}, year={2024})
@online{w3c-html,
  author = {{World Wide Web Consortium}},
  title = {HTML Living Standard},
  url = {https://html.spec.whatwg.org/},
  year = {2025}
}`;

describe("parseBibtex", () => {
  it("reads entries with macros, concatenation, nested braces and both delimiters", () => {
    const entries = parseBibtex(SAMPLE);
    expect(entries.map((e) => [e.type, e.key])).toEqual([["article", "knuth84"], ["misc", "tsx"], ["online", "w3c-html"]]);
    expect(entries[0].fields).toMatchObject({
      author: "Donald E. {Knuth}",
      title: "Literate {P}rogramming",
      journal: "The Computer Journal",
      year: "1984",
      month: "May",
      note: "Seminal paper on WEB",
    });
    expect(entries[0].raw.startsWith("@Article{knuth84,")).toBe(true);
    expect(entries[0].raw.endsWith("}")).toBe(true);
    expect(entries[1].fields.title).toBe("{tsx}: TypeScript Execute");
  });

  it("maps BibTeX onto entry fields", () => {
    const [knuth, tsx, w3c] = parseBibtex(SAMPLE).map(fieldsFromBibtex);
    expect(knuth).toMatchObject({ key: "knuth84", type: "article", name: "Knuth 1984", authors: "Donald E. Knuth", year: "1984", venue: "The Computer Journal", title: "Literate Programming", doi: "10.1093/comjnl/27.2.97", description: "Seminal paper on WEB" });
    expect(tsx).toMatchObject({ type: "misc", name: "tsx: TypeScript Execute 2024", venue: "GitHub", url: "https://github.com/privatenumber/tsx" });
    expect(w3c).toMatchObject({ type: "online", authors: "World Wide Web Consortium", name: "Consortium 2025" });
    for (const e of [knuth, tsx, w3c]) expect(BibEntryFieldsSchema.safeParse(e).success).toBe(true);
  });
});

describe("generation", () => {
  const entry = { key: "knuth1984literate", type: "article" as const, name: "Knuth 1984", authors: "Knuth, Donald E.; Lamport, Leslie", year: "1984", venue: "The Computer Journal", title: "Literate Programming & Co", doi: "https://doi.org/10.1093/comjnl/27.2.97" };

  it("builds BibTeX with the venue field of the type, escaping and a stable layout", () => {
    expect(generateBibtex(entry)).toBe(
      [
        "@article{knuth1984literate,",
        "  author  = {Knuth, Donald E. and Lamport, Leslie},",
        "  title   = {{Literate Programming \\& Co}},",
        "  journal = {The Computer Journal},",
        "  year    = {1984},",
        "  doi     = {10.1093/comjnl/27.2.97}",
        "}",
      ].join("\n"),
    );
    expect(generateBibtex({ type: "software", name: "tsx", title: "tsx", venue: "GitHub", url: "https://github.com/x/tsx" })).toMatch(/^@software\{tsx,\n[\s\S]*publisher = \{GitHub\}/);
    expect(generateBibtex({ type: "phdthesis", name: "x", authors: "Ada Lovelace", venue: "Univ." })).toContain("school = {Univ.}");
    // Round trip: the generated BibTeX parses back to the same fields.
    expect(fieldsFromBibtex(parseBibtex(generateBibtex(entry))[0])).toMatchObject({ authors: "Knuth, Donald E. and Lamport, Leslie", venue: "The Computer Journal", year: "1984" });
  });

  it("writes a readable text citation, skipping missing parts", () => {
    expect(generateTextCitation(entry)).toBe("Knuth, D. E. & Lamport, L. (1984). Literate Programming & Co. The Computer Journal. https://doi.org/10.1093/comjnl/27.2.97");
    expect(generateTextCitation({ name: "MDN", title: "Fetch API", url: "https://developer.mozilla.org" })).toBe("Fetch API. https://developer.mozilla.org");
    expect(generateTextCitation({ name: "Only a name" })).toBe("Only a name");
    expect(generateTextCitation({ name: "x", authors: "A B; C D; E F", year: "2020", title: "T?" })).toBe("B, A., D, C., & F, E. (2020). T?");
  });

  it("suggests keys and normalises author lists", () => {
    expect(suggestKey(entry)).toBe("knuth1984literate");
    expect(suggestKey({ title: "2001: a space odyssey" })).toBe("space");
    expect(suggestKey({ title: "tsx" })).toBe("tsx");
    expect(suggestKey({ title: "2001" })).toBe("ref");
    expect(bibAuthors("Ada Lovelace and Charles Babbage")).toBe("Ada Lovelace and Charles Babbage");
    expect(bibAuthors("Lovelace, Ada\nBabbage, Charles")).toBe("Lovelace, Ada and Babbage, Charles");
  });
});

describe("citations in Markdown", () => {
  const md = "As [Knuth 1984](bib:knuth84) and [tsx](<bib:tsx>) show; see also [x](bib:knuth84) and [web](https://x.y).";
  it("finds cited keys and renames them", () => {
    expect(citedKeys(md)).toEqual(["knuth84", "tsx"]);
    expect(citedKeys(renameCitations(md, "knuth84", "knuth1984"))).toEqual(["knuth1984", "tsx"]);
    expect(renameCitations("[a](bib:knuth84x)", "knuth84", "k")).toBe("[a](bib:knuth84x)");
  });
});

describe("reference links", async () => {
  const { linkedReferences, renameReferenceLinks, referencePathOfHref } = await import("./referenceLinks.js");
  it("finds, decodes and renames links to reference files and folders", () => {
    const md = "See [spec](../../../references/papers/My%20spec.pdf), [data](../../../references/data.csv?x=1) and [web](https://x.org).";
    expect(linkedReferences(md)).toEqual(["papers/My spec.pdf", "data.csv"]);
    expect(referencePathOfHref("../../../references/a%20b/c.md#L1")).toBe("a b/c.md");
    expect(renameReferenceLinks(md, "papers", "Papers 2026")).toBe(
      "See [spec](../../../references/Papers%202026/My%20spec.pdf), [data](../../../references/data.csv?x=1) and [web](https://x.org).",
    );
    expect(renameReferenceLinks(md, "data.csv", "raw.csv")).toContain("(../../../references/raw.csv?x=1)");
    expect(renameReferenceLinks(md, "pap", "zzz")).toBe(md);
  });
});
