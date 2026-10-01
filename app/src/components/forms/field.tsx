import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

/** Label-above-control wrapper shared by every form. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("field", className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}
