import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { z } from "zod";
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

const pipeline = createMiddleware({ type: "request" }).server(({ request, next }) =>
  handle(
    request,
    { env: { MOP_ENV: process.env["MOP_ENV"] }, waitUntil: waitUntilOf(request) },
    {
      render: async () => (await next()).response,
      // STUB(B3): cachedResponse(request, "html", render) from src/server/public/cache.ts
      cache: (_request, render) => render(),
      // STUB(B3b): getFlags(db) from src/server/lib/flags.ts
      getFlags: () => Promise.resolve({}),
      report: (error, info) =>
        captureException(error, {
          ...info,
          dsn: process.env["SENTRY_DSN"],
          env: process.env["MOP_ENV"] ?? "production",
          release: process.env["SENTRY_RELEASE"] ?? "dev",
        }),
    },
  ),
);

// Server functions keep the CSRF check TanStack applies when a project has no start file.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

export const startInstance = createStart(() => ({ requestMiddleware: [pipeline, csrf] }));
