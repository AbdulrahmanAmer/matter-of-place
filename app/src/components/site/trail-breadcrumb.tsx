import { Link } from "@tanstack/react-router";
import type { Crumb } from "../../lib/jsonld";

/** The index pages a trail passes through; any other crumb before the last is a market desk, `/<market>`. */
const INDEXES = ["/", "/markets", "/properties", "/stories"] as const;
const isIndex = (path: string): path is (typeof INDEXES)[number] =>
  INDEXES.some((index) => index === path);

/** Exact, so a crumb above the page (`/california` on `/california/big-sur`) never reads as the current page. */
const EXACT = { exact: true };

/**
 * The visible trail of a page opener: Home, then the array the route also hands to `breadcrumbLd`, the last crumb the
 * current page. Every earlier crumb is a router link, so following it navigates in the app.
 */
export function TrailBreadcrumb({ trail }: { trail: Crumb[] }) {
  const crumbs: Crumb[] = [{ name: "Home", path: "/" }, ...trail];
  const last = crumbs.length - 1;
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={crumb.path}>
            {index === last ? (
              <span aria-current="page">{crumb.name}</span>
            ) : isIndex(crumb.path) ? (
              <Link to={crumb.path} activeOptions={EXACT}>
                {crumb.name}
              </Link>
            ) : (
              <Link to="/$market" params={{ market: crumb.path.slice(1) }} activeOptions={EXACT}>
                {crumb.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
