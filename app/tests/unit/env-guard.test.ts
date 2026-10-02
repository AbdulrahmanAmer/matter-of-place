import { afterEach, describe, expect, it, vi } from "vitest";
import { guardEnv } from "../../scripts/lib/guard-env.mjs";

const DEV = {
  DEV_DB_URL: "postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
};
const OPS = [
  "PROD_TURNSTILE_SECRET",
  "SUPABASE_ACCESS_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CF_EDGE_TOKEN",
  "BACKUP_PASSPHRASE",
];

describe("guardEnv keeps ops credentials out of test shells (SEC-08)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(OPS)("throws naming %s", (name) => {
    expect(() => {
      guardEnv({ env: { ...DEV, [name]: "x" } });
    }).toThrow(new RegExp(`^refusing: ops variables in this shell ${name} `));
  });

  it("passes on DEV_DB_URL alone", () => {
    expect(() => {
      guardEnv({ env: DEV });
    }).not.toThrow();
  });

  it("passes on dev names and a name that only contains an ops word", () => {
    expect(() => {
      guardEnv({
        env: {
          ...DEV,
          DEV_SUPABASE_PROJECT_REF: "ref",
          DEV_SUPABASE_DB_PASSWORD: "pw",
          VITE_TURNSTILE_SITE_KEY_PROD: "key",
          SUPABASE_ACCESS_TOKEN_NOTE: "x",
        },
      });
    }).not.toThrow();
  });

  it("passes on every ops name with allowOps", () => {
    expect(() => {
      guardEnv({
        allowOps: true,
        env: { ...DEV, ...Object.fromEntries(OPS.map((name) => [name, "x"])) },
      });
    }).not.toThrow();
  });

  it("reads process.env when no environment is given", () => {
    vi.stubEnv("CF_EDGE_TOKEN", "x");
    expect(() => {
      guardEnv();
    }).toThrow(/CF_EDGE_TOKEN/);
  });
});
