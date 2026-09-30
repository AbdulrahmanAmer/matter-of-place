import type { ReactNode } from "react";

/** Full-width call to action on property and collection pages. */
export function InquiryBlock({
  eyebrow,
  title,
  text,
  children,
}: {
  eyebrow: string;
  title: string;
  text: string;
  /** Links and buttons, laid out in a wrapping row. */
  children: ReactNode;
}) {
  return (
    <section className="inquiry-block">
      <div className="inquiry-block-inner">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p>{text}</p>
        </div>
        <div className="inquiry-actions">{children}</div>
      </div>
    </section>
  );
}
