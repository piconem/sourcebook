import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Optional URL prefix in development (the server reads the same variable), e.g. /marco/sourcebook.
const basePath = (process.env.SOURCEBOOK_BASE_PATH ?? "").split("/").filter(Boolean).map((s) => `/${s}`).join("");
const server = process.env.SOURCEBOOK_DEV_SERVER ?? "http://127.0.0.1:4000";

export default defineConfig(({ command }) => ({
  // Builds use relative asset URLs, so one build works under any base path (the server injects it at runtime).
  base: command === "build" ? "./" : `${basePath}/`,
  plugins: [react()],
  // Required by @excalidraw/excalidraw when bundled with Vite.
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  // Pre-bundle lazily imported deps up front: re-optimizing mid-session reloads the page and can
  // briefly load two React copies ("Invalid hook call").
  optimizeDeps: {
    include: [
      "@excalidraw/excalidraw",
      "mermaid",
      "katex",
      "html-to-image",
      "codemirror",
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/language-data",
      "@lezer/highlight",
      "lowlight",
      "@tiptap/pm/tables",
      "@tiptap/pm/state",
    ],
  },
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    port: 5173,
    proxy: { [`${basePath}/api`]: server, [`${basePath}/mcp`]: server },
  },
}));
