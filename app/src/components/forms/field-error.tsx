/** The visible text of a refused field; the control's `aria-describedby` is `errorId`. `Field` shows it for its own control, and a control without a `Field` around it (a choice group, a checkbox) shows it with this. */
export function FieldError({
  error,
  errorId,
}: {
  error: string | undefined;
  errorId?: string | undefined;
}) {
  if (error === undefined) return null;
  return (
    <span className="field-error" id={errorId}>
      {error}
    </span>
  );
}
