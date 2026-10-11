import { useCallback, useState } from "react";
import { ZodError } from "zod";
import { ServiceError, serviceIssues, type ServiceIssue } from "../services";
import { t } from "../lib/strings";

type State<TResult> =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; result: TResult }
  | { status: "error"; message: string; invalid: boolean };

const isValidationError = (error: unknown) =>
  error instanceof ZodError || (error instanceof ServiceError && error.kind === "validation");

const messageFor = (error: unknown) => (isValidationError(error) ? t.forms.invalid : t.forms.error);

/** The fields a refusal names: the API's `issues`, or the issues of the Zod error the form's own check threw. */
export function issuesOf(error: unknown): ServiceIssue[] {
  if (error instanceof ServiceError) return [...error.issues];
  if (error instanceof ZodError) return serviceIssues(error.issues);
  return [];
}

/**
 * Small state machine for form submissions: one call, one status, one calm
 * message on failure. Keeps every form's success and error handling identical.
 * A form that can point at the refused fields passes `onError`, which gets the thrown value once per failure.
 */
export function useAsyncAction<TInput, TResult>(
  action: (input: TInput) => Promise<TResult>,
  onError?: (error: unknown) => void,
) {
  const [state, setState] = useState<State<TResult>>({ status: "idle" });

  const run = useCallback(
    async (input: TInput) => {
      setState({ status: "pending" });
      try {
        const result = await action(input);
        setState({ status: "success", result });
        return result;
      } catch (error) {
        setState({
          status: "error",
          message: messageFor(error),
          invalid: isValidationError(error),
        });
        onError?.(error);
        return undefined;
      }
    },
    [action, onError],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, run, reset, pending: state.status === "pending" };
}
