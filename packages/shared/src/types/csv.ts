import { z } from "zod";
import { parseCsv, sniffDelimiter, type CsvDelimiter } from "../csv.js";
import type { SubBlockTypeCore } from "../registry.js";

/** Rows shown when the notebook is compiled into one Markdown document. */
const MARKDOWN_ROWS = 50;
const MAX_ROWS = 100_000;

const schema = z.object({
  /** The data, as CSV text (first record = header). */
  csv: z.string(),
  delimiter: z.enum([",", ";", "\t", "|"]),
});
export type CsvContent = z.infer<typeof schema>;

const cell = (v: string) => v.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();

/**
 * A data set kept as a CSV file (NN-csv.csv): viewed as a table (sort, filter, edit cells, column summary).
 * Comments attach to source lines, i.e. rows.
 */
export const csvType: SubBlockTypeCore<CsvContent> = {
  type: "csv",
  label: "CSV data",
  sourceExt: "csv",
  commentAnchor: "lines",
  contentSchema: schema,
  defaultContent: () => ({ csv: "name,value\n", delimiter: "," }),
  serialize: (c) => ({ source: c.csv }),
  deserialize: (source) => ({ csv: source, delimiter: sniffDelimiter(source) }),
  validate(c) {
    const { rows } = parseCsv(c.csv, c.delimiter as CsvDelimiter);
    return rows.length > MAX_ROWS ? { ok: false, errors: [`At most ${MAX_ROWS} rows (this has ${rows.length})`] } : { ok: true };
  },
  toMarkdown(c) {
    const { rows } = parseCsv(c.csv, c.delimiter as CsvDelimiter);
    if (!rows.length) return "_(empty data set)_";
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => Array.from({ length: width }, (_, i) => cell(r[i] ?? ""));
    const [header, ...data] = rows;
    const lines = [`| ${pad(header).join(" | ")} |`, `| ${Array(width).fill("---").join(" | ")} |`, ...data.slice(0, MARKDOWN_ROWS).map((r) => `| ${pad(r).join(" | ")} |`)];
    if (data.length > MARKDOWN_ROWS) lines.push("", `_… ${data.length - MARKDOWN_ROWS} more rows in the data set (${data.length} in total)._`);
    return lines.join("\n");
  },
};
