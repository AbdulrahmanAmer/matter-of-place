import "../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { fakeDb } from "../fixtures/fake-db";

// Gap audit item 12: setting a password that appears in a known breach is refused before Supabase Auth is asked.
const updateUser = vi.fn(() => Promise.resolve({ error: null }));
vi.mock("../../src/server/lib/session", () => ({
  authClient: () => ({ updateUser, auth: { updateUser } }),
  sessionIdOf: () => null,
  takeIssuedCookies: () => [],
}));
vi.mock("../../src/server/lib/pwned", () => ({ passwordWasPwned: () => Promise.resolve(true) }));

const admin: AdminActor = {
  userId: "u-admin",
  kind: "human",
  roles: ["admin"],
  scopes: [],
  requestId: "r",
};

afterEach(() => {
  updateUser.mockClear();
});

describe("setOwnPassword", () => {
  it("refuses a password found in a breach, with words for the person, and never calls Auth", async () => {
    const { setOwnPassword } = await import("../../src/server/team/service");
    const db = fakeDb();
    const failure = await setOwnPassword(
      admin,
      db,
      new Request("https://matterofplace.com/api/admin/dashboard/password"),
      { password: "password1234" },
    ).catch((error: unknown) => error);
    expect([
      failure instanceof Error ? failure.message : String(failure),
      updateUser.mock.calls.length,
    ]).toEqual([
      "This password has appeared in a data breach elsewhere. Please choose a different one.",
      0,
    ]);
  });
});
