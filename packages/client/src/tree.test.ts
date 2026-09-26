import { describe, expect, it } from "vitest";
import { applyDrop, getProjection, outlineNumbers, withDepth } from "./tree";

const items = withDepth([
  { id: "a", title: "A", parentId: null },
  { id: "a1", title: "A1", parentId: "a" },
  { id: "b", title: "B", parentId: null },
  { id: "c", title: "C", parentId: null },
]);

describe("outline tree helpers", () => {
  it("numbers the outline", () => {
    expect([...outlineNumbers(items).values()]).toEqual(["1", "1.1", "2", "3"]);
  });

  it("nests when dragged right under a sibling", () => {
    expect(getProjection(items, "c", "c", 40, 20)).toEqual({ depth: 1, parentId: "b" });
    expect(getProjection(items, "c", "c", 0, 20)).toEqual({ depth: 0, parentId: null });
  });

  it("moves a block with its subtree", () => {
    expect(applyDrop(items, "a", "c", null)).toEqual([
      { id: "b", parentId: null },
      { id: "c", parentId: null },
      { id: "a", parentId: null },
      { id: "a1", parentId: "a" },
    ]);
  });
});
