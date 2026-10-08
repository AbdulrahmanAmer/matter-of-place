/**
 * @vitest-environment jsdom
 */
// FE-01 (B7 invariant 7): the dossier's serial save queue against a fake API that takes 2 seconds a call.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "../ui/admin-fetch";
import { StaleRowError, useAutosave } from "./use-autosave";

interface Patch {
  title?: string;
  place?: string;
}

interface Call {
  patch: Patch;
  version: number;
  started: number;
  ended: number;
}

/** A fake PATCH: 2 s a call, the next version on success, or the error `refuse` names. */
function fakeApi(refuse: (call: number) => Error | null = () => null) {
  const calls: Call[] = [];
  const save = (patch: Patch, version: number) => {
    const call: Call = { patch, version, started: Date.now(), ended: Number.NaN };
    calls.push(call);
    const error = refuse(calls.length);
    return new Promise<number>((resolve, reject) => {
      setTimeout(() => {
        call.ended = Date.now();
        if (error === null) resolve(version + 1);
        else reject(error);
      }, 2000);
    });
  };
  return { calls, save };
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutosave", () => {
  it("type, wait 1.6 s, type again: two sequential PATCHes carrying v and v+1 and no 409", async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useAutosave<Patch>({ version: 7, save: api.save }));
    act(() => {
      result.current.edit({ title: "A" });
    });
    await advance(1600);
    act(() => {
      result.current.edit({ title: "AB" });
    });
    await advance(8000);
    expect(api.calls.map((call) => ({ patch: call.patch, version: call.version }))).toEqual([
      { patch: { title: "A" }, version: 7 },
      { patch: { title: "AB" }, version: 8 },
    ]);
    expect(api.calls[1]?.started).toBeGreaterThanOrEqual(api.calls[0]?.ended ?? Infinity);
    expect({ stale: result.current.stale, error: result.current.error }).toEqual({
      stale: false,
      error: null,
    });
  });

  it("type then publish within 500 ms: the PATCH goes first and publish receives v+1", async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useAutosave<Patch>({ version: 7, save: api.save }));
    act(() => {
      result.current.edit({ place: "Above the water." });
    });
    await advance(400);
    let published: number | undefined;
    act(() => {
      void result.current.flush().then((version) => {
        published = version;
      });
    });
    await advance(2500);
    expect({ calls: api.calls.map((call) => call.version), published }).toEqual({
      calls: [7],
      published: 8,
    });
  });

  it("a 409 from another session keeps the field text, stops sending, and saves it after a reload", async () => {
    const stale = new AdminApiError(409, "stale", "This changed since you opened it.");
    const api = fakeApi((call) => (call === 1 ? stale : null));
    const { result } = renderHook(() => useAutosave<Patch>({ version: 7, save: api.save }));
    act(() => {
      result.current.edit({ title: "Mine" });
    });
    await advance(4000);
    expect({ stale: result.current.stale, unsaved: result.current.unsaved }).toEqual({
      stale: true,
      unsaved: { title: "Mine" },
    });
    act(() => {
      result.current.edit({ title: "Mine, still" });
    });
    await advance(4000);
    expect(api.calls).toHaveLength(1);
    await expect(result.current.flush()).rejects.toBeInstanceOf(StaleRowError);
    act(() => {
      result.current.adopt(9);
    });
    expect({ held: result.current.held, unsaved: result.current.unsaved }).toEqual({
      held: true,
      unsaved: { title: "Mine, still" },
    });
    let saved: number | undefined;
    act(() => {
      void result.current.flush().then((version) => {
        saved = version;
      });
    });
    await advance(2500);
    expect({ last: api.calls.at(-1)?.version, saved, held: result.current.held }).toEqual({
      last: 9,
      saved: 10,
      held: false,
    });
  });
});
