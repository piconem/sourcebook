import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  AssetFromReferenceBodySchema,
  BlockIdParamsSchema,
  IMAGE_ASSET_EXT,
  ImageFromReferenceBodySchema,
  extOfName,
  type AssetFromReferenceResult,
  type ReferenceImageSource,
  type ReferenceImages,
  type ReferenceNode,
} from "@sourcebook/shared";
import { readFile } from "node:fs/promises";
import { badRequest, notFound } from "../errors.js";
import type { NotebookContext } from "../store/WorkspaceStore.js";
import { validatePath } from "../store/ReferencesStore.js";

/** The bytes of an image reference or of a figure of a converted document, with its caption. */
async function resolveImage(nb: NotebookContext, src: ReferenceImageSource) {
  const path = validatePath(src.path);
  const name = path.split("/").pop()!;
  if (src.figure) {
    const content = await nb.refs.mcp.content(path);
    const fig = content?.manifest.parts.flatMap((p) => p.figures ?? []).find((f) => f.id === src.figure);
    const file = fig && (await nb.refs.mcp.figureImage(path, fig.id));
    if (!fig || !file) throw notFound(`Figure ${src.figure} of references/${path}`);
    return { path, data: await readFile(file), ext: "webp", caption: fig.caption ?? "", alt: `${name.replace(/\.[^.]+$/, "")}, page ${fig.page}` };
  }
  if (!IMAGE_ASSET_EXT.test(name)) throw badRequest(`references/${path} is not an image (png, jpg, gif, webp, svg, avif)`);
  const { abs } = await nb.refs.file(path);
  return { path, data: await readFile(abs), ext: extOfName(name), caption: "", alt: name.replace(/\.[^.]+$/, "") };
}

export const referenceImageRoutes =
  (): FastifyPluginAsyncZod =>
  async (app) => {
    /** Image files of the references and figures of their converted documents. */
    app.get("/references/images", async (req): Promise<ReferenceImages> => {
      const files: ReferenceNode[] = [];
      const walk = (n: ReferenceNode) => (n.kind === "file" ? files.push(n) : n.children?.forEach(walk));
      walk(await req.nb.refs.tree());
      const documents: ReferenceImages["documents"] = [];
      for (const f of files.filter((f) => f.mcp?.kind === "markdown" && f.mcp.figures)) {
        const figures = (await req.nb.refs.mcp.content(f.path))?.manifest.parts.flatMap((p) => p.figures ?? []) ?? [];
        if (figures.length) documents.push({ path: f.path, name: f.name, figures });
      }
      return {
        images: files.filter((f) => IMAGE_ASSET_EXT.test(f.name)).map((f) => ({ path: f.path, name: f.name, size: f.size })),
        documents,
      };
    });

    /**
     * Copies an image reference (or a figure) into the block's assets — the image sub-block keeps working if the
     * reference changes — and attaches the source file to a sub-block when asked.
     */
    app.post(
      "/blocks/:id/assets/from-reference",
      { schema: { params: BlockIdParamsSchema, body: AssetFromReferenceBodySchema } },
      async (req, reply): Promise<AssetFromReferenceResult> => {
        const img = await resolveImage(req.nb, req.body);
        const path = await req.nb.store.saveAsset(req.params.id, img.ext, img.data);
        if (req.body.attachTo) await req.nb.store.attachReferences(req.params.id, req.body.attachTo, [img.path]);
        reply.code(201);
        return { path, url: `${req.server.basePath}/api/${req.nb.kind}/${req.nb.id}/blocks/${req.params.id}/files/${path}`, alt: img.alt, caption: img.caption };
      },
    );

    /** A new image sub-block from an image reference or a figure (caption defaults to the figure's). */
    app.post(
      "/blocks/:id/images/from-reference",
      { schema: { params: BlockIdParamsSchema, body: ImageFromReferenceBodySchema } },
      async (req, reply) => {
        const img = await resolveImage(req.nb, req.body);
        const src = await req.nb.store.saveAsset(req.params.id, img.ext, img.data);
        const sub = await req.nb.store.addSubBlock(req.params.id, {
          type: "image",
          content: { src, alt: req.body.alt ?? img.alt, caption: req.body.caption ?? img.caption },
          ...(req.body.title ? { title: req.body.title } : {}),
          ...(req.body.position !== undefined ? { position: req.body.position } : {}),
        });
        await req.nb.store.attachReferences(req.params.id, sub.id, [img.path]);
        reply.code(201);
        return { ...sub, references: [img.path] };
      },
    );
  };
