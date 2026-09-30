import MsgReader from "@kenjiuno/msgreader";
import { strFromU8 } from "fflate";
import { simpleParser } from "mailparser";
import { htmlToMarkdown, paragraphs, shiftHeadings, type Conversion, type ConvertedPart } from "./common.js";
import { attr, child, children, descendants, resolvePath, unzip, xmlEntry } from "./xml.js";

const decodeText = (data: Uint8Array) => new TextDecoder("utf-8").decode(data);

// ---------------------------------------------------------------- RTF

const CP1252: Record<number, string> = { 0x80: "€", 0x82: "‚", 0x84: "„", 0x85: "…", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x99: "™" };
/** Groups whose content is not document text. */
const SKIP_GROUPS = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "headerl", "headerr", "footerl", "footerr", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "themedata", "colorschememapping", "latentstyles", "datastore", "fldinst"]);

/** Plain text of an RTF document (paragraphs, tabs, \'hh and \uN characters). */
export function rtfToText(rtf: string): string {
  let out = "";
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let pendingSkip = 0; // characters to drop after \uN
  let i = 0;
  const emit = (s: string) => {
    if (skip) return;
    if (pendingSkip > 0) {
      pendingSkip--;
      return;
    }
    out += s;
  };
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === "{") {
      stack.push({ skip, uc });
      i++;
      // Destination groups: {\*\foo …} and known non-text groups.
      const m = /^\\(\*\\)?([a-z]+)/.exec(rtf.slice(i, i + 40));
      if (m && (m[1] || SKIP_GROUPS.has(m[2]))) skip = true;
    } else if (ch === "}") {
      ({ skip, uc } = stack.pop() ?? { skip: false, uc: 1 });
      i++;
    } else if (ch === "\\") {
      const next = rtf[i + 1];
      if (next === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16);
        emit(CP1252[code] ?? String.fromCharCode(code));
        i += 4;
      } else if (next === "\\" || next === "{" || next === "}") {
        emit(next);
        i += 2;
      } else if (next === "~") {
        emit(" ");
        i += 2;
      } else if (next === "-" || next === "*") i += 2;
      else if (next === "_") {
        emit("-");
        i += 2;
      } else if (next === "\n" || next === "\r") {
        emit("\n");
        i += 2;
      } else {
        const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
        if (!m) {
          i += 2;
          continue;
        }
        i += m[0].length;
        const [, word, num] = m;
        if (word === "par" || word === "line" || word === "sect" || word === "page") emit("\n");
        else if (word === "tab" || word === "cell") emit("\t");
        else if (word === "row") emit("\n");
        else if (word === "uc") uc = Number(num ?? 1);
        else if (word === "u") {
          const code = Number(num);
          emit(String.fromCharCode(code < 0 ? code + 65536 : code));
          pendingSkip = uc;
        } else if (word === "emdash") emit("—");
        else if (word === "endash") emit("–");
        else if (word === "bullet") emit("•");
        else if (word === "lquote") emit("‘");
        else if (word === "rquote") emit("’");
        else if (word === "ldblquote") emit("“");
        else if (word === "rdblquote") emit("”");
      }
    } else {
      if (ch !== "\r" && ch !== "\n") emit(ch);
      i++;
    }
  }
  return out;
}

