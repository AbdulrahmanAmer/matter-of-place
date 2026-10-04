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
  invalid_token_state: 422,
  asset_incomplete: 422,
  caption_lint_failed: 422,
  rejection_note_required: 422,
  invalid_target: 422,
  manual_approval: 403,
  asset_not_pending: 409,
  asset_not_rejectable: 409,
  // B8b: the automation console (invariants 7, 8, 11 and 12, SEC-11).
  human_only: 403,
  unknown_trigger: 404,
  unknown_template: 404,
  trigger_locked: 422,
  unknown_field: 422,
  external_clock: 422,
  reorder_mismatch: 422,
  nothing_to_restore: 422,
  // B3b: the illustrative guard and `set_environment` (invariant 1, ruling H35).
  illustrative_in_production: 409,
  invalid_environment: 422,
} as const;

export type ErrorCode = keyof typeof errorCodes;
