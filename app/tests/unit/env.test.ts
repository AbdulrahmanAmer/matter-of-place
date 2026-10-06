import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// env.ts parses `process.env` when it is first imported, so the module loads under a valid local environment.
vi.stubEnv("MOP_ENV", "local");
vi.stubEnv("RATE_LIMIT_SALT", "salt");
const { parseEnv } = await import("../../src/server/lib/env");
vi.unstubAllEnvs();
vi.restoreAllMocks();

const COMMON = { RATE_LIMIT_SALT: "salt" };
const PRODUCTION = {
  ...COMMON,
  MOP_ENV: "production",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  TURNSTILE_SECRET: "turnstile",
  SENTRY_DSN: "https://key@o1.ingest.sentry.io/2",
};

let lines: string[] = [];
const logged = (): unknown[] => lines.map((line): unknown => JSON.parse(line));

beforeEach(() => {
  lines = [];
  vi.spyOn(console, "warn").mockImplementation((line: string) => {
    lines.push(line);
  });
  vi.spyOn(console, "error").mockImplementation((line: string) => {
    lines.push(line);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseEnv", () => {
  it("accepts a local environment with nothing but the salt", () => {
    expect(parseEnv({ ...COMMON, MOP_ENV: "local" })).toMatchObject({
      MOP_ENV: "local",
      SENTRY_RELEASE: "dev",
    });
  });

  it("names SUPABASE_URL when production lacks it", () => {
    const { SUPABASE_URL: _removed, ...without } = PRODUCTION;
    expect(() => parseEnv(without)).toThrow(/SUPABASE_URL is required when MOP_ENV is production/);
  });

  it("does not need the Supabase names outside production", () => {
    const { SUPABASE_URL: _url, SUPABASE_SERVICE_ROLE_KEY: _key, ...without } = PRODUCTION;
    expect(parseEnv({ ...without, MOP_ENV: "preview" }).SUPABASE_URL).toBeUndefined();
  });

  it("needs the Turnstile secret and the Sentry DSN unless MOP_ENV is local", () => {
    expect(() => parseEnv({ ...COMMON, MOP_ENV: "preview" })).toThrow(
      /TURNSTILE_SECRET .*SENTRY_DSN/,
    );
    expect(() => parseEnv({ ...COMMON, MOP_ENV: "local" })).not.toThrow();
  });

  it("treats MOP_ENV as production when it is unset", () => {
    expect(() => parseEnv(COMMON)).toThrow(/MOP_ENV is production/);
  });

  it("treats an empty value as unset", () => {
    expect(() => parseEnv({ ...PRODUCTION, SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY is required/,
    );
  });

  it("accepts a CONFIRM_TOKEN_SECRET that is base64 of 32 bytes", () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    expect(parseEnv({ ...COMMON, MOP_ENV: "local", CONFIRM_TOKEN_SECRET: key })).toMatchObject({
      CONFIRM_TOKEN_SECRET: key,
    });
  });

  it("names CONFIRM_TOKEN_SECRET when it is not base64 of 32 bytes", () => {
    const short = btoa(String.fromCharCode(...new Uint8Array(16).fill(7)));
    expect(() => parseEnv({ ...COMMON, MOP_ENV: "local", CONFIRM_TOKEN_SECRET: short })).toThrow(
      /CONFIRM_TOKEN_SECRET must be base64 of 32 bytes/,
    );
  });

  it("refuses a MOP_ENV it does not know", () => {
    expect(() => parseEnv({ ...COMMON, MOP_ENV: "staging" })).toThrow(/MOP_ENV/);
  });

  it("logs the missing optional names once per parse, without a value", () => {
    parseEnv({ ...PRODUCTION, RESEND_WEBHOOK_SECRET: "whsec" });
    expect(logged()).toEqual([
      { level: "warn", event: "env_optional_missing", name: "MEDIA_PUBLIC_BASE" },
    ]);
  });

  it("logs the names that failed before it throws", () => {
    expect(() => parseEnv({ MOP_ENV: "local" })).toThrow(/RATE_LIMIT_SALT/);
    expect(logged()).toEqual([
      { level: "error", event: "env_invalid", variables: "RATE_LIMIT_SALT" },
    ]);
  });
});

describe("sentryOptions", () => {
  it("passes the DSN, the environment and the release from the parsed environment", async () => {
    vi.resetModules();
    vi.stubEnv("MOP_ENV", "local");
    vi.stubEnv("RATE_LIMIT_SALT", "salt");
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/2");
    vi.stubEnv("SENTRY_RELEASE", "abc123");
    const { sentryOptions } = await import("../../src/server/lib/env");
    expect(sentryOptions()).toEqual({
      dsn: "https://key@o1.ingest.sentry.io/2",
      env: "local",
      release: "abc123",
    });
  });
});
