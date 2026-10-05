// The transport rules of every `/api/admin/*` response (invariant 17 (a)): never stored by a browser or a
// shared cache, and varied on both ways of signing in. B1b's pipeline then writes exactly `no-store` (G65).

const ADMIN_HEADERS = {
  "cache-control": "private, no-store",
  vary: "Cookie, Authorization",
} as const;

/** Sets the admin transport headers on a response the wrapper did not build itself (a redirect, an error). */
export function withAdminHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(ADMIN_HEADERS)) response.headers.set(name, value);
  return response;
}

export function adminJson(body: unknown, init: ResponseInit = {}): Response {
  return withAdminHeaders(Response.json(body ?? null, init));
}
