import { useState } from "react";
import { AdminApiError } from "../ui/admin-fetch";

/** The message of a refusal, with its request id when the server sent one (STANDARDS C17). */
function describe(failure: unknown): string {
  if (!(failure instanceof Error)) return "The change did not go through.";
  if (failure instanceof AdminApiError && failure.requestId !== undefined) {
    return `${failure.message} Request ${failure.requestId}.`;
  }
  return failure.message;
}

/**
 * Runs a dialog's action: the form is pending while it runs, `onDone` closes the dialog when it resolves, and
 * a failure leaves the dialog open with the message in `error`.
 */
export function useSubmit<Input>(
  run: (input: Input) => Promise<unknown>,
  onDone: () => void,
): { pending: boolean; error: string | null; submit: (input: Input) => Promise<void> } {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (input: Input) => {
    setPending(true);
    setError(null);
    try {
      await run(input);
      onDone();
    } catch (failure) {
      setError(describe(failure));
      setPending(false);
    }
  };
  return { pending, error, submit };
}
