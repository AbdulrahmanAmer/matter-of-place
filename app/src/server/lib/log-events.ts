export const LogEvent = [
  "unhandled_error",
  "sentry_send_failed",
  "env_invalid",
  "env_optional_missing",
  "media_public_base_unset",
] as const;

export type LogEvent = (typeof LogEvent)[number];
