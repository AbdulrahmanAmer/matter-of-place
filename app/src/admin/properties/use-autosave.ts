import { useCallback, useEffect, useRef, useState } from "react";
import { AdminApiError } from "../ui/admin-fetch";

// The dossier's serial save queue (B7 invariant 7, FE-01): at most one PATCH in flight, every edit merged into one
// pending patch, each PATCH sent with the version the previous answer returned. After a 409 `stale` (another session
// saved) nothing more is sent and the unsaved fields stay here; Reload adopts the fresh version and holds them until
// the editor saves them with `flush()`, so nothing typed is lost and nothing is merged silently.

const DELAY_MS = 1500;

export interface AutosaveOptions<Patch extends object> {
  /** The version of the row as read. */
  version: number;
  /** Sends one PATCH and resolves with the row's new version. */
  save: (patch: Partial<Patch>, expectedVersion: number) => Promise<number>;
}

export interface Autosave<Patch extends object> {
  /** Merges fields into the pending patch and saves 1.5 s after the last edit. */
  edit: (fields: Partial<Patch>) => void;
  /** Sends what is pending now, after the PATCH in flight; resolves with the version to send next. */
  flush: () => Promise<number>;
  /** Takes the version another write answered (publish, ranks, lists) or a reload read. */
  adopt: (version: number) => void;
  /** The fields not yet saved, in flight ones included. */
  unsaved: Partial<Patch>;
  /** Another session saved first; nothing is sent until a reload. */
  stale: boolean;
  /** Reloaded over unsaved fields: they wait for an explicit save. */
  held: boolean;
  saving: boolean;
  error: Error | null;
}

type Block = "stale" | "held" | null;

interface ViewState<Patch> {
  unsaved: Partial<Patch>;
  saving: boolean;
  error: Error | null;
  blocked: Block;
}

const isStale = (error: unknown) =>
  error instanceof AdminApiError && error.status === 409 && error.code === "stale";

/** Thrown by `flush` while the row is stale, so a publish never goes out over another session's save. */
export class StaleRowError extends Error {
  constructor() {
    super("Reload, someone saved");
    this.name = "StaleRowError";
  }
}

export function useAutosave<Patch extends object>({
  version: initial,
  save,
}: AutosaveOptions<Patch>): Autosave<Patch> {
  const version = useRef(initial);
  const pending = useRef<Partial<Patch>>({});
  const inFlight = useRef<{ patch: Partial<Patch>; done: Promise<void> } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocked = useRef<Block>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const [state, setState] = useState<ViewState<Patch>>({
    unsaved: {},
    saving: false,
    error: null,
    blocked: null,
  });

  const publishState = useCallback((error: Error | null) => {
    setState({
      unsaved: { ...inFlight.current?.patch, ...pending.current },
      saving: inFlight.current !== null,
      error,
      blocked: blocked.current,
    });
  }, []);

  const sendPending = useCallback((): Promise<void> => {
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return Promise.resolve();
    pending.current = {};
    const done = saveRef.current(patch, version.current).then(
      (next) => {
        version.current = next;
        inFlight.current = null;
        publishState(null);
      },
      (failure: unknown) => {
        inFlight.current = null;
        // Newer edits win over the fields that did not save.
        pending.current = { ...patch, ...pending.current };
        if (isStale(failure)) blocked.current = "stale";
        const error =
          failure instanceof Error ? failure : new Error("The save did not go through.");
        publishState(error);
        throw error;
      },
    );
    inFlight.current = { patch, done };
    publishState(null);
    return done;
  }, [publishState]);

  /** Waits for the PATCH in flight, then sends the pending patch; one at a time. */
  const drain = useCallback(async (): Promise<void> => {
    while (inFlight.current !== null) {
      await inFlight.current.done.catch(() => undefined);
    }
    if (blocked.current === "stale") throw new StaleRowError();
    await sendPending();
  }, [sendPending]);

  const edit = useCallback(
    (fields: Partial<Patch>) => {
      pending.current = { ...pending.current, ...fields };
      publishState(null);
      if (blocked.current !== null) return;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        drain().catch(() => undefined);
      }, DELAY_MS);
    },
    [drain, publishState],
  );

  const flush = useCallback(async (): Promise<number> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (blocked.current === "held") blocked.current = null;
    await drain();
    return version.current;
  }, [drain]);

  const adopt = useCallback(
    (next: number) => {
      version.current = next;
      if (blocked.current === "stale") {
        blocked.current = Object.keys(pending.current).length === 0 ? null : "held";
      }
      publishState(null);
    },
    [publishState],
  );

  const unsavedCount = Object.keys(state.unsaved).length;
  useEffect(() => {
    if (unsavedCount === 0 && !state.saving) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [unsavedCount, state.saving]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return {
    edit,
    flush,
    adopt,
    unsaved: state.unsaved,
    stale: state.blocked === "stale",
    held: state.blocked === "held",
    saving: state.saving,
    error: state.error,
  };
}
