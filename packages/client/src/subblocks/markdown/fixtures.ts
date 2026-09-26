export const fixtures: Record<string, string> = {
  headings: "# Title\n\n## Section\n\nParagraph text.",
  inline: "Some **bold**, *italic*, `code` and [a link](https://example.com).",
  bullets: "- one\n- two\n  - nested a\n  - nested b\n- three",
  ordered: "1. first\n2. second\n3. third",
  codeblock: "```ts\nconst x: number = 1;\n```",
  codeLang: "```python\ndef f(x):\n    return x * 2\n```",
  codeNoLang: "```\nplain text\n```",
  quote: "> quoted\n> text",
  image: "![alt text](../assets/pic.png)",
  table: "| a | b |\n| --- | --- |\n| 1 | 2 |",
  hr: "before\n\n---\n\nafter",
  hardbreak: "line one\\\nline two",
};
