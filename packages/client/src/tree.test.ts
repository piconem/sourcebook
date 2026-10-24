import { describe, expect, it } from "vitest";
import { ancestorsOf, applyDrop, getProjection, hiddenByCollapse, outlineNumbers, withDepth } from "./tree";

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

  it("keeps the children of a collapsed section under it when dropping right after it", () => {
    // c dragged up onto a1's position while "a" is collapsed: list order a, c, a1 must regroup.
    const placement = applyDrop(items, "c", "b", null);
    expect(placement).toEqual([
      { id: "a", parentId: null },
      { id: "a1", parentId: "a" },
      { id: "c", parentId: null },
      { id: "b", parentId: null },
    ]);
    const odd = applyDrop(items, "b", "a1", null);
    expect(odd.map((p) => p.id)).toEqual(["a", "a1", "b", "c"]);
    expect(odd.find((p) => p.id === "a1")?.parentId).toBe("a");
  });

  it("hides the descendants of collapsed sections", () => {
    const deep = withDepth([
      { id: "a", title: "A", parentId: null },
      { id: "a1", title: "A1", parentId: "a" },
      { id: "a11", title: "A11", parentId: "a1" },
      { id: "b", title: "B", parentId: null },
    ]);
    expect([...hiddenByCollapse(deep, new Set(["a"]))]).toEqual(["a1", "a11"]);
    expect([...hiddenByCollapse(deep, new Set(["a1"]))]).toEqual(["a11"]);
    expect(ancestorsOf(deep, "a11")).toEqual(["a1", "a"]);
  });
});
