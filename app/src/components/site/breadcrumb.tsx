import { Children, type ReactNode } from "react";
import type { Crumb } from "../../lib/jsonld";

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

/** The trail after Home, the array a route also hands to `breadcrumbLd`; the last crumb is the current page. */
export function TrailBreadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <Breadcrumb>
      <a href="/">Home</a>
      {trail.map((crumb, index) =>
        index === trail.length - 1 ? (
          <span key={crumb.path} aria-current="page">
            {crumb.name}
          </span>
        ) : (
          <a key={crumb.path} href={crumb.path}>
            {crumb.name}
          </a>
        ),
      )}
    </Breadcrumb>
  );
}
