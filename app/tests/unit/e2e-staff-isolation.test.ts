// P-2426. Two Playwright workers that sign in as one staff address in the same second each call `generateLink`, and
// the second call voids the first token (the first test then lands on /admin/sign-in?state=expired). The newsletter
// spec has its own seeded address, so no other e2e file may name it, and the seed script must create it.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const APP = resolve(import.meta.dirname, "../..");
const E2E = join(APP, "tests/e2e");
const STAFF = /staff\+[a-z]+@matterofplace\.com/g;
// The specs of the `harden` project (playwright.config.ts) run by hand with `--project=harden` (H1), never in a run
// beside the newsletter spec, so the void-token race above cannot happen between them.
const HARDEN_ONLY = ["admin-authz.spec.ts", "admin-csrf.spec.ts", "csp.spec.ts", "states.spec.ts"];

const text = (file: string) => readFileSync(file, "utf8");

describe("the newsletter e2e spec signs in as a staff address of its own", () => {
  const own = [...new Set(text(join(E2E, "admin-newsletter.spec.ts")).match(STAFF) ?? [])];

  it("names exactly one staff address", () => {
    expect(own).toHaveLength(1);
  });

  it("no other e2e file names that address", () => {
    const others = readdirSync(E2E, { recursive: true, encoding: "utf8" })
      .filter(
        (name) => /\.ts$/.test(name) && name.replaceAll("\\", "/") !== "admin-newsletter.spec.ts",
      )
      .filter((name) => !HARDEN_ONLY.includes(name))
      .filter((name) => own.some((address) => text(join(E2E, name)).includes(address)));
    expect(others).toEqual([]);
  });

  it("the seed script creates that address, so CI's stack has the user", () => {
    const seed = text(join(APP, "scripts/seed-admin-users.ts"));
    expect(own.every((address) => seed.includes(`"${address}"`))).toBe(true);
  });
});
