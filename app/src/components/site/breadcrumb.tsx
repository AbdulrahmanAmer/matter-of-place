import { Children, type ReactNode } from "react";

/** Breadcrumb trail; pass links and a final plain `<span aria-current="page">` as children. */
export function Breadcrumb({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ol>
    </nav>
  );
}
