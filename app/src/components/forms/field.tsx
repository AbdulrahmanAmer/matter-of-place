import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import { FieldError } from "./field-error";

/** Label-above-control wrapper shared by every form; `error` shows beneath the label, outside it so it stays out of the control's name, and the control's `aria-describedby` is `errorId`. */
export function Field({
  label,
  children,
  className,
  error,
  errorId,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  error?: string | undefined;
  errorId?: string | undefined;
}) {
  return (
    <div className={cx("field", className)}>
      <label>
        <span>{label}</span>
        {children}
      </label>
      <FieldError error={error} errorId={errorId} />
    </div>
  );
}
