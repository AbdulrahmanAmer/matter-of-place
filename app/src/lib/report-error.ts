import { z } from "zod";

// FE-09: what the browser caught goes to `POST /api/public/client-error`, once per message and route per page
// load and at most ten per page load, so a render loop cannot flood the endpoint.
const ENDPOINT = "/api/public/client-error";
const MAX_PER_PAGE = 10;
const MESSAGE_CHARS = 500;
const STACK_CHARS = 2048;
const ROUTE_CHARS = 200;

const seen = new Set<string>();

const carriesRequestId = z.object({ requestId: z.string().max(100) });

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** No-op on the server. `requestId` is read from the error when it carries one (an API failure does, G33). */
export function reportClientError(
  error: unknown,
  { route, requestId }: { route: string; requestId?: string },
): void {
  if (typeof window === "undefined") return;
  const message = messageOf(error).slice(0, MESSAGE_CHARS);
  const key = `${route}\n${message}`;
  if (seen.has(key) || seen.size >= MAX_PER_PAGE) return;
  seen.add(key);
  const stack = error instanceof Error ? error.stack?.slice(0, STACK_CHARS) : undefined;
  const id = requestId ?? carriesRequestId.safeParse(error).data?.requestId;
  const body = JSON.stringify({
    message,
    ...(stack === undefined ? {} : { stack }),
    route: route.slice(0, ROUTE_CHARS),
    ...(id === undefined ? {} : { requestId: id }),
  });
  navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
}

/** One `error` and one `unhandledrejection` listener on the window; returns the remover. */
export function installClientErrorListeners(): () => void {
  const onError = (event: ErrorEvent) => {
    const thrown: unknown = event.error;
    reportClientError(thrown ?? event.message, { route: window.location.pathname });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    reportClientError(reason, { route: window.location.pathname });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
