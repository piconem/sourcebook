/** Small documents of every supported format, generated for conversion tests. */
import { createCanvas } from "@napi-rs/canvas";
import ExcelJS from "exceljs";
import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts, TextRenderingMode, popGraphicsState, pushGraphicsState, rgb, setTextRenderingMode } from "pdf-lib";

const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));

/** A white page image with one line of text, as a scanner would produce. */
function scannedPng(text: string): Uint8Array {
  const c = createCanvas(600, 800);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 600, 800);
  g.fillStyle = "#000";
  g.font = "28px sans-serif";
  g.fillText(text, 40, 100);
  return c.toBuffer("image/png");
}

/**
 * 6 pages: 1 text (heading, paragraphs, bullets, hyphenation) · 2 text + figure · 3 scan (+ page number) ·
 * 4 vector drawing · 5 scan with an invisible OCR layer · 6 blank.
 */
export async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const img = await doc.embedPng(scannedPng("Scanned text line"));
  const body = (p: ReturnType<typeof doc.addPage>, lines: string[], y: number) => lines.forEach((t, i) => p.drawText(t, { x: 50, y: y - i * 14, size: 11, font }));
  let p = doc.addPage([595, 842]);
  p.drawText("Introduction", { x: 50, y: 780, size: 20, font });
  body(p, ["Literate programming is a methodology that combines a program-", "ming language with a documentation language, making programs", "more robust, more portable and easier to maintain."], 740);
  body(p, ["A second paragraph starts after a blank line and continues", "on this line to be long enough for the body font size."], 680);
  body(p, ["• First point of the list", "• Second point of the list"], 630);
  p = doc.addPage([595, 842]);
  body(p, ["This page has text and a figure below it. The text is long enough", "to count as a real text page for the analysis of the document."], 780);
  p.drawImage(img, { x: 100, y: 330, width: 300, height: 400 });
  p.drawText("Figure 1: A scanned sample used as a picture.", { x: 100, y: 312, size: 9, font });
  // A bar chart drawn with vector shapes, captioned below.
  [60, 110, 40, 150].forEach((h, i) => p.drawRectangle({ x: 110 + i * 45, y: 90, width: 30, height: h, color: rgb(0.2, 0.4, 0.8) }));
  p.drawLine({ start: { x: 100, y: 90 }, end: { x: 300, y: 90 }, thickness: 1 });
  p.drawText("Fig. 2. Latency by service,", { x: 100, y: 72, size: 9, font });
  p.drawText("measured in September.", { x: 100, y: 61, size: 9, font });
  p = doc.addPage([595, 842]);
  p.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  p.drawText("3", { x: 290, y: 20, size: 9, font });
  p = doc.addPage([595, 842]);
  for (let i = 0; i < 20; i++) p.drawRectangle({ x: 50 + i * 10, y: 100 + i * 15, width: 40, height: 20, borderColor: rgb(0, 0, 1), borderWidth: 1 });
  p = doc.addPage([595, 842]);
  p.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  p.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  p.drawText("Scanned text line recognised by the OCR layer of the scanner, long enough.", { x: 40, y: 740, size: 11, font });
  p.pushOperators(popGraphicsState());
  doc.addPage([595, 842]);
  return doc.save();
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
export function sampleDocx(): Uint8Array {
  const para = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cell = (t: string) => `<w:tc>${para(t)}</w:tc>`;
  return zip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body>${para("Design notes", "Heading1")}${para("The service exposes a REST API.")}<w:tbl><w:tr>${cell("Name")}${cell("Value")}</w:tr><w:tr>${cell("timeout")}${cell("30 s")}</w:tr></w:tbl></w:body></w:document>`,
  });
}

const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export function samplePptx(): Uint8Array {
  const sp = (ph: string | null, paras: string[]) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ""}</p:nvPr></p:nvSpPr><p:txBody>${paras.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;
  const slide = (shapes: string) => `<?xml version="1.0"?><p:sld ${P}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
  const table = `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Metric</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>p99</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Latency</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>120 ms</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  return zip({
    "ppt/presentation.xml": `<?xml version="1.0"?><p:presentation ${P}><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="${REL}/slide" Target="slides/slide2.xml"/><Relationship Id="rId3" Type="${REL}/slide" Target="slides/slide1.xml"/></Relationships>`,
    "ppt/slides/slide1.xml": slide(sp("title", ["Architecture"]) + sp("body", ["Gateway", "Workers"]) + table),
    "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
    "ppt/notesSlides/notesSlide1.xml": `<?xml version="1.0"?><p:notes ${P}><p:cSld><p:spTree>${sp("body", ["Mention the retry policy."])}</p:spTree></p:cSld></p:notes>`,
    "ppt/slides/slide2.xml": slide(sp("ctrTitle", ["Questions?"]) + `<p:pic><p:nvPicPr><p:cNvPr id="3" name="Picture" descr="Team photo"/></p:nvPicPr></p:pic>`),
  });
}

export async function sampleXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Latency");
  ws.addRow(["Service", "p50", "p99", "Measured"]);
  ws.addRow(["gateway", 12, 120, new Date(Date.UTC(2026, 8, 1))]);
  ws.addRow(["auth | sso", 8, { formula: "B3*10", result: 80 }, new Date(Date.UTC(2026, 8, 2))]);
  wb.addWorksheet("Empty");
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const ODF_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';
const odf = (body: string) => zip({ mimetype: "application/vnd.oasis.opendocument", "content.xml": `<?xml version="1.0"?><office:document-content ${ODF_NS}><office:body>${body}</office:body></office:document-content>` });
export const sampleOdt = () =>
  odf(
    `<office:text><text:h text:outline-level="1">Requirements</text:h><text:p>Must<text:s text:c="2"/>be <text:a xlink:href="https://example.org">fast</text:a>.</text:p><text:list><text:list-item><text:p>Low latency</text:p><text:list><text:list-item><text:p>p99 under 200 ms</text:p></text:list-item></text:list></text:list-item></text:list><table:table><table:table-row><table:table-cell><text:p>Key</text:p></table:table-cell><table:table-cell><text:p>Value</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>a</text:p></table:table-cell><table:table-cell><text:p>1</text:p></table:table-cell></table:table-row></table:table></office:text>`,
  );
export const sampleOdp = () =>
  odf(
    `<office:presentation><draw:page draw:name="page1"><draw:frame presentation:class="title"><draw:text-box><text:p>Roadmap</text:p></draw:text-box></draw:frame><draw:frame presentation:class="outline"><draw:text-box><text:list><text:list-item><text:p>Q1: beta</text:p></text:list-item></text:list></draw:text-box></draw:frame><presentation:notes><draw:frame><draw:text-box><text:p>Keep it short.</text:p></draw:text-box></draw:frame></presentation:notes></draw:page></office:presentation>`,
  );
export const sampleOds = () =>
  odf(
    `<office:spreadsheet><table:table table:name="Budget"><table:table-row><table:table-cell><text:p>Item</text:p></table:table-cell><table:table-cell><text:p>Cost</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1000"/></table:table-row><table:table-row><table:table-cell><text:p>Servers</text:p></table:table-cell><table:table-cell><text:p>1200</text:p></table:table-cell></table:table-row><table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row></table:table></office:spreadsheet>`,
  );

