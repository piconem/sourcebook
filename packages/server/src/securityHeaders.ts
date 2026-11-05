import type { FastifyInstance } from "fastify";

/**
 * Policy for files people upload or write (block assets, reference files) when opened directly in the browser:
 * an SVG or HTML file then runs in a sandbox — no scripts, no forms, no access to Sourcebook's origin — so it cannot
 * act with the rights of whoever opens it. Images and styles inside the file still show.
 */
export const UNTRUSTED_FILE_CSP = "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";

/**
 * Headers on every response:
 * - nosniff: the browser keeps the declared type (an uploaded file is never re-interpreted as HTML or script);
 * - frames only from Sourcebook itself (the reference viewer embeds files), not from other sites (clickjacking);
 * - no full URLs (project and file names) sent to other sites as Referer.
 */
export function registerSecurityHeaders(app: FastifyInstance) {
  app.addHook("onSend", async (_req, reply, payload) => {
    if (!reply.hasHeader("x-content-type-options")) reply.header("x-content-type-options", "nosniff");
    if (!reply.hasHeader("x-frame-options")) reply.header("x-frame-options", "SAMEORIGIN");
    if (!reply.hasHeader("referrer-policy")) reply.header("referrer-policy", "same-origin");
    if (!reply.hasHeader("cross-origin-resource-policy")) reply.header("cross-origin-resource-policy", "same-origin");
    return payload;
  });
}
