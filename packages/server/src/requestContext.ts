import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request context: which client caused a change (header x-sourcebook-client), for live events. */
export const requestContext = new AsyncLocalStorage<{ origin: string }>();

export const currentOrigin = () => requestContext.getStore()?.origin ?? "server";
