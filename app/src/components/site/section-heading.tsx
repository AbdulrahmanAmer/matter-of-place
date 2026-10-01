import type { ReactNode } from "react";

export function SectionHeading({
  eyebrow,
  title,
  action,
  id,
}: {
  eyebrow: string;
  title: string;
  /** Link or button aligned to the right of the heading. */
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
      {action}
    </div>
  );
}
