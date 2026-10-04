import type { Property } from "../../domain/property";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { routePath } from "../lib/pipeline";
import type { Catalog } from "./mappers";
import { getCatalog } from "./state";

// Redirects run before routing (invariant 14, GD-02, GG-01). Both sources come from the catalog snapshot,
// merged into one map per catalog version, so a lookup is one map read and no database call.

interface Target {
  to: string;
  status: number;
}

/** The key of a path: as the router reads it, without a trailing slash. */
const normalize = (pathname: string): string => {
  const path = routePath(pathname);
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
};

interface RedirectSources {
  properties: readonly Pick<Property, "id" | "slug">[];
  redirects: Catalog["redirects"];
  slugHistory: Catalog["slugHistory"];
}

/**
 * The enabled `redirects` rows, and `/property/<old>` to `/property/<current>` (301) for every old slug of a
 * property that is still published. A row of the table wins over a slug that has moved.
 */
export function loadRedirectMap(catalog: RedirectSources): Map<string, Target> {
  const map = new Map<string, Target>();
  const current = new Map(catalog.properties.map((property) => [property.id, property.slug]));
  for (const { slug, property_id: id } of catalog.slugHistory) {
    const now = current.get(id);
    if (now !== undefined && now !== slug) {
      map.set(normalize(`/property/${slug}`), { to: `/property/${now}`, status: 301 });
    }
  }
  for (const row of catalog.redirects) {
    map.set(normalize(row.from_path), { to: row.to_path, status: row.status });
  }
  return map;
}

let built: { version: number; map: Map<string, Target> } | undefined;

async function catalogOrUndefined(db: Db): Promise<Catalog | undefined> {
  try {
    return await getCatalog(db);
  } catch (error) {
    // No catalog and no last good copy: the page path answers that (stale or 503), not a redirect lookup.
    if (error instanceof AppError && error.code === "unavailable") return undefined;
    throw error;
  }
}

/** The redirect for this request, or null. The answer is never stored. */
export async function resolveRedirect(request: Request, db: Db): Promise<Response | null> {
  const catalog = await catalogOrUndefined(db);
  if (catalog === undefined) return null;
  if (built?.version !== catalog.version) {
    built = { version: catalog.version, map: loadRedirectMap(catalog) };
  }
  const url = new URL(request.url);
  const target = built.map.get(normalize(url.pathname));
  if (target === undefined) return null;
  const location = target.to.includes("?") ? target.to : `${target.to}${url.search}`;
  return new Response(null, {
    status: target.status,
    headers: { location, "cache-control": "no-store" },
  });
}
