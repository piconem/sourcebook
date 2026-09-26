import type { NotebookKind } from "@sourcebook/shared";

/**
 * References used in conversation and by tools:
 *   §2.1            section 2.1 (the "§" is optional)
 *   §2.1#3          3rd sub-block of section 2.1
 *   §2.1#3:L10-14   lines 10–14 of that sub-block's source (also :L10)
 *   §2.1#3!c<id>    a comment on that sub-block
 *   <id>            a section, sub-block or comment id
 *   sourcebook://projects/<pid>/sections/<blockId> · …/subblocks/<id>[#L10-14] · …/comments/<id>
 * A project can prefix the short forms: "projects/<id>§2.1", "templates/<id>§1#2".
 */
export type ParsedRef =
  | { kind: "outline"; number: string; subIndex?: number; lines?: LineRange; commentId?: string; project?: ProjectRef }
  | { kind: "id"; id: string; lines?: LineRange; project?: ProjectRef };

export interface LineRange {
  first: number;
  last: number;
}
export interface ProjectRef {
  kind: NotebookKind;
  id: string;
}

const ID = /^[A-Za-z0-9_-]{4,64}$/;

export class RefError extends Error {}

/** "projects/x", "templates/y" or a bare id (a project). */
export function parseProject(value: string): ProjectRef {
  const m = /^(?:sourcebook:\/\/)?(projects|templates)\/([a-z0-9][a-z0-9-]*)\/?$/.exec(value.trim());
  if (m) return { kind: m[1] as NotebookKind, id: m[2] };
  if (/^[a-z0-9][a-z0-9-]*$/.test(value.trim())) return { kind: "projects", id: value.trim() };
  throw new RefError(`Invalid project "${value}": use a project id, "projects/<id>" or "templates/<id>".`);
}

function parseLines(spec: string | undefined): LineRange | undefined {
  if (!spec) return undefined;
  const m = /^L?(\d+)(?:\s*-\s*L?(\d+))?$/i.exec(spec);
  if (!m) throw new RefError(`Invalid line range "${spec}": use L10 or L10-14.`);
  const first = Number(m[1]);
  const last = Number(m[2] ?? m[1]);
  if (first < 1 || last < first) throw new RefError(`Invalid line range "${spec}".`);
  return { first, last };
}

export function parseRef(input: string): ParsedRef {
  const value = input.trim();
  // URI form
  const uri = /^sourcebook:\/\/(projects|templates)\/([a-z0-9][a-z0-9-]*)\/(sections|subblocks|comments)\/([A-Za-z0-9_-]+)(?:#(L\d+(?:-L?\d+)?))?$/.exec(value);
  if (uri) {
    return { kind: "id", id: uri[4], lines: parseLines(uri[5]), project: { kind: uri[1] as NotebookKind, id: uri[2] } };
  }
  // Optional project prefix for short forms
  let rest = value;
  let project: ProjectRef | undefined;
  const pre = /^(projects|templates)\/([a-z0-9][a-z0-9-]*)(?=§|\s|$)\s*/.exec(rest);
  if (pre) {
    project = { kind: pre[1] as NotebookKind, id: pre[2] };
    rest = rest.slice(pre[0].length);
  }
  const outline = /^§?\s*(\d+(?:\.\d+)*)(?:\s*#(\d+))?(?:\s*:\s*(L\d+(?:\s*-\s*L?\d+)?))?(?:\s*!c([A-Za-z0-9_-]+))?$/i.exec(rest);
  if (outline) {
    const subIndex = outline[2] ? Number(outline[2]) : undefined;
    if (subIndex === 0) throw new RefError("Sub-block numbers start at #1.");
    if ((outline[3] || outline[4]) && subIndex === undefined) throw new RefError(`"${input}": lines and comments belong to a sub-block, e.g. §2.1#3:L10-14.`);
    return { kind: "outline", number: outline[1], subIndex, lines: parseLines(outline[3]), commentId: outline[4], project };
  }
  const idWithLines = /^([A-Za-z0-9_-]+)(?::(L\d+(?:-L?\d+)?))?$/.exec(rest);
  if (idWithLines && ID.test(idWithLines[1])) return { kind: "id", id: idWithLines[1], lines: parseLines(idWithLines[2]), project };
  throw new RefError(
    `Cannot understand the reference "${input}". Use §2.1 (section), §2.1#3 (sub-block), §2.1#3:L10-14 (lines), an id, or a sourcebook:// URI.`,
  );
}

export const projectPath = (p: ProjectRef) => `/api/${p.kind}/${p.id}`;
export const projectLabel = (p: ProjectRef) => `${p.kind}/${p.id}`;
export const uriOf = (p: ProjectRef, what: "sections" | "subblocks" | "comments", id: string) =>
  `sourcebook://${p.kind}/${p.id}/${what}/${id}`;
