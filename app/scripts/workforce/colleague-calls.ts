// W5 item 12 (the orchestrator with Jay, ruling H102 (5)): a colleague with the tool `admin_call` may propose admin
// changes on its own routes only; each waits in Approvals and the runner makes it after a person's yes, as Matter's do.
// Never money, never publishing.
import { adminCallSchema } from "../matter/actions.ts";

/** The routes each colleague may propose, as method and path with each id a `$param`. */
export const colleagueRoutes: Readonly<Record<string, readonly string[]>> = {
  // The write-up of an activated property: the dossier fields, never publish.
  editor: ["PATCH /api/admin/properties/$id"],
  // What a request or a person needs remembered.
  concierge: ["POST /api/admin/submissions/$id/note", "PUT /api/admin/people/$id/notes"],
};

const SEGMENT = "[A-Za-z0-9._~-]+";

function matches(route: string, method: string, path: string): boolean {
  const [routeMethod = "", routePath = ""] = route.split(" ");
  const pattern = new RegExp(
    `^${routePath
      .split("/")
      .map((part) => (part.startsWith("$") ? SEGMENT : part))
      .join("/")}$`,
  );
  return routeMethod === method && pattern.test(path);
}

/** A colleague's proposed calls split into the ones on its own routes and the reasons the others were refused. */
export function colleagueCalls(
  slug: string,
  raw: readonly unknown[],
): { allowed: unknown[]; refused: string[] } {
  const routes = colleagueRoutes[slug] ?? [];
  const allowed: unknown[] = [];
  const refused: string[] = [];
  for (const item of raw) {
    const call = adminCallSchema.safeParse(item);
    if (!call.success) {
      refused.push("a call that is not a method, a path, a body and a reason");
      continue;
    }
    if (routes.some((route) => matches(route, call.data.method, call.data.path)))
      allowed.push(item);
    else refused.push(`${call.data.method} ${call.data.path} is not one of @${slug}'s routes`);
  }
  return { allowed, refused };
}
