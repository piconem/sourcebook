import { describe, expect, it } from "vitest";
import { viewerFor } from "./index";

describe("reference viewers", () => {
  it.each([
    ["paper.PDF", "pdf"], ["fig.svg", "image"], ["talk.mp4", "video"], ["page.html", "html"],
    ["README.md", "markdown"], ["data.tsv", "table"], ["conf.json", "json"], ["refs.bib", "bibtex"],
    ["flow.mmd", "mermaid"], ["sketch.excalidraw", "excalidraw"], ["main.tex", "text"], ["app.py", "text"],
    ["config.yml", "text"], ["Makefile", "text"], ["LICENSE", "text"],
  ])("%s → %s", (name, id) => expect(viewerFor(name)?.id).toBe(id));

  it.each(["report.docx", "sheet.xlsx", "archive.zip", "program.exe", "noext"])("%s is not previewable", (name) =>
    expect(viewerFor(name)).toBeUndefined(),
  );
});
