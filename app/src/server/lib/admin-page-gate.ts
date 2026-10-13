import { enabledRoles } from "./actor.ts";
import type { Db } from "./db.ts";
import { getSessionUser, takeIssuedCookies } from "./session.ts";

// H101 (operator, 2026-10-13: "no one can bypass our login at all for the admin dashboard"): the Worker checks the
// session before it sends any admin page, so a visitor without one gets the sign-in redirect and never the admin
// app. The same checks as `/api/admin/*` (`requireActor`): a signed session token, then an enabled role read now.
// Cookies the session check refreshed go out with either answer, so a refresh is never lost (a lost refresh token
// would sign the person out). An Auth or database outage throws and the pipeline answers 503: it fails closed.

export async function adminPageGate(
  request: Request,
  db: Db,
): Promise<{ refuse: Response } | { cookies: string[] }> {
  const user = await getSessionUser(request);
  const cookies = takeIssuedCookies(request);
  if (user !== null && (await enabledRoles(db, user.userId)).length > 0) return { cookies };
  const { pathname, search } = new URL(request.url);
  const headers = new Headers({
    location: `/admin/sign-in?next=${encodeURIComponent(`${pathname}${search}`)}`,
    "cache-control": "no-store",
  });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return { refuse: new Response(null, { status: 302, headers }) };
}
