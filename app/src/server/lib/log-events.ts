export const LogEvent = ["unhandled_error", "sentry_send_failed"] as const;

export type LogEvent = (typeof LogEvent)[number];
