import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

// The one browser caller of `/api/admin/*` (invariant 9). It carries the CSRF header on writes, turns an error
// body into `AdminApiError`, ends the session on 401 `session_expired` and `reauth_required`, repeats a request
// once after a 403 `csrf`, and flags a 503 for the shell's banner instead of redirecting (API-03, API-05).

const CSRF_COOKIE = "mop_csrf";
const CSRF_HEADER = "X-MOP-CSRF";
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SESSION_ENDED = new Set(["session_expired", "reauth_required"]);
const ME_PATH = "/api/admin/me";

const errorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/** What `adminFetch` needs from the page: the cache to empty and the way to leave. Bound once by the layout. */
export interface AdminFetchHost {
  queryClient: QueryClient;
  /** The path and search of the page now open, which sign-in sends the person back to. */
  currentPath: () => string;
  navigate: (to: string) => void;
}

let host: AdminFetchHost | null = null;
let unavailable = false;
const watchers = new Set<() => void>();

export function bindAdminFetch(next: AdminFetchHost): void {
  host = next;
}

function setUnavailable(value: boolean): void {
  if (unavailable === value) return;
  unavailable = value;
  for (const watcher of watchers) watcher();
}

/** For `useSyncExternalStore`: true after a 503 until the next answer that is not one. */
export function subscribeUnavailable(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}

export function isUnavailable(): boolean {
  return unavailable;
}

function csrfToken(): string | undefined {
  const entry = document.cookie.split("; ").find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`));
  return entry?.slice(CSRF_COOKIE.length + 1);
}

function send(path: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const token = WRITES.has(method) ? csrfToken() : undefined;
  if (token !== undefined) headers.set(CSRF_HEADER, token);
  return fetch(path, { ...init, credentials: "same-origin", headers });
}

async function failure(response: Response): Promise<AdminApiError> {
  const parsed = errorBody.safeParse(await response.json().catch(() => null));
  const requestId = response.headers.get("x-request-id") ?? undefined;
  if (!parsed.success) {
    return new AdminApiError(response.status, "server", "The request failed.", requestId);
  }
  const { code, message } = parsed.data.error;
  return new AdminApiError(
    response.status,
    code,
    message,
    parsed.data.error.requestId ?? requestId,
  );
}

/**
 * Calls an admin route and parses the JSON answer with `schema`. An error answer throws `AdminApiError`; the cases
 * the header comment lists are handled here and still throw, so a caller never carries on as if it had worked.
 */
export async function adminFetch<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  init: RequestInit = {},
): Promise<T> {
  let response = await send(path, init);
  if (response.status === 403) {
    const refused = await failure(response.clone());
    if (refused.code === "csrf") {
      // `me` sets the cookie again when it is missing or stale; the retry reads it afresh.
      await send(ME_PATH, {});
      response = await send(path, init);
    }
  }
  setUnavailable(response.status === 503);
  if (!response.ok) {
    const error = await failure(response);
    if (response.status === 401 && SESSION_ENDED.has(error.code) && host !== null) {
      host.queryClient.removeQueries({ queryKey: ["admin"] });
      host.navigate(`/admin/sign-in?next=${encodeURIComponent(host.currentPath())}`);
    }
    throw error;
  }
  return schema.parse(response.status === 204 ? undefined : await response.json());
}

/** Puts a file on a Storage signed upload URL: no cookie and no CSRF header, the URL is the credential. */
export async function uploadSigned(url: string, file: Blob): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!response.ok) {
    throw new AdminApiError(response.status, "upload_failed", "The upload did not finish.");
  }
}
