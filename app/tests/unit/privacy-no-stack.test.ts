import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The operator, 2026-10-13: "why the privacy page shares our internal tech stack". The public pages name the
// categories of service providers, as CCPA asks; Google Analytics stays named because it needs consent, and the
// cookie table names who sets each cookie.
const STACK =
  /\b(Supabase|Resend|Sentry|GitHub|Anthropic|Claude|gtag|Tag Manager|TanStack|Cloudflare Workers)\b/;
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("the public pages do not name our stack", () => {
  it.each(["src/routes/_site.privacy.tsx", "public/humans.txt"])("%s names no vendor", (path) => {
    expect(STACK.exec(read(path))?.[0] ?? "none").toBe("none");
  });
});
