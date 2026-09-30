import { Worker } from "node:worker_threads";
import type { Conversion } from "./common.js";
import type { ConvertTask } from "./worker.js";

/** A conversion taking longer than this is abandoned (the worker is restarted). */
const TASK_TIMEOUT = 10 * 60 * 1000;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }>();

function failAll(error: Error) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(error);
  }
  pending.clear();
}

/** One long-lived worker (started on first use; TypeScript sources run through tsx, as the server does). */
function getWorker(): Worker {
  if (worker) return worker;
  const fromSource = import.meta.url.endsWith(".ts");
  const w = new Worker(new URL(`./worker.${fromSource ? "ts" : "js"}`, import.meta.url), {
    execArgv: fromSource ? ["--import", import.meta.resolve("tsx")] : [],
  });
  w.on("message", ({ id, result, error }: { id: number; result?: unknown; error?: string }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (error !== undefined) p.reject(new Error(error));
    else p.resolve(result);
    if (!pending.size) w.unref();
  });
  w.on("error", (e) => {
    failAll(e instanceof Error ? e : new Error(String(e)));
    worker = null;
  });
  w.on("exit", () => {
    failAll(new Error("The conversion worker stopped"));
    if (worker === w) worker = null;
  });
  worker = w;
  return w;
}

function run<T>(task: ConvertTask): Promise<T> {
  const w = getWorker();
  w.ref();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`The conversion took longer than ${TASK_TIMEOUT / 60000} minutes and was stopped`));
      void w.terminate();
    }, TASK_TIMEOUT);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    w.postMessage({ id, task });
  });
}

/** Converts a document to Markdown in the worker thread. */
export const convertInWorker = (data: Uint8Array, name: string) => run<Conversion>({ type: "convert", data, name });

/** Renders PDF pages as WebP images in the worker thread. */
export const renderInWorker = (data: Uint8Array, pages: number[]) => run<Map<number, Uint8Array>>({ type: "render", data, pages });

/** Stops the worker (tests, shutdown). */
export async function stopConversionWorker() {
  const w = worker;
  worker = null;
  await w?.terminate();
}
