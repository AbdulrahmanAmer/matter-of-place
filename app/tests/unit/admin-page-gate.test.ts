import "../fixtures/worker-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminPageGate } from "../../src/server/lib/admin-page-gate";
import { getSessionUser, takeIssuedCookies } from "../../src/server/lib/session";
import { fakeDb } from "../fixtures/fake-db";

// H101: the Worker sends an admin page only to a signed-in person with an enabled role, the same checks as the API.

vi.mock("../../src/server/lib/session", () => ({
  getSessionUser: vi.fn(),
  takeIssuedCookies: vi.fn(() => []),
}));

const USER = "00000000-0000-4000-8000-000000000001";
const page = new Request("https://matterofplace.com/admin/team?tab=keys");
const roles = (rows: { role: string; disabled_at: string | null }[]) =>
  fakeDb({ tables: { user_roles: rows.map((row) => ({ user_id: USER, ...row })) } });

beforeEach(() => {
  vi.mocked(getSessionUser).mockReset();
  vi.mocked(takeIssuedCookies).mockReturnValue([]);
});

describe("adminPageGate", () => {
  it("sends a visitor without a session to sign-in, keeping where they were going", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const answer = await adminPageGate(page, roles([]));
    const refused = "refuse" in answer ? answer.refuse : undefined;
    expect([refused?.status, refused?.headers.get("location")]).toEqual([
      302,
      "/admin/sign-in?next=%2Fadmin%2Fteam%3Ftab%3Dkeys",
    ]);
  });

  it("refuses a signed session whose every role is disabled", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: USER, sessionId: "s", signedInAt: 0 });
    const answer = await adminPageGate(
      page,
      roles([{ role: "admin", disabled_at: "2026-10-01T00:00:00Z" }]),
    );
    expect("refuse" in answer).toBe(true);
  });

  it("lets a person with an enabled role through, with the cookies the check refreshed", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: USER, sessionId: "s", signedInAt: 0 });
    vi.mocked(takeIssuedCookies).mockReturnValue(["sb-x-auth-token=new"]);
    const answer = await adminPageGate(page, roles([{ role: "admin", disabled_at: null }]));
    expect(answer).toEqual({ cookies: ["sb-x-auth-token=new"] });
  });
});
