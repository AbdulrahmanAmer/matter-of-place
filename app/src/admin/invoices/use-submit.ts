import { useState } from "react";

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
      setError(failure instanceof Error ? failure.message : "The change did not go through.");
      setPending(false);
    }
  };
  return { pending, error, submit };
}
