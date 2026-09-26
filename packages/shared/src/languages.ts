/**
 * Languages offered by the code sub-block and by code blocks inside Markdown.
 * `id` is the Markdown fence info string (also understood by highlight.js / lowlight);
 * `ext` is the source file extension for code sub-blocks and must be unique.
 */
export interface CodeLanguage {
  id: string;
  label: string;
  ext: string;
}

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: "plaintext", label: "Plain text", ext: "txt" },
  { id: "bash", label: "Bash / Shell", ext: "sh" },
  { id: "c", label: "C", ext: "c" },
  { id: "cpp", label: "C++", ext: "cpp" },
  { id: "csharp", label: "C#", ext: "cs" },
  { id: "css", label: "CSS", ext: "css" },
  { id: "diff", label: "Diff", ext: "diff" },
  { id: "go", label: "Go", ext: "go" },
  { id: "graphql", label: "GraphQL", ext: "graphql" },
  { id: "html", label: "HTML", ext: "html" },
  { id: "ini", label: "INI", ext: "ini" },
  { id: "java", label: "Java", ext: "java" },
  { id: "javascript", label: "JavaScript", ext: "js" },
  { id: "jsx", label: "JSX", ext: "jsx" },
  { id: "json", label: "JSON", ext: "json" },
  { id: "kotlin", label: "Kotlin", ext: "kt" },
  { id: "lua", label: "Lua", ext: "lua" },
  { id: "makefile", label: "Makefile", ext: "mk" },
  { id: "markdown", label: "Markdown", ext: "md" },
  { id: "perl", label: "Perl", ext: "pl" },
  { id: "php", label: "PHP", ext: "php" },
  { id: "python", label: "Python", ext: "py" },
  { id: "r", label: "R", ext: "r" },
  { id: "ruby", label: "Ruby", ext: "rb" },
  { id: "rust", label: "Rust", ext: "rs" },
  { id: "scss", label: "SCSS", ext: "scss" },
  { id: "sql", label: "SQL", ext: "sql" },
  { id: "swift", label: "Swift", ext: "swift" },
  { id: "toml", label: "TOML", ext: "toml" },
  { id: "typescript", label: "TypeScript", ext: "ts" },
  { id: "tsx", label: "TSX", ext: "tsx" },
  { id: "xml", label: "XML", ext: "xml" },
  { id: "yaml", label: "YAML", ext: "yaml" },
];

export const languageById = (id: string) => CODE_LANGUAGES.find((l) => l.id === id);
export const languageByExt = (ext: string) => CODE_LANGUAGES.find((l) => l.ext === ext.toLowerCase());

/** Backtick fence long enough not to collide with backtick runs inside `code`. */
export function fenceFor(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((r) => r.length));
  return "`".repeat(Math.max(3, longest + 1));
}
