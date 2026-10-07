import { routePath } from "../lib/pipeline";
import type { Catalog } from "../public/mappers";

// Which of three things a slug is, decided from the catalog snapshot alone (invariant 10): a property that
// was taken down is `gone` (410); one that is only unpublished or draft, and one that never existed, are
// `missing` (404). No request reads a table for it. The page route learns the answer through the public API.

export type GoneState = "gone" | "missing" | "live";
type Snapshot = Pick<Catalog, "gone" | "properties" | "stories">;

/**
 * `snapshot` is the result of `getCatalog`. Its `gone` list holds property slugs only (`taken_down_at` is a
 * column of `properties`), so a story is never gone, whatever its slug.
 */
export function goneState(snapshot: Snapshot, kind: "property" | "story", slug: string): GoneState {
  if (kind === "property" && snapshot.gone.includes(slug)) return "gone";
  const rows = kind === "property" ? snapshot.properties : snapshot.stories;
  return rows.some((row) => row.slug === slug) ? "live" : "missing";
}

const PROPERTY_PAGE = /^\/property\/([^/]+)\/?$/;
const GONE_CONTROL = "public, s-maxage=60";

/**
 * Rewrites the status of a rendered property page to 410 when its slug is in `gone`. A status set while the
 * router renders never reaches the response (Start answers with the router's own status code), so `start.ts`
 * calls this on the pipeline's render, before the cache hook stores the page, with the same one-minute
 * lifetime as the API's 410. The snapshot is read only for a property page that rendered with 200.
 */
export async function withGoneStatus(
  request: Request,
  response: Response,
  readSnapshot: () => Promise<Snapshot>,
): Promise<Response> {
  if ((request.method !== "GET" && request.method !== "HEAD") || response.status !== 200) {
    return response;
  }
  const slug = PROPERTY_PAGE.exec(routePath(new URL(request.url).pathname))?.[1];
  if (slug === undefined || goneState(await readSnapshot(), "property", slug) !== "gone") {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", GONE_CONTROL);
  return new Response(response.body, { status: 410, headers });
}
