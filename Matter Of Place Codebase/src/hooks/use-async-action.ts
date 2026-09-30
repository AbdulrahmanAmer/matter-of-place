import { useCallback, useState } from "react";
import { ZodError } from "zod";
import { ServiceError } from "../services";
import { t } from "../lib/strings";

export type AsyncStatus = "idle" | "pending" | "success" | "error";

type State<TResult> =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; result: TResult }
  | { status: "error"; message: string };

const isValidationError = (error: unknown) =>
  error instanceof ZodError || (error instanceof ServiceError && error.kind === "validation");

const messageFor = (error: unknown) => (isValidationError(error) ? t.forms.invalid : t.forms.error);

/**
 * Small state machine for form submissions: one call, one status, one calm
 * message on failure. Keeps every form's success and error handling identical.
 */
export function useAsyncAction<TInput, TResult>(action: (input: TInput) => Promise<TResult>) {
  const [state, setState] = useState<State<TResult>>({ status: "idle" });

  const run = useCallback(
    async (input: TInput) => {
      setState({ status: "pending" });
      try {
        const result = await action(input);
        setState({ status: "success", result });
        return result;
      } catch (error) {
        setState({ status: "error", message: messageFor(error) });
        return undefined;
      }
    },
    [action],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, run, reset, pending: state.status === "pending" };
}
