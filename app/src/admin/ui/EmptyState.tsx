import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="admin-empty">
      <h2>{title}</h2>
      {children === undefined ? null : <p>{children}</p>}
    </div>
  );
}
