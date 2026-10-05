import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { archiveKinds } from "../domain/archive";

// The browser-safe path to the archive facets: the Start compiler swaps each handler for a call to the Worker in the
// client build. The server modules load inside the handlers, as `api-fetch.functions.ts` does, so a test that imports
// `queries.ts` never evaluates the server environment.

async function readCatalog() {
  const [{ getDb }, { getCatalog, getPublicState }, archive] = await Promise.all([
    import("../server/lib/db"),
    import("../server/public/state"),
    import("../server/seo/archive"),
  ]);
  const db = getDb();
  const [snapshot, state] = await Promise.all([getCatalog(db), getPublicState(db)]);
  return { snapshot, state, archive };
}

/** One archive page from the snapshot already in memory, or null below the threshold or with the flag off. */
export const getArchiveFn = createServerFn({ method: "GET" })
  .validator(z.object({ kind: z.enum(archiveKinds), slug: z.string() }))
  .handler(async ({ data }) => {
    const { snapshot, state, archive } = await readCatalog();
    return archive.getFacet(snapshot, state, data.kind, data.slug);
  });

/** The facets that exist, and the catalog version they were built from. */
export const getArchiveFacetsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { snapshot, state, archive } = await readCatalog();
  return { catalog_version: state.catalogVersion, facets: archive.facetMap(snapshot, state) };
});
