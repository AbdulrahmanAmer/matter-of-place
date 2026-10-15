// W7 6: where a typed link leads, by the site's own rules. Kept apart from `settings/service.ts` (which the job runner's Deno
// graph reaches) because it loads the site's modules; only the Settings > Redirects route passes it in.
import type { Db } from "../lib/db.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import { REDIRECT_COLUMNS } from "../settings/service.ts";
import type { LinkCheck, LinkStep } from "../../domain/admin-settings.ts";

/** The path of what was typed: a pasted address of the site, a path with a query or a path without its slash. */
function typedPathname(typed: string): string {
  try {
    return new URL(typed, "https://site.invalid").pathname;
  } catch {
    return typed;
  }
}

const MAX_HOPS = 8;

/**
 * Where `typed` leads, from the same sources and in the same order as the site (`loadRedirectMap`): an active redirect
 * row first, then the old address of a published property. A browser follows each answer, so the hops are followed
 * until one answers nothing, comes back to a path it has been through, or reaches `MAX_HOPS`.
 */
export async function checkLink(db: Db, typed: string): Promise<LinkCheck> {
  // Loaded when a link is tested: the site's own lookup rules, without the request pipeline and `env.ts` at import.
  const [{ loadRedirectMap }, { routePath }] = await Promise.all([
    import("../public/redirects.ts"),
    import("../lib/pipeline.ts"),
  ]);
  /** The key the site looks a path up by (`normalize` in `public/redirects.ts`): as routed, no trailing slash. */
  const siteKey = (pathname: string): string => {
    const path = routePath(pathname);
    return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  };
  const [rows, history, properties] = await Promise.all([
    db.from("redirects").select(`${REDIRECT_COLUMNS}, archived_at`),
    db.from("slug_history").select("slug, property_id"),
    db.from("properties").select("id, slug, editorial_state"),
  ]);
  if (rows.error !== null) throw fromRpcError(rows.error);
  if (history.error !== null) throw fromRpcError(history.error);
  if (properties.error !== null) throw fromRpcError(properties.error);
  // The site's catalog holds the active rows and the published properties; the same two rules are applied here.
  const active = rows.data.filter((row) => row.archived_at === null);
  const map = loadRedirectMap({
    properties: properties.data.filter((row) => row.editorial_state === "published"),
    redirects: active,
    slugHistory: history.data,
  });
  const fromRows = new Set(active.map((row) => siteKey(row.from_path)));
  const steps: LinkStep[] = [];
  const seen = new Set<string>();
  let loop = false;
  let path = typedPathname(typed);
  for (;;) {
    const key = siteKey(path);
    const target = map.get(key);
    if (target === undefined) break;
    if (seen.has(key) || steps.length >= MAX_HOPS) {
      loop = true;
      break;
    }
    seen.add(key);
    steps.push({
      from: key,
      to: target.to,
      status: target.status,
      source: fromRows.has(key) ? "redirect" : "old_address",
    });
    path = typedPathname(target.to);
  }
  return { path: siteKey(typedPathname(typed)), steps, loop };
}