export async function convertRtf(data: Uint8Array): Promise<Conversion> {
  const text = rtfToText(new TextDecoder("latin1").decode(data));
  const markdown = text
    .split("\n")
    .map((l) => l.replace(/\t+/g, " | ").replace(/[ \u00A0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  return { unit: "document", parts: [{ n: 1, markdown }], warnings: ["RTF: text only (no formatting)."], converter: "Sourcebook RTF reader" };
}

// ---------------------------------------------------------------- HTML, EPUB

export async function convertHtml(data: Uint8Array): Promise<Conversion> {
  const html = decodeText(data);
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  return { unit: "document", parts: [{ n: 1, title: title || undefined, markdown: shiftHeadings(htmlToMarkdown(html)) }], warnings: [], converter: "turndown" };
}

export async function convertEpub(data: Uint8Array): Promise<Conversion> {
  const files = unzip(data);
  const container = xmlEntry(files, "META-INF/container.xml");
  const opfPath = attr(descendants(container, "rootfile")[0], "full-path");
  if (!opfPath) throw new Error("Not an EPUB: META-INF/container.xml has no rootfile");
  const opf = xmlEntry(files, opfPath);
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const items = new Map(descendants(child(opf, "manifest"), "item").map((it) => [attr(it, "id") ?? "", resolvePath(base, attr(it, "href") ?? "")]));
  const parts: ConvertedPart[] = [];
  for (const ref of children(child(opf, "spine"), "itemref")) {
    const path = items.get(attr(ref, "idref") ?? "");
    if (!path || !files[path]) continue;
    const html = strFromU8(files[path]);
    const markdown = shiftHeadings(htmlToMarkdown(html));
    if (!markdown.trim()) continue;
    const title = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim() || /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
    parts.push({ n: parts.length + 1, title: title || undefined, markdown });
  }
  return { unit: "chapter", parts, warnings: [], converter: "Sourcebook EPUB reader + turndown" };
}

// ---------------------------------------------------------------- Jupyter

interface NotebookCell {
  cell_type: string;
  source: string | string[];
  outputs?: { output_type: string; text?: string | string[]; data?: Record<string, string | string[]>; ename?: string; evalue?: string }[];
}
const joined = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join("") : (s ?? ""));
const clip = (s: string, n = 2000) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s);

export async function convertIpynb(data: Uint8Array): Promise<Conversion> {
  const nb = JSON.parse(decodeText(data)) as { cells?: NotebookCell[]; metadata?: { language_info?: { name?: string }; kernelspec?: { language?: string } } };
  const lang = nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? "";
  const blocks: string[] = [];
  for (const cell of nb.cells ?? []) {
    const src = joined(cell.source).trim();
    if (cell.cell_type === "markdown") {
      if (src) blocks.push(shiftHeadings(src));
    } else if (cell.cell_type === "code") {
      if (src) blocks.push(`\`\`\`${lang}\n${src}\n\`\`\``);
      for (const o of cell.outputs ?? []) {
        if (o.output_type === "stream") blocks.push(`Output:\n\n\`\`\`\n${clip(joined(o.text).trimEnd())}\n\`\`\``);
        else if (o.output_type === "error") blocks.push(`Error: \`${o.ename}: ${o.evalue}\``);
        else if (o.data) {
          if (o.data["text/markdown"]) blocks.push(joined(o.data["text/markdown"]));
          else if (o.data["image/png"] || o.data["image/jpeg"] || o.data["image/svg+xml"]) blocks.push("_[image output]_");
          else if (o.data["text/plain"]) blocks.push(`Result:\n\n\`\`\`\n${clip(joined(o.data["text/plain"]).trimEnd())}\n\`\`\``);
        }
      }
    } else if (src) blocks.push(src);
  }
  return { unit: "document", parts: [{ n: 1, markdown: blocks.join("\n\n") }], warnings: [], converter: "Sourcebook notebook reader" };
}

// ---------------------------------------------------------------- Email

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function emailMarkdown(h: { subject?: string; from?: string; to?: string; cc?: string; date?: string }, body: string, attachments: string[]): string {
  const head = [
    h.from && `**From:** ${h.from}`,
    h.to && `**To:** ${h.to}`,
    h.cc && `**Cc:** ${h.cc}`,
    h.date && `**Date:** ${h.date}`,
  ].filter(Boolean);
  return [head.join("  \n"), body.trim(), attachments.length ? `**Attachments:**\n\n${attachments.map((a) => `- ${a}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
}

export async function convertEml(data: Uint8Array): Promise<Conversion> {
  const mail = await simpleParser(Buffer.from(data));
  const addr = (a: typeof mail.to) => (Array.isArray(a) ? a.map((x) => x.text).join(", ") : a?.text);
  const body = mail.html ? shiftHeadings(htmlToMarkdown(mail.html)) : paragraphs(mail.text ?? "");
  const markdown = emailMarkdown(
    { from: mail.from?.text, to: addr(mail.to), cc: addr(mail.cc), date: mail.date?.toISOString() },
    body,
    mail.attachments.map((a) => `${a.filename ?? "(unnamed)"} (${a.contentType}, ${size(a.size)})`),
  );
  return { unit: "document", parts: [{ n: 1, title: mail.subject || "(no subject)", markdown }], warnings: [], converter: "mailparser" };
}

export async function convertMsg(data: Uint8Array): Promise<Conversion> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const msg = new MsgReader(buf).getFileData();
  if (msg.error) throw new Error(msg.error);
  const to = (msg.recipients ?? []).map((r) => `${r.name ?? ""}${r.email ? ` <${r.email}>` : ""}`.trim()).join(", ");
  const html = msg.html ? new TextDecoder().decode(msg.html) : msg.bodyHtml;
  const body = html ? shiftHeadings(htmlToMarkdown(html)) : paragraphs(msg.body ?? "");
  const markdown = emailMarkdown(
    { from: `${msg.senderName ?? ""}${msg.senderEmail ? ` <${msg.senderEmail}>` : ""}`.trim(), to, date: msg.messageDeliveryTime ?? msg.clientSubmitTime },
    body,
    (msg.attachments ?? []).map((a) => `${a.fileName ?? a.name ?? "(unnamed)"}${a.contentLength ? ` (${size(a.contentLength)})` : ""}`),
  );
  return { unit: "document", parts: [{ n: 1, title: msg.subject || "(no subject)", markdown }], warnings: [], converter: "@kenjiuno/msgreader" };
}
