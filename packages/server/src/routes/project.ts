import { zipSync, strToU8 } from "fflate";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compileProject } from "../markdown/remark.js";

export const projectRoutes =
  (): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/notebook", async (req) => req.nb.store.getProject());

    app.get("/markdown", async (req, reply) => {
      reply.type("text/markdown; charset=utf-8");
      return (await compileProject(req.nb.store)).markdown;
    });

    /** Compiled document plus the list of files an export archive would contain. */
    app.get("/export", async (req) => compileProject(req.nb.store));

    /**
     * Self-contained archive: the compiled Markdown at the root plus every referenced file at the
     * same relative path, so links keep working wherever the archive is extracted.
     */
    app.get("/export.zip", async (req, reply) => {
      const { fileName, markdown, files } = await compileProject(req.nb.store);
      const entries: Record<string, Uint8Array> = { [fileName]: strToU8(markdown) };
      for (const f of files) entries[f] = await readFile(join(req.nb.store.root, f));
      const zip = zipSync(entries, { level: 6 });
      const zipName = fileName.replace(/\.md$/, ".zip");
      reply
        .type("application/zip")
        .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);
      return Buffer.from(zip);
    });

  };
