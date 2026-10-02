import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { z } from "zod";
import { getRouter } from "./router";
import { handle, type PipelineContext } from "./server/lib/pipeline";
import { captureException } from "./server/lib/sentry";

// Nitro puts the Worker's bound `waitUntil` on the request (`augmentReq`). The Start dev server
// has no Worker, so there a promise is simply started and left to finish.
const WorkerRequest = z.object({
  waitUntil: z.custom<PipelineContext["waitUntil"]>((value) => typeof value === "function"),
});

function waitUntilOf(request: Request): PipelineContext["waitUntil"] {
  const worker = WorkerRequest.safeParse(request);
  return worker.success
    ? worker.data.waitUntil
    : (promise) => {
        void promise;
      };
}

// STUB(B3): MOP_ENV and sentryOptions() from src/server/lib/env.ts (R14, ASSUMED H39 (4))
const workerEnv = () => ({
  mopEnv: process.env["MOP_ENV"],
  sentry: {
    dsn: process.env["SENTRY_DSN"],
    env: process.env["MOP_ENV"] ?? "production",
    release: process.env["SENTRY_RELEASE"] ?? "dev",
  },
});

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
    const { mopEnv, sentry } = workerEnv();
    return handle(
      request,
      { env: { MOP_ENV: mopEnv }, waitUntil: waitUntilOf(request) },
      {
        render: async (_request, requestId) => (await next({ context: { requestId } })).response,
        // STUB(B3): cachedResponse(request, "html", render) from src/server/public/cache.ts
        cache: (_request, render) => render(),
        // STUB(B3b): getFlags(db) from src/server/lib/flags.ts
        getFlags: () => Promise.resolve({}),
        report: (error, info) => captureException(error, { ...info, ...sentry }),
        isApiRoute,
      },
    );
  },
);

// Server functions keep the CSRF check TanStack applies when a project has no start file.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

export const startInstance = createStart(() => ({ requestMiddleware: [pipeline, csrf] }));
