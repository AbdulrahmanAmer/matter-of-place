import "../../fixtures/worker-env";
import { describe, expect, it, vi } from "vitest";
import type { AdminActor } from "../../../src/server/lib/admin-route";
import type { AppRole } from "../../../src/server/lib/authz";
import { ForbiddenError } from "../../../src/server/lib/authz";
import { sendTestToActor } from "../../../src/server/newsletter/service";
import { newsletterDb, uuid } from "../../fixtures/newsletter-world";

// Screen 13's "Send a test" mails the person who pressed it: the route passes no address, the service reads the
// sign-in address of the actor (P-2422, P-2410).

const ISSUE = uuid(900);

const person = (role: AppRole): AdminActor => ({
  userId: `user-${role}`,
  kind: "human",
  roles: [role],
  scopes: [],
  requestId: "req-1",
});

type Answer = { data: { user: { email?: string } | null }; error: Error | null };

function world(answer?: Answer) {
  const getUserById = vi.fn((id: string) =>
    Promise.resolve(
      answer ?? { data: { user: { email: `${id}@matterofplace.com` } }, error: null },
    ),
  );
  const { db, rpcCalls } = newsletterDb({}, { enqueue_job: () => "job-1" });
  return { db: Object.assign(db, { auth: { admin: { getUserById } } }), rpcCalls, getUserById };
}

describe("sendTestToActor", () => {
  it("queues the test for the sign-in address of the person who asked", async () => {
    const { db, rpcCalls, getUserById } = world();
    expect(await sendTestToActor(person("managing_editor"), db, { id: ISSUE })).toEqual({
      job_id: "job-1",
    });
    expect(getUserById).toHaveBeenCalledWith("user-managing_editor");
    expect(rpcCalls("enqueue_job").map(({ args }) => args[0])).toMatchObject([
      {
        p_type: "newsletter_preview",
        p_payload: {
          data: { issue_id: ISSUE, test: true, to: "user-managing_editor@matterofplace.com" },
        },
      },
    ]);
  });

  it("refuses a role that may not send a test before it reads any address", async () => {
    const { db, rpcCalls, getUserById } = world();
    const error: unknown = await sendTestToActor(person("visual_editor"), db, { id: ISSUE }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(getUserById).not.toHaveBeenCalled();
    expect(rpcCalls("enqueue_job")).toEqual([]);
  });

  it("answers unavailable when the address cannot be read, and queues nothing", async () => {
    const { db, rpcCalls } = world({ data: { user: null }, error: new Error("down") });
    await expect(
      sendTestToActor(person("managing_editor"), db, { id: ISSUE }),
    ).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(rpcCalls("enqueue_job")).toEqual([]);
  });

  it("refuses an account with no address, and queues nothing", async () => {
    const { db, rpcCalls } = world({ data: { user: {} }, error: null });
    await expect(
      sendTestToActor(person("managing_editor"), db, { id: ISSUE }),
    ).rejects.toMatchObject({
      code: "validation",
    });
    expect(rpcCalls("enqueue_job")).toEqual([]);
  });
});
