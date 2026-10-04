/**
 * The answer of a POST that reads the catalog (`search`, `concierge`): never stored, and it names the catalog
 * version its service read through, which costs no extra call (invariant 16).
 */
export function answeredAt(body: unknown, catalogVersion: number): Response {
  return Response.json(body, {
    headers: {
      "cache-control": "no-store",
      "x-catalog-version": String(catalogVersion),
      "x-mop-cache": "bypass",
    },
  });
}
