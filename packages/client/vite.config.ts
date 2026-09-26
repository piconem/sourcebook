import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
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
    proxy: { "/api": "http://127.0.0.1:4000" },
  },
});
