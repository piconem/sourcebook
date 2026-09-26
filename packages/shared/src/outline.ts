/** Outline helpers shared by the web client and the MCP server. */

export interface FlatItem {
  id: string;
  title: string;
  parentId: string | null;
  depth: number;
}

/** Builds depth info from the server's depth-first ordered list. */
export function withDepth<T extends { id: string; title: string; parentId: string | null }>(blocks: T[]): FlatItem[] {
  const depth = new Map<string, number>();
  return blocks.map((b) => {
    const d = b.parentId ? (depth.get(b.parentId) ?? 0) + 1 : 0;
    depth.set(b.id, d);
    return { id: b.id, title: b.title, parentId: b.parentId, depth: d };
  });
}

/** Outline numbers: "1", "1.1", "1.2", "2", … */
export function outlineNumbers(items: FlatItem[]): Map<string, string> {
  const counters: number[] = [];
  const out = new Map<string, string>();
  for (const item of items) {
    counters.length = item.depth + 1;
    counters[item.depth] = (counters[item.depth] ?? 0) + 1;
    out.set(item.id, counters.map((c) => c ?? 1).join("."));
  }
  return out;
}
