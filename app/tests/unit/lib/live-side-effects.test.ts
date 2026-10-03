import { afterEach, describe, expect, it, vi } from "vitest";
import { liveSideEffects, readVar } from "../../../src/server/lib/runtime-env";

afterEach(() => {
  vi.unstubAllEnvs();
});

function setEnv(values: Record<string, string>) {
  for (const name of ["MOP_ENV", "EMAIL_LIVE", "EMAIL_DRY_RUN", "SOCIAL_LIVE", "SOCIAL_DRY_RUN"]) {
    vi.stubEnv(name, undefined);
  }
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

describe("readVar", () => {
  it("reads at call time and answers undefined for an unset name", () => {
    vi.stubEnv("MOP_TEST_VAR", "first");
    expect(readVar("MOP_TEST_VAR")).toBe("first");
    vi.stubEnv("MOP_TEST_VAR", "second");
    expect(readVar("MOP_TEST_VAR")).toBe("second");
    expect(readVar("MOP_TEST_UNSET")).toBeUndefined();
  });
});

describe("liveSideEffects", () => {
  it("is false for both channels with no flags and MOP_ENV development", () => {
    setEnv({ MOP_ENV: "development" });
    expect([liveSideEffects("email"), liveSideEffects("social")]).toEqual([false, false]);
  });

  it("is false for both channels when MOP_ENV is unset", () => {
    setEnv({});
    expect([liveSideEffects("email"), liveSideEffects("social")]).toEqual([false, false]);
  });

  it("is true for both channels in production", () => {
    setEnv({ MOP_ENV: "production" });
    expect([liveSideEffects("email"), liveSideEffects("social")]).toEqual([true, true]);
  });

  it("lets EMAIL_LIVE make only email true", () => {
    setEnv({ MOP_ENV: "development", EMAIL_LIVE: "1" });
    expect([liveSideEffects("email"), liveSideEffects("social")]).toEqual([true, false]);
  });

  it("lets a dry-run flag win over production", () => {
    setEnv({ MOP_ENV: "production", EMAIL_DRY_RUN: "1" });
    expect([liveSideEffects("email"), liveSideEffects("social")]).toEqual([false, true]);
  });
});
