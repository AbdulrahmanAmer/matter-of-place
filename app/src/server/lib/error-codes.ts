// The one list of error codes and their HTTP status (API-03). A code is a key here and nowhere else:
// SQL raises it as the exact message of `raise exception`, `AppError.code` is typed by it, and
// `tests/unit/error-codes.test.ts` fails on a raised message that is not a key.
// The job runner loads this file under Deno, so it imports nothing.

export const errorCodes = {
  bad_request: 400,
  validation: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  not_acceptable: 406,
  payload_too_large: 413,
  rate_limited: 429,
  server: 500,
  unavailable: 503,
  storage_unavailable: 503,
  already_exists: 409,
  version_conflict: 409,
  invalid_patch_key: 422,
  invalid_kind: 422,
  publish_incomplete: 422,
  publish_not_allowed: 403,
  slug_immutable: 422,
  slug_taken: 409,
  wrong_state: 409,
  hard_delete_refused: 409,
  append_only: 409,
  upload_limit: 422,
} as const;

export type ErrorCode = keyof typeof errorCodes;
