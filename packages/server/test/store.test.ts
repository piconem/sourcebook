import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createServerRegistry } from "../src/registry.js";
import { NotebookStore } from "../src/store/NotebookStore.js";
import { PNG_B64, ls, readJsonFile, tempProject } from "./helpers.js";

let root: string;
let store: NotebookStore;
const blocks = () => ls(join(root, "blocks"));

beforeEach(async () => {
  root = await tempProject();
  store = await NotebookStore.open(root, createServerRegistry());
});

describe("NotebookStore blocks", () => {
  it("initializes an empty project", async () => {
    expect(await readJsonFile(join(root, "notebook.json"))).toEqual({ version: 1, blocks: [] });
  });

  it("creates blocks with numbered folders and inserts at a position", async () => {
    await store.createBlock({ title: "Introduction" });
    await store.createBlock({ title: "Architecture" });
    await store.createBlock({ title: "Goals & Scope", position: 1 });
    expect(await blocks()).toEqual(["001-introduction", "002-goals-scope", "003-architecture"]);
    const index = await readJsonFile(join(root, "notebook.json"));
    expect(index.blocks.map((b: { title: string }) => b.title)).toEqual(["Introduction", "Goals & Scope", "Architecture"]);
  });

  it("nests blocks depth-first and renames on title change", async () => {
    const a = await store.createBlock({ title: "A" });
    const b = await store.createBlock({ title: "B" });
    await store.createBlock({ title: "A child", parentId: a.id });
    expect(await blocks()).toEqual(["001-a", "002-a-child", "003-b"]);
    await store.updateBlock(b.id, { title: "Bee" });
    expect(await blocks()).toEqual(["001-a", "002-a-child", "003-bee"]);
    const meta = await readJsonFile(join(root, "blocks/003-bee/block.json"));
    expect(meta).toMatchObject({ id: b.id, title: "Bee", order: 3, parentId: null });
  });

  it("reorders (swapping prefixes) and re-parents", async () => {
    const a = await store.createBlock({ title: "A" });
    const b = await store.createBlock({ title: "B" });
    const c = await store.createBlock({ title: "C" });
    await store.reorderBlocks({
      blocks: [
        { id: c.id, parentId: null },
        { id: a.id, parentId: c.id },
        { id: b.id, parentId: null },
      ],
    });
    expect(await blocks()).toEqual(["001-c", "002-a", "003-b"]);
    expect(store.depth(a.id)).toBe(1);
  });

  it("rejects cycles and incomplete reorders", async () => {
    const a = await store.createBlock({ title: "A" });
    const b = await store.createBlock({ title: "B", parentId: a.id });
    await expect(store.updateBlock(a.id, { parentId: b.id })).rejects.toThrow(/inside itself/);
    await expect(store.reorderBlocks({ blocks: [{ id: a.id, parentId: null }] })).rejects.toThrow(/every block/);
  });

  it("deletes a block with its descendants", async () => {
    const a = await store.createBlock({ title: "A" });
    await store.createBlock({ title: "A1", parentId: a.id });
    await store.createBlock({ title: "B" });
    await store.deleteBlock(a.id);
    expect(await blocks()).toEqual(["001-b"]);
    expect(store.getProject().blocks).toHaveLength(1);
  });
});

describe("NotebookStore sub-blocks", () => {
  it("adds, updates with exports, reorders and deletes sub-blocks", async () => {
    const blk = await store.createBlock({ title: "Intro" });
    const md = await store.addSubBlock(blk.id, { type: "markdown", content: { markdown: "Hello" } });
    const mm = await store.addSubBlock(blk.id, { type: "mermaid" });
    await store.updateSubBlock(blk.id, mm.id, {
      content: { code: "graph TD; A-->B" },
      exports: [{ ext: "png", mimeType: "image/png", dataBase64: PNG_B64 }],
    });
    const dir = join(root, "blocks/001-intro/subblocks");
    expect(await ls(dir)).toEqual(["01-markdown.md", "02-mermaid.mmd", "02-mermaid.png"]);

    await store.reorderSubBlocks(blk.id, [mm.id, md.id]);
    expect(await ls(dir)).toEqual(["01-mermaid.mmd", "01-mermaid.png", "02-markdown.md"]);
    const full = await store.getBlock(blk.id);
    expect(full.subBlocks.map((s) => s.content)).toEqual([{ code: "graph TD; A-->B" }, { markdown: "Hello" }]);

    await store.deleteSubBlock(blk.id, mm.id);
    expect(await ls(dir)).toEqual(["01-markdown.md"]);
  });

  it("validates content against the type registry", async () => {
    const blk = await store.createBlock({ title: "X" });
    await expect(store.addSubBlock(blk.id, { type: "nope" })).rejects.toThrow(/Unknown sub-block type/);
    await expect(store.addSubBlock(blk.id, { type: "mermaid", content: { code: 3 } })).rejects.toThrow(/Invalid/);
    await expect(
      store.addSubBlock(blk.id, { type: "markdown", content: { markdown: "<script>alert(1)</script>" } }),
    ).rejects.toThrow(/Invalid markdown/);
  });
});
