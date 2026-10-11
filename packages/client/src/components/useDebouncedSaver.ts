import { useCallback, useEffect, useRef, useState } from "react";

/** Flush functions of every mounted saver (to save everything before a page reload). */
const savers = new Set<() => Promise<void>>();

/** Saves every pending edit now. */
export async function flushAllSaves() {
  await Promise.allSettled([...savers].map((f) => f()));
}

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/** Debounces saves; always persists the latest value and flushes on unmount. */
export function useDebouncedSaver<T>(save: (value: T) => Promise<void>, delay = 600) {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const running = useRef<Promise<void> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (running.current) await running.current;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setState("saving");
    running.current = saveRef
      .current(next.value)
      .then(() => {
        setError(null);
        setState(pending.current ? "pending" : "saved");
      })
      .catch((e: Error) => {
        setError(e.message);
        setState("error");
      })
      .finally(() => (running.current = null));
    await running.current;
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value };
      setState("pending");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [flush, delay],
  );

  /** Drops unsaved changes (e.g. when loading a newer version made elsewhere). */
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = null;
    setError(null);
    setState("idle");
  }, []);

  /** True while changes are waiting to be saved or being saved. */
  const isDirty = useCallback(() => !!pending.current || !!running.current, []);

  useEffect(() => {
    savers.add(flush);
    return () => {
      savers.delete(flush);
      void flush();
    };
  }, [flush]);
  return { schedule, flush, cancel, isDirty, state, error };
}