export const sampleRtf = () =>
  strToU8(String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times;}}{\*\generator Test;}{\info{\title Hidden}}\f0 Caff\'e8 \b bold\b0  text.\par Second \u8364? line\tab end.\par}`);

export const sampleHtml = () => strToU8(`<html><head><title>Guide</title><style>p{}</style></head><body><h1>Setup</h1><p>Run <code>pnpm dev</code>.</p><ul><li>one</li></ul><img src="x.png" alt="diagram"></body></html>`);

export function sampleEpub(): Uint8Array {
  return zip({
    mimetype: "application/epub+zip",
    "META-INF/container.xml": `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
    "OEBPS/content.opf": `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="c1" href="ch1.xhtml"/><item id="c2" href="text/ch2.xhtml"/></manifest><spine><itemref idref="c2"/><itemref idref="c1"/></spine></package>`,
    "OEBPS/ch1.xhtml": `<html><body><h1>Chapter One</h1><p>First text.</p></body></html>`,
    "OEBPS/text/ch2.xhtml": `<html><body><h1>Prologue</h1><p>Before everything.</p></body></html>`,
  });
}

export const sampleIpynb = () =>
  strToU8(
    JSON.stringify({
      metadata: { language_info: { name: "python" } },
      cells: [
        { cell_type: "markdown", source: ["# Analysis\n", "Load the data."] },
        { cell_type: "code", source: "print(1 + 1)", outputs: [{ output_type: "stream", text: ["2\n"] }] },
        { cell_type: "code", source: "plot()", outputs: [{ output_type: "display_data", data: { "image/png": "iVBOR", "text/plain": "<Figure>" } }] },
      ],
    }),
  );

export const sampleEml = () =>
  strToU8(
    [
      "From: Anna <anna@example.org>",
      "To: Marco <marco@example.org>",
      "Subject: Meeting notes",
      "Date: Tue, 01 Sep 2026 10:00:00 +0000",
      'Content-Type: multipart/mixed; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "We agreed on the API.",
      "--b",
      'Content-Type: text/csv; name="data.csv"',
      'Content-Disposition: attachment; filename="data.csv"',
      "",
      "a,b",
      "--b--",
      "",
    ].join("\r\n"),
  );

export const sampleZip = () => zip({ "notes/readme.md": "# Readme\n\nHello.", "spec.docx": sampleDocx(), "logo.bin": new Uint8Array([1, 2, 3]), "__MACOSX/x": "junk" });
