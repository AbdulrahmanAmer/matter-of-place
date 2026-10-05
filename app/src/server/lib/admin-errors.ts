import { z } from "zod";
import { errorCodes, type ErrorCode } from "./error-codes.ts";
import { AppError } from "./errors.ts";

// API-03: the one translator from a raised SQL error, a PostgREST error or a failed fetch to the HTTP
// error an admin route answers with. Every code comes from `errorCodes`.

const REFUSED_MESSAGE = "This change could not be made.";
const OUTAGE_MESSAGE = "The service is busy. Please try again in a moment.";
const SERVER_MESSAGE = "Something went wrong. Please try again in a moment.";

// B2's codes that the admin answers under another name: the lock (GD-01) and the slug lock (invariant 8).
const RENAMED: Partial<Record<ErrorCode, ErrorCode>> = {
  version_conflict: "stale",
  slug_immutable: "slug_locked",
};

const BY_SQLSTATE: Readonly<Record<string, ErrorCode>> = {
  P0002: "not_found",
  "23505": "already_exists",
  "23503": "validation",
  "23514": "validation",
  "23502": "validation",
  "22P02": "validation",
  "22023": "validation",
  "42501": "forbidden",
  "55P03": "unavailable",
  "57014": "unavailable",
};

// PostgREST could not reach or use the database.
const POSTGREST_OUTAGE = /^PGRST00[0-3]$/;
// supabase-js answers a rejected fetch with `{ code: "", message: "<name>: <text>" }` instead of throwing.
const FAILED_FETCH = /^(?:TypeError|AbortError|FetchError):/;
// What a thrown fetch TypeError says in undici, workerd and browsers. Any other TypeError is a bug: 500, reported.
const FETCH_TYPE_ERROR = /^(?:fetch failed|Network connection lost|Failed to fetch|NetworkError)/;

// The fields of a PostgREST error this module reads (R33).
const postgrestError = z.object({
  message: z.string(),
  code: z.string().nullish(),
  details: z.string().nullish(),
});

const isCode = (value: string): value is ErrorCode => Object.hasOwn(errorCodes, value);

const outage = () => new AppError("unavailable", undefined, OUTAGE_MESSAGE);

function thrownOutage(error: unknown): boolean {
  if (error instanceof TypeError) return FETCH_TYPE_ERROR.test(error.message);
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Maps, in this order: a message that is a key of `errorCodes` (renamed for the stale lock and the
 * slug lock), a SQLSTATE, a PostgREST or fetch outage (503), and anything else to 500 `server`,
 * which the caller reports. An `AppError` passes through. A `ZodError` is 500 `server` here: only
 * `defineAdminRoute`'s own input parse answers 422, so a schema that fails deeper is the server's fault.
 */
export function fromRpcError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (thrownOutage(error)) return outage();
  const parsed = postgrestError.safeParse(error);
  if (!parsed.success) return new AppError("server", undefined, SERVER_MESSAGE);
  const { message, code, details } = parsed.data;
  if (isCode(message)) {
    const named = RENAMED[message] ?? message;
    return new AppError(named, undefined, details || REFUSED_MESSAGE);
  }
  const bySqlstate = code ? BY_SQLSTATE[code] : undefined;
  if (bySqlstate === "unavailable") return outage();
  if (bySqlstate !== undefined) return new AppError(bySqlstate, undefined, REFUSED_MESSAGE);
  if ((code && POSTGREST_OUTAGE.test(code)) || (!code && FAILED_FETCH.test(message))) {
    return outage();
  }
  return new AppError("server", undefined, SERVER_MESSAGE);
}
