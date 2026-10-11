import { describe, expect, it } from "vitest";
import { choiceType, codeType, coreTypes, createCoreRegistry, imageType, markdownType, questionType } from "./index.js";

describe("core sub-block types", () => {
  it.each(coreTypes.map((t) => [t.type, t] as const))("%s round-trips its default content", (_n, t) => {
    const content = t.defaultContent();
    expect(t.contentSchema.parse(content)).toEqual(content);
    const sourceExt = t.sourceExtFor?.(content) ?? t.sourceExt;
    expect(t.deserialize(t.serialize(content).source, undefined, { sourceExt })).toEqual(content);
  });

  it("image round-trips a populated reference", () => {
    const c = { src: "assets/x1.png", alt: "Logo", caption: "The logo" };
    const { source } = imageType.serialize(c);
    expect(source).toBe('![Logo](../assets/x1.png "The logo")\n');
    expect(imageType.deserialize(source)).toEqual(c);
  });

  it("code stores its language in the file extension", () => {
    const c = { language: "python", code: "print('```')\n" };
    expect(codeType.sourceExtFor!(c)).toBe("py");
    expect(codeType.deserialize(c.code, undefined, { sourceExt: "py" })).toEqual(c);
    expect(codeType.toMarkdown(c, {} as never)).toBe("````python\nprint('```')\n````");
    expect(codeType.contentSchema.safeParse({ language: "cobol-2099", code: "" }).success).toBe(false);
  });

  it("question round-trips and tolerates a hand-written file", () => {
    const c = { question: "Which DB?", answer: "Postgres" };
    expect(questionType.deserialize(questionType.serialize(c).source)).toEqual(c);
    expect(questionType.deserialize("Just text")).toEqual({ question: "Just text", answer: "" });
    expect(questionType.toMarkdown({ question: "Q?", answer: "" }, {} as never)).toBe("**Q:** Q?\n\n**A:** _No answer yet_");
  });

  it("choice validates its selection", () => {
    const base = { question: "Pick", mode: "single" as const, options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], selected: ["a"], note: "why" };
    expect(choiceType.validate!(base)).toEqual({ ok: true });
    expect(choiceType.validate!({ ...base, selected: ["a", "b"] }).ok).toBe(false);
    expect(choiceType.validate!({ ...base, mode: "multiple", selected: ["a", "b"] }).ok).toBe(true);
    expect(choiceType.validate!({ ...base, selected: ["z"] }).ok).toBe(false);
    expect(choiceType.deserialize(choiceType.serialize(base).source)).toEqual(base);
    expect(choiceType.toMarkdown(base, {} as never)).toBe("**Pick** _(single answer)_\n\n- [x] A\n- [ ] B\n\n> why");
  });

  it("reports referenced assets", () => {
    expect(imageType.assetsOf!({ src: "assets/a.png", alt: "", caption: "" })).toEqual(["assets/a.png"]);
    expect(markdownType.assetsOf!({ markdown: "![x](../assets/b.png) [doc](../assets/c.pdf) ![](https://e.com/y.png)" }))
      .toEqual(["assets/b.png", "assets/c.pdf"]);
  });

  it("rejects duplicate registration", () => {
    const r = createCoreRegistry();
    expect(() => r.register(coreTypes[0])).toThrow();
    expect(r.list().map((t) => t.type)).toEqual(["markdown", "mermaid", "image", "drawing", "equation", "code", "question", "choice"]);
  });
});
