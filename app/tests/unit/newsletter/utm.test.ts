import { describe, expect, it } from "vitest";
import { propertyLink } from "../../../src/server/assets/links";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { withUtm } from "../../../src/server/newsletter/render";

// Link hygiene (B11 invariant 8): B15 attribution and GA4 read one source, one medium, one campaign and one content.

describe("withUtm", () => {
  it("replaces the parameters of B9's newsletter link with the Place Notes set", () => {
    const link = propertyLink("oak-hill", "newsletter");
    expect(link).toContain("utm_source=newsletter");
    expect(withUtm(link, "issue-4", "oak-hill")).toBe(
      "https://matterofplace.com/property/oak-hill?utm_source=place_notes&utm_medium=email&utm_campaign=issue-4&utm_content=oak-hill",
    );
  });

  it("names a standalone email by its slug", () => {
    expect(withUtm(propertyLink("oak-hill", "newsletter"), "standalone-oak-hill", "oak-hill")).toBe(
      "https://matterofplace.com/property/oak-hill?utm_source=place_notes&utm_medium=email&utm_campaign=standalone-oak-hill&utm_content=oak-hill",
    );
  });

  it("keeps the other query parameters and the fragment, and drops any other utm parameter", () => {
    const url = withUtm(
      "https://matterofplace.com/stories/a?ref=friend&utm_term=old&UTM_id=7&utm_source=newsletter#top",
      "issue-2",
      "a",
    );
    const address = new URL(url);
    expect([...address.searchParams.entries()]).toEqual([
      ["ref", "friend"],
      ["utm_source", "place_notes"],
      ["utm_medium", "email"],
      ["utm_campaign", "issue-2"],
      ["utm_content", "a"],
    ]);
    expect(address.hash).toBe("#top");
  });

  it("sets the parameters on an address that has none", () => {
    expect(new URL(withUtm("https://matterofplace.com/stories/a", "issue-1", "a")).search).toBe(
      "?utm_source=place_notes&utm_medium=email&utm_campaign=issue-1&utm_content=a",
    );
  });

  it("refuses an address it cannot read, without a retry", () => {
    expect(() => withUtm("/property/oak-hill", "issue-1", "oak-hill")).toThrow(NonRetryableError);
  });
});
