import { env } from "../lib/env.ts";
import { getDb } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { browserCacheControl } from "../lib/pipeline.ts";
import { cachedResponse } from "../public/cache.ts";
import { readLocalCatalog } from "../public/local-catalog.ts";
import {
  getCatalog,
  getPublicState,
  type PublicState,
  type ServedCatalog,
} from "../public/state.ts";

/**
 * A local Worker holds no Supabase key (H35 (7), P-3410): `getDb()` says `unavailable` and the pages answer from the
 * bundled content. Only `MOP_ENV=local` may take that road, so production never lists an illustrative property (S51)
 * and a Worker with a key keeps the database path.
 */
function localWithoutDatabase(): boolean {
  try {
    getDb();
    return false;
  } catch (error) {
    if (error instanceof AppError && error.code === "unavailable") return env.MOP_ENV === "local";
    throw error;
  }
}

/**
 * The answer of a document route (the sitemap and the two llms files): built in process from the catalog snapshot and
 * stored as a `doc` under the catalog version (S52). A local Worker builds the same document from the bundled catalog
 * and stores nothing: the release is its only version.
 */
export async function docResponse(
  request: Request,
  contentType: string,
  render: (catalog: ServedCatalog, state: PublicState) => string,
): Promise<Response> {
  const local = localWithoutDatabase() ? await readLocalCatalog() : undefined;
  if (local !== undefined) {
    return new Response(render(local.catalog, local.state), {
      headers: { "content-type": contentType, "cache-control": browserCacheControl("doc") },
    });
  }
  return cachedResponse(
    request,
    "doc",
    async () => {
      const db = getDb();
      const [catalog, state] = await Promise.all([getCatalog(db), getPublicState(db)]);
      return new Response(render(catalog, state), { headers: { "content-type": contentType } });
    },
    { sMaxAge: 3600, tags: ["seo"] },
  );
}
