import { useId, type ReactNode } from "react";

interface ControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": boolean;
}

/** A label, a hint and an error around one control; the control takes the wiring from the render function. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (control: ControlProps) => ReactNode;
}) {
  const id = useId();
  const notes = `${id}-notes`;
  const hasNotes = hint !== undefined || error !== undefined;
  return (
    <div className="admin-field">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        "aria-describedby": hasNotes ? notes : undefined,
        "aria-invalid": error !== undefined,
      })}
      {hasNotes ? (
        <div id={notes}>
          {hint === undefined ? null : <p className="admin-field__hint">{hint}</p>}
          {error === undefined ? null : (
            <p className="admin-field__error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
