import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cspFor, securityHeaders } from "../../src/server/lib/headers";

const CSP = "Content-Security-Policy-Report-Only";

function parseHeadersFile(): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current = new Map<string, string>();
  for (const line of readFileSync("public/_headers", "utf8").split("\n")) {
    if (line.trim() === "") continue;
    if (!line.startsWith(" ")) {
      current = new Map();
      rules.set(line.trim(), current);
      continue;
    }
    const colon = line.indexOf(":");
    current.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return rules;
}

describe("securityHeaders", () => {
  const production = securityHeaders("production", {});

  it("is the same map for production and preview", () => {
    expect(securityHeaders("preview", {})).toEqual(production);
  });

  it("holds exactly the static security headers", () => {
    expect(Object.keys(production).sort()).toEqual(
      [
        CSP,
        "Permissions-Policy",
        "Referrer-Policy",
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
      ].sort(),
    );
    expect(production["X-Content-Type-Options"]).toBe("nosniff");
    expect(production["X-Frame-Options"]).toBe("DENY");
    expect(production["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(production["Permissions-Policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    );
  });

  it("sets HSTS to one year with subdomains and no preload", () => {
    expect(production["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("ships the policy as report only, with no report endpoint yet", () => {
    expect(production[CSP]).toBeDefined();
    expect(production["Content-Security-Policy"]).toBeUndefined();
    expect(production[CSP]).not.toMatch(/report-uri|report-to/);
  });

  it("holds no newline in any header", () => {
    for (const [name, value] of Object.entries(production)) {
      expect(`${name}${value}`).not.toMatch(/[\r\n]/);
    }
  });
});

describe("cspFor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const directive = (policy: string, name: string) =>
    policy.split("; ").find((part) => part.startsWith(`${name} `));

  it("lets connect-src reach the origin of SUPABASE_URL for browser uploads, and only the origin", () => {
    vi.stubEnv("SUPABASE_URL", "https://abcdefgh.supabase.co/rest/v1/");
    const connect = directive(cspFor("production", {}), "connect-src");
    expect(connect).toContain("https://abcdefgh.supabase.co");
    expect(connect).not.toContain("/rest");
    expect(directive(cspFor("production", {}), "script-src")).not.toContain("supabase.co");
  });

  it("names no Supabase host when SUPABASE_URL is unset or is not an address", () => {
    vi.stubEnv("SUPABASE_URL", undefined);
    expect(cspFor("production", {})).not.toContain("supabase");
    vi.stubEnv("SUPABASE_URL", "not an address");
    expect(cspFor("production", {})).not.toContain("not an");
  });

  it("allows Turnstile and forbids framing", () => {
    const policy = cspFor("production", {});
    expect(policy).toContain("https://challenges.cloudflare.com");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("never uses a nonce, because HTML is cached", () => {
    expect(cspFor("production", {}, ["abc"])).not.toContain("nonce-");
  });

  it("allows an inline script by its hash", () => {
    expect(cspFor("production", {}, ["abc"])).toContain("'sha256-abc'");
    expect(cspFor("production", {})).not.toContain("sha256-");
  });
});

describe("public/_headers", () => {
  const rules = parseHeadersFile();

  it("leaves /assets/* to the rule Nitro appends, because a second block for a path replaces ours", () => {
    expect(rules.has("/assets/*")).toBe(false);
  });

  it("keeps bundled media for a week", () => {
    expect(rules.get("/media/*")?.get("Cache-Control")).toBe("public, max-age=604800");
  });

  it("carries the same security headers as the Worker on every static file, minus the document policy", () => {
    const { [CSP]: _policy, ...expected } = securityHeaders("production", {});
    expect(Object.fromEntries(rules.get("/*") ?? [])).toEqual(expected);
  });

  it("sets nothing but Cache-Control on /media/*, so no header repeats", () => {
    expect([...(rules.get("/media/*")?.keys() ?? [])]).toEqual(["Cache-Control"]);
  });
});
