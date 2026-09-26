import { describe, expect, it } from "vitest";
import { parseBibtex, parseDelimited } from "./parsers";

describe("parseDelimited", () => {
  it("handles quotes, escaped quotes, embedded newlines and CRLF", () => {
    const csv = 'name,note\r\n"Doe, J.","said ""hi""\nthen left"\r\nx,\n';
    expect(parseDelimited(csv, ",").rows).toEqual([
      ["name", "note"],
      ["Doe, J.", 'said "hi"\nthen left'],
      ["x", ""],
    ]);
  });
  it("supports TSV and row limits", () => {
    const r = parseDelimited("a\tb\n1\t2\n3\t4\n", "\t", 2);
    expect(r).toEqual({ rows: [["a", "b"], ["1", "2"]], truncated: true });
  });
});

describe("parseBibtex", () => {
  it("reads entries with braced, quoted and bare values", () => {
    const bib = `@comment{ignored}
@Article{knuth84,
  author = {Donald E. {Knuth}},
  title  = "Literate Programming",
  year   = 1984,
  journal = {The Computer Journal}
}
@book(lamport94, title={{\\LaTeX}: A Document Preparation System}, year={1994})`;
    expect(parseBibtex(bib)).toEqual([
      {
        type: "article",
        key: "knuth84",
        fields: { author: "Donald E. Knuth", title: "Literate Programming", year: "1984", journal: "The Computer Journal" },
      },
      { type: "book", key: "lamport94", fields: { title: "\\LaTeX: A Document Preparation System", year: "1994" } },
    ]);
  });
});
