import { describe, expect, it } from "vitest";
import { adminPagePath, confirmUrl } from "../../scripts/matter/admin-browser";
import { matterPrompt } from "../../scripts/matter/run";

// Ruling H151: Matter's laptop sign-in opens only admin pages of the live site, lands its token on the admin's own
// confirm page, and is offered to him only when he may run commands.

describe("Matter's admin browser (H151)", () => {
  it("opens only a path under /admin, also after Git Bash rewrote it", () => {
    expect([
      adminPagePath("/admin/office"),
      adminPagePath("C:/Program Files/Git/admin/proposed-posts"),
      adminPagePath("/admin"),
      adminPagePath("/admin/settings?tab=usage"),
    ]).toEqual(["/admin/office", "/admin/proposed-posts", "/admin", "/admin/settings?tab=usage"]);
  });

  it("refuses a host, another path holding /admin, traversal and a look-alike", () => {
    expect([
      adminPagePath("https://evil.example/admin"),
      adminPagePath("/api/admin/me"),
      adminPagePath("/admin/../stories"),
      adminPagePath("/administrator"),
      adminPagePath("/admin//evil.example"),
      adminPagePath(undefined),
    ]).toEqual([null, null, null, null, null, null]);
  });

  it("lands the token on the admin's own confirm page as the mailed link does", () => {
    expect(confirmUrl("pkce_abc")).toBe(
      "https://matterofplace.com/admin/auth/confirm?token_hash=pkce_abc&type=email&next=%2Fadmin",
    );
  });

  it("is offered to Matter at full power only, with the person-only limit", () => {
    const base = { charterText: "C", atlasText: "A", notes: "", thread: "t", business: "" };
    const full = matterPrompt({ ...base, power: "full" });
    const read = matterPrompt({ ...base, power: "read" });
    expect([
      full.includes("admin-browser.ts"),
      full.includes("never approve, pay, invite or decide anything on a person's behalf"),
      read.includes("admin-browser.ts"),
    ]).toEqual([true, true, false]);
  });
});
