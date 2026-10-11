import { X509Certificate } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pgClientConfig } from "../../scripts/lib/pg-connect.mjs";

// F4 (security scan 2026-10-10, P-3120): a script's database client takes its options from `pgClientConfig`, which
// turns on verified TLS for every host but loopback. The first block reads the tree, the second the helper.

const SCRIPTS = fileURLToPath(new URL("../../scripts", import.meta.url));
const SOURCE = /\.(?:mjs|cjs|js|ts|tsx)$/;
const HELPER = "lib/pg-connect.mjs";
const MENTIONS = /\bpg\.(?:Client|Pool)\b|\bnew (?:Client|Pool)\(/;
const IMPORTS_HELPER = /^import\s[^;]*\bfrom\s+["'][^"']*\/pg-connect\.mjs["'];?$/m;
const BARE_CONSTRUCTION = /\bnew (?:pg\.)?(?:Client|Pool)\((?!pgClientConfig\()/;

function sources(): string[] {
  return readdirSync(SCRIPTS, { recursive: true, encoding: "utf8" })
    .map((name) => name.replaceAll("\\", "/"))
    .filter((name) => SOURCE.test(name) && !name.includes("node_modules/") && name !== HELPER)
    .sort();
}

const REMOTE =
  "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres";

describe("every script database client uses the TLS helper", () => {
  const mentioning = sources().filter((name) =>
    MENTIONS.test(readFileSync(join(SCRIPTS, name), "utf8")),
  );

  it("finds the scripts that open a client", () => {
    expect(mentioning).toContain("db-push.mjs");
    expect(mentioning).toContain("seed-admin-users.ts");
    expect(mentioning.length).toBeGreaterThanOrEqual(13);
  });

  it("imports the helper in each of them", () => {
    const without = mentioning.filter(
      (name) => !IMPORTS_HELPER.test(readFileSync(join(SCRIPTS, name), "utf8")),
    );
    expect(without).toEqual([]);
  });

  it("builds every client from pgClientConfig, never from a bare options object", () => {
    const bare = mentioning.filter((name) =>
      BARE_CONSTRUCTION.test(readFileSync(join(SCRIPTS, name), "utf8")),
    );
    expect(bare).toEqual([]);
  });
});

describe("pgClientConfig", () => {
  it("verifies the certificate of a remote host against the vendored Supabase root", () => {
    const config = pgClientConfig(REMOTE);
    expect(config.connectionString).toBe(REMOTE);
    expect(config.ssl).toMatchObject({ rejectUnauthorized: true });
    const ca = typeof config.ssl === "object" ? config.ssl.ca : undefined;
    expect(typeof ca).toBe("string");
    const root = new X509Certificate(String(ca));
    expect(root.subject).toContain("CN=Supabase Root 2021 CA");
    expect(root.ca).toBe(true);
    expect(root.fingerprint256).toBe(
      "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
    );
  });

  it("removes a TLS parameter of the URL, which pg would let override the options", () => {
    const config = pgClientConfig(`${REMOTE}?sslmode=disable&application_name=x`);
    expect(config.connectionString).not.toContain("sslmode");
    expect(config.connectionString).toContain("application_name=x");
    expect(config.ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it.each([
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    "postgresql://postgres:postgres@localhost:5432/postgres",
    "postgresql://postgres:postgres@[::1]:5432/postgres",
  ])("leaves a loopback URL without TLS: %s", (url) => {
    expect(pgClientConfig(url)).toEqual({ connectionString: url });
  });

  it.each([undefined, ""])("refuses a missing URL: %j", (url) => {
    expect(() => pgClientConfig(url)).toThrow(/pg-connect: no database URL/);
  });

  it("refuses a value that is not a URL without printing it", () => {
    expect(() => pgClientConfig("not a url with-a-secret")).toThrow(
      /^pg-connect: the database URL is not a URL$/,
    );
  });
});
