import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../src/server/lib/db";
import { staffEmail } from "../../src/server/lib/staff-email";

const USER = "00000000-0000-4000-8000-000000000001";

function dbWith(answer: { data: { user: { email?: string } | null }; error: Error | null }) {
  const getUserById = vi.fn(() => Promise.resolve(answer));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a client whose one auth read answers; the code under test touches nothing else
  return { db: { auth: { admin: { getUserById } } } as unknown as Db, getUserById };
}

describe("staffEmail", () => {
  it("reads the sign-in address of the user it is asked for", async () => {
    const { db, getUserById } = dbWith({
      data: { user: { email: "editor@matterofplace.com" } },
      error: null,
    });
    expect(await staffEmail(db, USER)).toBe("editor@matterofplace.com");
    expect(getUserById).toHaveBeenCalledWith(USER);
  });

  it("answers unavailable when the lookup fails, so the caller can try again", async () => {
    const { db } = dbWith({ data: { user: null }, error: new Error("down") });
    await expect(staffEmail(db, USER)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses an account with no address", async () => {
    const { db } = dbWith({ data: { user: {} }, error: null });
    await expect(staffEmail(db, USER)).rejects.toMatchObject({ code: "validation" });
  });
});
