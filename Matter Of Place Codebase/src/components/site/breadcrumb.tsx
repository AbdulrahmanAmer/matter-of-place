import { Children, Fragment, type ReactNode } from "react";

/** Breadcrumb trail; pass links and a final plain span as children. */
export function Breadcrumb({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <span aria-hidden="true"> / </span>}
          {item}
        </Fragment>
      ))}
    </nav>
  );
}
