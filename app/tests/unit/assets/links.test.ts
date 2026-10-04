// B9 step 9: the one address a caption or a block carries (invariant 5).
import { describe, expect, it } from "vitest";
import { propertyLink, X_LINK_LENGTH } from "../../../src/server/assets/links";

describe("propertyLink", () => {
  it.each(["instagram", "x", "linkedin", "facebook"] as const)(
    "a %s link carries its own source and the social medium",
    (channel) => {
      const url = new URL(propertyLink("oak-hill", channel));
      expect(url.origin + url.pathname).toBe("https://matterofplace.com/property/oak-hill");
      expect(url.searchParams.get("utm_source")).toBe(channel);
      expect(url.searchParams.get("utm_medium")).toBe("social");
      expect(url.searchParams.get("utm_campaign")).toBe("oak-hill");
    },
  );

  it("a newsletter link carries the email medium", () => {
    const url = new URL(propertyLink("oak-hill", "newsletter"));
    expect(url.searchParams.get("utm_source")).toBe("newsletter");
    expect(url.searchParams.get("utm_medium")).toBe("email");
  });

  it("the X limit counts a link at 23 characters", () => {
    expect(X_LINK_LENGTH).toBe(23);
  });
});
