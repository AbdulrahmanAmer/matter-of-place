import { describe, expect, it } from "vitest";
import { setPasswordInput } from "../../src/domain/admin-team";

// H101: a new admin password is at least twelve characters with a letter and a digit, the rule Supabase Auth enforces.

const verdict = (password: string) => {
  const parsed = setPasswordInput.safeParse({ password });
  return parsed.success ? "ok" : (parsed.error.issues[0]?.message ?? "refused");
};

describe("a new admin password", () => {
  it("needs twelve characters, a letter and a digit", () => {
    expect([
      verdict("short1"),
      verdict("onlylettersherenow"),
      verdict("123456789012"),
      verdict("quiet harbour 1972"),
    ]).toEqual([
      "Use at least 12 characters.",
      "Use at least one digit.",
      "Use at least one letter.",
      "ok",
    ]);
  });
});
