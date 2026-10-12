import { useId, type ReactNode } from "react";

interface ControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": boolean;
}

/**
 * A label, a hint and an error around one control; the control takes the wiring from the render function. `context`
 * is read before the label but not shown, for a field inside an item that already names it on screen ("Bay Area",
 * then "Intro").
 */
export function Field({
  label,
  context,
  hint,
  error,
  children,
}: {
  label: string;
  context?: string;
  hint?: string;
  error?: string;
  children: (control: ControlProps) => ReactNode;
}) {
  const id = useId();
  const notes = `${id}-notes`;
  const hasNotes = hint !== undefined || error !== undefined;
  return (
    <div className="admin-field">
      <label htmlFor={id}>
        {context === undefined ? null : (
          <span className="admin-visually-hidden">{`${context} `}</span>
        )}
        {label}
      </label>
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
