import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { getRouter } from "./router";
import { getDb } from "./server/lib/db";
import { env, sentryOptions } from "./server/lib/env";
import { getFlags } from "./server/lib/flags";
import { handle } from "./server/lib/pipeline";
import { captureException } from "./server/lib/sentry";
import { waitUntilOf } from "./server/lib/wait-until";
import { cachedResponse } from "./server/public/cache";
import { resolveRedirect } from "./server/public/redirects";

// After the launch switch a preview holds no database key and runs the illustrative adapter (H35 (7)):
// it renders every page itself, with no redirect lookup and no stored copy.
const hasDatabase = env.SUPABASE_URL !== undefined && env.SUPABASE_SERVICE_ROLE_KEY !== undefined;

// Matching only, so one router serves every request; it is made on the first refused Accept.
let matcher: ReturnType<typeof getRouter> | undefined;

// The router's own match. The pipeline gives the path decoded (GOTCHAS G-024), because the
// router decodes before it matches and `getMatchedRoutes` does not.
function isApiRoute(pathname: string): boolean {
  matcher ??= getRouter();
  const { foundRoute, routeParams } = matcher.getMatchedRoutes(pathname);
  const fullPath: unknown = foundRoute?.fullPath;
  return (
    typeof fullPath === "string" && fullPath.startsWith("/api/") && routeParams["**"] === undefined
  );
}

// The id reaches every handler as `context.requestId` (ASSUMED H39 (1)).
const pipeline = createMiddleware({ type: "request" }).server<{ requestId: string }>(
  ({ request, next }) => {
    return handle(
      request,
      { env: { MOP_ENV: env.MOP_ENV }, waitUntil: waitUntilOf(request) },
      {
        render: async (_request, requestId) => (await next({ context: { requestId } })).response,
        redirect: (page) => (hasDatabase ? resolveRedirect(page, getDb()) : Promise.resolve(null)),
        cache: (page, render) => (hasDatabase ? cachedResponse(page, "html", render) : render()),
        getFlags: () => (hasDatabase ? getFlags(getDb()) : Promise.resolve({})),
        report: (error, info) => captureException(error, { ...info, ...sentryOptions() }),
        isApiRoute,
      },
    );
  },
);

// Server functions keep the CSRF check TanStack applies when a project has no start file.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

export const startInstance = createStart(() => ({ requestMiddleware: [pipeline, csrf] }));
