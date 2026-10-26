import { describe, expect, it } from "vitest";
import { Route } from "../../src/routes/_site.submit";

// W6 item 8: the room's "Submit my next property" link carries `package=five-features`; the form reads that one value
// and nothing else from the address.

function validate(search: Record<string, unknown>): unknown {
  const read = Route.options.validateSearch;
  if (typeof read !== "function") throw new Error("the submit route has no search validator");
  return read(search);
}

describe("the submit page's search", () => {
  it("keeps five-features and drops every other value", () => {
    expect(validate({ package: "five-features" })).toEqual({ package: "five-features" });
    expect(validate({ package: "The Reach" })).toEqual({});
    expect(validate({ package: "five-features", extra: "x" })).toEqual({
      package: "five-features",
    });
    expect(validate({})).toEqual({});
  });
});
