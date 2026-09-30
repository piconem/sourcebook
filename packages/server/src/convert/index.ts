import { CONVERTIBLE_FORMATS, NATIVE_TEXT_EXT, extOfName, type ConvertibleExt } from "@sourcebook/shared";
import { strFromU8 } from "fflate";
import { shiftHeadings, type Conversion, type ConvertedPart } from "./common.js";
import { convertDoc, convertDocx, convertPptx, convertXlsx } from "./office.js";
import { convertOdp, convertOds, convertOdt } from "./odf.js";
import { convertEml, convertEpub, convertHtml, convertIpynb, convertMsg, convertRtf } from "./other.js";
import { convertPdf } from "./pdf.js";
import { unzip } from "./xml.js";

export { assembleMarkdown, formatLabel, type Conversion, type ConvertedPart } from "./common.js";
export { renderPdfPages } from "./pdf.js";

/** Limits for archives: files included, size of each text / document inside. */
const ZIP_MAX_FILES = 200;
const ZIP_MAX_TEXT = 200 * 1024;
const ZIP_MAX_DOC = 20 * 1024 * 1024;

const converters: Record<ConvertibleExt, (data: Uint8Array) => Promise<Conversion>> = {
  pdf: convertPdf,
  docx: convertDocx,
  doc: convertDoc,
  pptx: convertPptx,
  xlsx: convertXlsx,
  odt: convertOdt,
  odp: convertOdp,
  ods: convertOds,
  rtf: convertRtf,
  epub: convertEpub,
  html: convertHtml,
  htm: convertHtml,
  ipynb: convertIpynb,
  eml: convertEml,
  msg: convertMsg,
  zip: convertZip,
};

/** Converts a document to Markdown parts (by file extension). */
export async function convertDocument(data: Uint8Array, fileName: string): Promise<Conversion> {
  const ext = extOfName(fileName) as ConvertibleExt;
  const convert = converters[ext];
  if (!convert) throw new Error(`No converter for .${ext} files`);
  return convert(data);
}

/** ZIP: one part per file; text files included as they are, documents converted (one level deep). */
async function convertZip(data: Uint8Array): Promise<Conversion> {
  const files = unzip(data);
  const names = Object.keys(files)
    .filter((n) => !n.endsWith("/") && !n.startsWith("__MACOSX/") && !n.split("/").some((s) => s.startsWith(".")))
    .sort();
  const warnings: string[] = [];
  const parts: ConvertedPart[] = [];
  const listed: string[] = [];
  for (const name of names) {
    const bytes = files[name];
    if (parts.length >= ZIP_MAX_FILES) {
      listed.push(name);
      continue;
    }
    const ext = extOfName(name);
    if (NATIVE_TEXT_EXT.test(name) && bytes.length <= ZIP_MAX_TEXT) {
      const text = strFromU8(bytes);
      const markdown = ext === "md" || ext === "markdown" ? shiftHeadings(text) : `\`\`\`${ext}\n${text.trimEnd()}\n\`\`\``;
      parts.push({ n: parts.length + 1, title: name, markdown });
    } else if (ext in CONVERTIBLE_FORMATS && ext !== "zip" && bytes.length <= ZIP_MAX_DOC) {
      try {
        const inner = await convertDocument(bytes, name);
        const body = inner.parts.map((p) => (inner.parts.length > 1 ? `#### ${inner.unit} ${p.n}${p.title ? `: ${p.title}` : ""}\n\n${shiftHeadings(p.markdown, 2)}` : shiftHeadings(p.markdown, 1))).join("\n\n");
        parts.push({ n: parts.length + 1, title: name, markdown: body });
      } catch (e) {
        warnings.push(`${name}: not converted (${(e as Error).message}).`);
        listed.push(name);
      }
    } else listed.push(name);
  }
  if (listed.length) {
    const list = listed.map((n) => `- ${n} (${files[n].length} bytes)`).join("\n");
    parts.push({ n: parts.length + 1, title: "Other files (not converted)", markdown: list });
  }
  return { unit: "file", parts, warnings, converter: "fflate" };
}
