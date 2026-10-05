// The admin route registry of invariant 2: every handler every file under `src/routes/api/admin/` exports, read
// off the files themselves, so H1-15, H1's CSRF probe and `admin-routes-parity.test.ts` never keep a list by hand.
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ADMIN_ROUTE, type AdminRouteTag } from "../../src/server/lib/admin-route";

const ADMIN_ROUTES = fileURLToPath(new URL("../../src/routes/api/admin/", import.meta.url));

export interface AdminRouteRecord {
  /** The file under `src/routes/api/admin/`, with `/` separators. */
  file: string;
  /** The URL pattern TanStack derives from the file name, `$name` for a parameter. */
  path: string;
  /** The export name in `server.handlers`. */
  method: string;
  /** Undefined when the handler was not built by `defineAdminRoute`. */
  tag: AdminRouteTag | undefined;
}

function filesUnder(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = join(folder, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

/** `submissions.$id.decline.ts` is `/api/admin/submissions/$id/decline`; `index` and `[.]` follow TanStack. */
export function routePathOf(file: string): string {
  const segments = file
    .replace(/\.ts$/, "")
    .split("/")
    .flatMap((part) => part.split(/\.(?![^[]*\])/))
    .filter((segment, index, all) => !(segment === "index" && index === all.length - 1))
    .map((segment) => segment.replace(/\[(.)\]/g, "$1"));
  return ["/api/admin", ...segments].join("/");
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

const isTag = (value: unknown): value is AdminRouteTag =>
  typeof value === "object" &&
  value !== null &&
  "method" in value &&
  "action" in value &&
  "auth" in value;

const handlerTag = (handler: unknown): AdminRouteTag | undefined => {
  const tag: unknown =
    typeof handler === "function" ? Reflect.get(handler, ADMIN_ROUTE) : undefined;
  return isTag(tag) ? tag : undefined;
};

export async function loadAdminRoutes(): Promise<AdminRouteRecord[]> {
  const records: AdminRouteRecord[] = [];
  for (const full of filesUnder(ADMIN_ROUTES)) {
    const file = relative(ADMIN_ROUTES, full).split(sep).join("/");
    const module: unknown = await import(pathToFileURL(full).href);
    const server = field(field(field(module, "Route"), "options"), "server");
    const handlerMap = field(server, "handlers");
    if (typeof handlerMap !== "object" || handlerMap === null) {
      records.push({ file, path: routePathOf(file), method: "(none)", tag: undefined });
      continue;
    }
    for (const [method, handler] of Object.entries(handlerMap)) {
      records.push({ file, path: routePathOf(file), method, tag: handlerTag(handler) });
    }
  }
  return records;
}
