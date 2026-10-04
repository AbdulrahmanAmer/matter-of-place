export const LogEvent = [
  "unhandled_error",
  "sentry_send_failed",
  "env_invalid",
  "env_optional_missing",
  "media_public_base_unset",
  "runner_beat_failed",
  "ops_health_failed",
  "meta_token_refresh_failed",
] as const;

export type LogEvent = (typeof LogEvent)[number];
