/** Worker thread running document conversions, so the server stays responsive while they run. */
import { parentPort } from "node:worker_threads";
import { convertDocument, renderPdfPages } from "./index.js";

export type ConvertTask = { type: "convert"; data: Uint8Array; name: string } | { type: "render"; data: Uint8Array; pages: number[] };

parentPort!.on("message", async ({ id, task }: { id: number; task: ConvertTask }) => {
  try {
    const result = task.type === "convert" ? await convertDocument(task.data, task.name) : await renderPdfPages(task.data, task.pages);
    parentPort!.postMessage({ id, result });
  } catch (e) {
    parentPort!.postMessage({ id, error: (e as Error)?.message || String(e) });
  }
});
