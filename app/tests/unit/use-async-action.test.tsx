// useAsyncAction: the calm message, whether the failure was a refusal of the details, and the hand-off to `onError`.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { useAsyncAction } from "../../src/hooks/use-async-action";
import { t } from "../../src/lib/strings";
import { ServiceError } from "../../src/services/types";

async function failWith(error: unknown, onError?: (error: unknown) => void) {
  const { result } = renderHook(() =>
    useAsyncAction(() => Promise.reject(error instanceof Error ? error : new Error("x")), onError),
  );
  await act(() => result.current.run(undefined));
  return result.current.state;
}

describe("useAsyncAction", () => {
  it("says the details need a look for a Zod error and a refused 422, with invalid set", async () => {
    const zod = new ZodError([{ code: "custom", path: ["story"], message: "Nope" }]);
    expect(await failWith(zod)).toEqual({
      status: "error",
      message: t.forms.invalid,
      invalid: true,
    });
    expect(await failWith(new ServiceError("validation", "Unprocessable Entity", 422))).toEqual({
      status: "error",
      message: t.forms.invalid,
      invalid: true,
    });
  });

  it("says it did not go through for anything else, with invalid unset", async () => {
    expect(await failWith(new ServiceError("server", "Bad Gateway", 502))).toEqual({
      status: "error",
      message: t.forms.error,
      invalid: false,
    });
  });

  it("hands the thrown value to onError once, and only on a failure", async () => {
    const onError = vi.fn();
    const refusal = new ServiceError("validation", "Unprocessable Entity", 422);
    await failWith(refusal, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(refusal);

    const quiet = vi.fn();
    const { result } = renderHook(() => useAsyncAction(() => Promise.resolve("done"), quiet));
    await act(() => result.current.run(undefined));
    expect(result.current.state).toEqual({ status: "success", result: "done" });
    expect(quiet).not.toHaveBeenCalled();
  });
});
