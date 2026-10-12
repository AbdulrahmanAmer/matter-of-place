import type { ReactNode } from "react";

/**
 * One item of a long list that opens in place (admin pass, 2026-10-12): its name and a short summary on one line, its
 * fields below when opened. A list of regions or guide entries reads as a list, not as a wall of boxes.
 */
export function Fold({
  title,
  meta,
  open = false,
  children,
}: {
  title: string;
  meta?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="admin-fold" open={open}>
      <summary>
        <span className="admin-fold__title">{title}</span>
        {meta === undefined ? null : <span className="admin-fold__meta">{meta}</span>}
      </summary>
      <div className="admin-fold__body">{children}</div>
    </details>
  );
}
