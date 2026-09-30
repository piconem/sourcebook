import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  BibKeySchema,
  CitationsBodySchema,
  CreateBibEntryBodySchema,
  GenerateBibBodySchema,
  ImportBibtexBodySchema,
  SubBlockParamsSchema,
  BlockIdParamsSchema,
  UpdateBibEntryBodySchema,
  generateBibtex,
  generateTextCitation,
} from "@sourcebook/shared";
import { z } from "zod";
import { badRequest } from "../errors.js";

const keyParams = z.object({ key: BibKeySchema });

/** A project's bibliography and the association of entries with sections and sub-blocks. */
export const bibliographyRoutes = (): FastifyPluginAsyncZod => async (app) => {
  app.get(
    "/bibliography",
    { schema: { querystring: z.object({ q: z.string().optional(), type: z.string().optional() }) } },
    async (req) => req.nb.bib.list(req.query),
  );

  app.post("/bibliography", { schema: { body: CreateBibEntryBodySchema } }, async (req, reply) => {
    reply.code(201);
    return req.nb.bib.create(req.body);
  });

  /** BibTeX and text citation built from fields, without saving (the "Generate" buttons). */
  app.post("/bibliography/generate", { schema: { body: GenerateBibBodySchema } }, async (req) => ({
    bibtex: generateBibtex(req.body),
    textCitation: generateTextCitation(req.body),
  }));

  app.post("/bibliography/import", { schema: { body: ImportBibtexBodySchema } }, async (req) =>
    req.nb.bib.import(req.body.bibtex, req.body.onDuplicate),
  );

  app.get("/bibliography.bib", async (req, reply) => {
    reply.type("application/x-bibtex; charset=utf-8").header("content-disposition", `attachment; filename="bibliography.bib"`);
    return req.nb.bib.exportBib();
  });

  app.get("/bibliography/:key", { schema: { params: keyParams } }, async (req) => req.nb.bib.get(req.params.key));
  app.get("/bibliography/:key/usages", { schema: { params: keyParams } }, async (req) => {
    await req.nb.bib.get(req.params.key);
    return req.nb.bib.usages(req.params.key);
  });
  app.patch("/bibliography/:key", { schema: { params: keyParams, body: UpdateBibEntryBodySchema } }, async (req) =>
    req.nb.bib.update(req.params.key, req.body),
  );
  app.delete(
    "/bibliography/:key",
    { schema: { params: keyParams, querystring: z.object({ force: z.enum(["true", "false"]).optional() }) } },
    async (req) => req.nb.bib.delete(req.params.key, req.query.force === "true"),
  );

  // ---- associations ----
  const checkKeys = async (bib: { has(keys: string[]): Promise<string[]> }, keys: string[]) => {
    const unknown = await bib.has(keys);
    if (unknown.length) throw badRequest(`Unknown bibliography key(s): ${unknown.join(", ")}`);
  };
  app.put("/blocks/:id/citations", { schema: { params: BlockIdParamsSchema, body: CitationsBodySchema } }, async (req) => {
    await checkKeys(req.nb.bib, req.body.keys);
    return { keys: await req.nb.store.setSectionCitations(req.params.id, req.body.keys) };
  });
  app.put(
    "/blocks/:blockId/subblocks/:subBlockId/citations",
    { schema: { params: SubBlockParamsSchema, body: CitationsBodySchema } },
    async (req) => {
      await checkKeys(req.nb.bib, req.body.keys);
      return { keys: await req.nb.store.setSubBlockCitations(req.params.blockId, req.params.subBlockId, req.body.keys) };
    },
  );
};
