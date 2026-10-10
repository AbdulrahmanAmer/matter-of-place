import "../fixtures/worker-env";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/db";
import { agentScopes } from "../../src/domain/admin-team";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { verifyKey } from "../../src/server/lib/agent-keys";
import { ForbiddenError, matrix } from "../../src/server/lib/authz";
import { AppError } from "../../src/server/lib/errors";
import {
  createAgent,
  createAgentKey,
  getDailyLimits,
  grantRole,
  inviteUser,
  listAgentKeys,
  listUsers,
  putDailyLimits,
  revokeAgentKey,
  revokeAllAgentKeys,
  revokeRole,
  setUserDisabled,
} from "../../src/server/team/service";
import { fakeDb, type FakeDbOptions } from "../fixtures/fake-db";
import { routeHandler, SITE, stubAuthEnv } from "../fixtures/supabase-auth";

// Step 14: the team service. Invite and agent creation make the auth account first and delete it when the role write
// fails; a key is shown once and stored as its sha256; every team action is for a person only; revoke-all ends every key.

type KeyRow = Database["public"]["Functions"]["agent_key_by_hash"]["Returns"][number];

const NEW_USER = "00000000-0000-4000-8000-0000000000e1";
const AGENT = "00000000-0000-4000-8000-0000000000e2";
const KEY_ID = "00000000-0000-4000-8000-0000000000e3";

const admin: AdminActor = {
  userId: "00000000-0000-4000-8000-0000000000e0",
  kind: "human",
  roles: ["admin"],
  scopes: [],
  requestId: "req-1",
};

const agent: AdminActor = {
  userId: AGENT,
  kind: "agent",
  roles: ["admin", "managing_editor"],
  scopes: [...agentScopes, "team", "settings"],
  requestId: "req-2",
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The auth admin API of the service-role client, as the service calls it. */
function fakeAuthAdmin() {
  return {
    inviteUserByEmail: vi.fn(
      (email: string): Promise<{ data: { user: { id: string } | null }; error: Error | null }> =>
        Promise.resolve({ data: { user: { id: NEW_USER, email } }, error: null }),
    ),
    createUser: vi.fn((attributes: { email: string; email_confirm: boolean }) =>
      Promise.resolve({ data: { user: { id: AGENT, email: attributes.email } }, error: null }),
    ),
    deleteUser: vi.fn((id: string) => Promise.resolve({ data: { user: { id } }, error: null })),
  };
}

function world(rpc: FakeDbOptions["rpc"] = {}) {
  const authAdmin = fakeAuthAdmin();
  const db = Object.assign(fakeDb({ rpc }), { auth: { admin: authAdmin } });
  return { db, authAdmin };
}

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );

const roleRowSchema = z.object({
  p_user: z.string(),
  p_role: z.string(),
  p_note: z.string(),
  p_user_kind: z.string().optional(),
  p_display_name: z.string().optional(),
});

describe("inviteUser", () => {
  it("calls inviteUserByEmail once and writes the user_roles row through grant_role with note invite", async () => {
    const granted: z.infer<typeof roleRowSchema>[] = [];
    const { db, authAdmin } = world({
      grant_role: (args) => {
        granted.push(roleRowSchema.parse(args));
        return "role-row-1";
      },
    });
    const answer = await inviteUser(admin, db, {
      email: "editor@matterofplace.com",
      display_name: "New Editor",
      roles: ["managing_editor"],
    });
    expect({
      answer,
      invites: authAdmin.inviteUserByEmail.mock.calls,
      granted,
      deleted: authAdmin.deleteUser.mock.calls.length,
    }).toEqual({
      answer: { user_id: NEW_USER },
      invites: [["editor@matterofplace.com"]],
      granted: [
        {
          p_user: NEW_USER,
          p_role: "managing_editor",
          p_note: "invite",
          p_display_name: "New Editor",
        },
      ],
      deleted: 0,
    });
  });

  it("a failed grant_role deletes the new auth user and answers 500 team_write_failed", async () => {
    const { db, authAdmin } = world({ grant_role: () => new Error("connection reset") });
    const error = await failureOf(
      inviteUser(admin, db, {
        email: "editor@matterofplace.com",
        display_name: "New Editor",
        roles: ["visual_editor"],
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect({
      code: error instanceof AppError ? error.code : null,
      status: error instanceof AppError ? error.status : null,
      deleted: authAdmin.deleteUser.mock.calls,
    }).toEqual({ code: "team_write_failed", status: 500, deleted: [[NEW_USER]] });
  });

  it("an address that already has an account answers 409 already_exists and writes no role", async () => {
    const { db, authAdmin } = world();
    const { AuthApiError } = await import("@supabase/supabase-js");
    authAdmin.inviteUserByEmail.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthApiError("exists", 422, "email_exists"),
    });
    const error = await failureOf(
      inviteUser(admin, db, {
        email: "editor@matterofplace.com",
        display_name: "New Editor",
        roles: ["visual_editor"],
      }),
    );
    expect(error instanceof AppError ? error.code : error).toBe("already_exists");
    expect(db.calls).toEqual([]);
  });
});

describe("last admin", () => {
  it("setUserDisabled answers 409 last_admin when set_user_disabled refuses the last enabled admin", async () => {
    const { db } = world({
      set_user_disabled: () =>
        Object.assign(new Error("last_admin"), {
          code: "P0001",
          details: "The team needs at least one active administrator.",
        }),
    });
    const error = await failureOf(setUserDisabled(admin, db, { id: admin.userId, disabled: true }));
    expect(error instanceof AppError ? [error.code, error.status, error.message] : error).toEqual([
      "last_admin",
      409,
      "The team needs at least one active administrator.",
    ]);
  });
});

describe("agent keys", () => {
  it("returns the key once with the mopk_ prefix and passes only its sha256 to create_agent_key", async () => {
    const sent: unknown[] = [];
    const { db } = world({
      create_agent_key: (args) => {
        sent.push(args);
        return KEY_ID;
      },
    });
    const created = await createAgentKey(
      admin,
      db,
      { id: AGENT, label: "Queue key", scopes: ["submissions"] },
      "local",
    );
    expect(created.key).toMatch(/^mopk_local_[\w-]{40,}$/);
    expect(JSON.stringify(sent)).not.toContain(created.key);
    expect({ ...created, key: "(shown once)" }).toEqual({
      user_id: AGENT,
      key_id: KEY_ID,
      key: "(shown once)",
    });
    expect(sent).toEqual([
      {
        p_user: AGENT,
        p_hash: sha256(created.key),
        p_label: "Queue key",
        p_scopes: ["submissions"],
        p_actor: admin.userId,
        p_actor_kind: "human",
        p_request_id: "req-1",
      },
    ]);
  });

  it("createAgent makes a confirmed .invalid auth user, grants its role as an agent named by its label, and issues its key", async () => {
    const granted: z.infer<typeof roleRowSchema>[] = [];
    const { db, authAdmin } = world({
      grant_role: (args) => {
        granted.push(roleRowSchema.parse(args));
        return "role-row-2";
      },
      create_agent_key: () => KEY_ID,
    });
    const created = await createAgent(
      admin,
      db,
      { label: "Queue bot", role: "managing_editor", scopes: ["submissions", "media"] },
      "local",
    );
    const [attributes] = authAdmin.createUser.mock.calls[0] ?? [];
    expect({
      email: attributes?.email.endsWith("@matterofplace.invalid"),
      confirmed: attributes?.email_confirm,
      granted,
      created: { user_id: created.user_id, key_id: created.key_id },
    }).toEqual({
      email: true,
      confirmed: true,
      granted: [
        {
          p_user: AGENT,
          p_role: "managing_editor",
          p_note: "agent_create",
          p_user_kind: "agent",
          p_display_name: "Queue bot",
        },
      ],
      created: { user_id: AGENT, key_id: KEY_ID },
    });
  });

  it("revoke_all_agent_keys revokes every live key, and a revoked key then gets 401", async () => {
    const keys = ["mopk_local_first", "mopk_local_second"].map((key, index) => ({
      key,
      row: z.custom<KeyRow>().parse({
        key_id: `00000000-0000-4000-8000-00000000000${String(index)}`,
        user_id: AGENT,
        scopes: ["submissions"],
        revoked_at: null,
        last_used_at: null,
        roles: ["managing_editor"],
      }),
    }));
    const { db } = world({
      revoke_all_agent_keys: () => {
        const live = keys.filter(({ row }) => z.string().nullable().parse(row.revoked_at) === null);
        for (const { row } of live) row.revoked_at = new Date().toISOString();
        return live.length;
      },
      agent_key_by_hash: ({ p_hash }) =>
        keys.filter(({ key }) => sha256(key) === p_hash).map(({ row }) => row),
    });
    expect(await revokeAllAgentKeys(admin, db)).toEqual({ revoked: 2 });
    const refused = await failureOf(verifyKey(db, "mopk_local_first", "203.0.113.9"));
    expect(refused instanceof AppError ? [refused.code, refused.status] : refused).toEqual([
      "unauthorized",
      401,
    ]);
  });
});

describe("person only", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("refuses an agent with human_only on every team function before it touches the database", async () => {
    const id = { id: AGENT };
    // Any call on this client throws `unexpected ...`, so only a refusal before the database is human_only.
    const db = fakeDb();
    const calls: (() => Promise<unknown>)[] = [
      () => listUsers(agent, db, {}),
      () => inviteUser(agent, db, { email: "a@b.co", display_name: "A", roles: ["admin"] }),
      () => grantRole(agent, db, { ...id, role: "admin" }),
      () => revokeRole(agent, db, { ...id, role: "admin" }),
      () => setUserDisabled(agent, db, { ...id, disabled: true }),
      () => createAgent(agent, db, { label: "x", role: "commercial", scopes: ["media"] }, "local"),
      () => createAgentKey(agent, db, { ...id, label: "x", scopes: ["media"] }, "local"),
      () => revokeAgentKey(agent, db, { keyId: KEY_ID }),
      () => revokeAllAgentKeys(agent, db),
      () => listAgentKeys(agent, db, {}),
      () => getDailyLimits(agent, db),
      () =>
        putDailyLimits(agent, db, {
          decisions_per_day: 1,
          publish_per_day: 1,
          requests_per_day: 1,
        }),
    ];
    const codes = await Promise.all(
      calls.map(async (call) => {
        const error = await failureOf(call());
        return error instanceof ForbiddenError ? error.code : String(error);
      }),
    );
    expect(codes).toEqual(calls.map(() => "human_only"));
  });

  it("an agent key gets 403 human_only from every team route", async () => {
    stubAuthEnv();
    const { setDbForTests } = await import("../../src/server/lib/db");
    setDbForTests(
      fakeDb({
        rpc: {
          agent_key_by_hash: () => [
            z.custom<KeyRow>().parse({
              key_id: KEY_ID,
              user_id: AGENT,
              scopes: [...agentScopes],
              revoked_at: null,
              last_used_at: new Date().toISOString(),
              roles: ["managing_editor"],
            }),
          ],
          rate_limit_check: () => [{ allowed: true, retry_after: 0 }],
        },
        tables: {
          settings: [
            {
              key: "agent_daily_limits",
              value: { requests_per_day: 2000 },
              updated_at: new Date().toISOString(),
              updated_by: null,
            },
          ],
        },
      }),
    );
    const routes = [
      ["team.users", "GET"],
      ["team.users", "POST"],
      ["team.users.$id.roles", "POST"],
      ["team.users.$id.roles.$role", "DELETE"],
      ["team.users.$id.disable", "POST"],
      ["team.agents", "GET"],
      ["team.agents", "POST"],
      ["team.agents.revoke-all", "POST"],
      ["team.agents.$id.keys", "POST"],
      ["team.agents.$id.keys.$keyId", "DELETE"],
      ["team.limits", "GET"],
      ["team.limits", "PUT"],
    ] as const;
    const answers: string[] = [];
    for (const [file, method] of routes) {
      const module: unknown = await import(`../../src/routes/api/admin/${file}.ts`);
      const response = await routeHandler(
        module,
        method,
      )({
        request: new Request(`${SITE}/api/admin/team`, {
          method,
          headers: {
            authorization: "Bearer mopk_local_agent",
            "cf-connecting-ip": "203.0.113.5",
            ...(method === "GET" ? {} : { "content-type": "application/json" }),
          },
          ...(method === "GET" ? {} : { body: "{}" }),
        }),
        context: { requestId: "r1" },
        params: { id: AGENT, role: "admin", keyId: KEY_ID },
      });
      const body = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(await response.json());
      answers.push(`${file} ${method} ${String(response.status)} ${body.data?.error.code ?? ""}`);
    }
    expect(answers).toEqual(routes.map(([file, method]) => `${file} ${method} 403 human_only`));
  });
});

describe("agentScopes", () => {
  it("is every route group of the matrix but team and settings", () => {
    const groups = [...new Set(matrix.map((entry) => entry.group))]
      .filter((group) => group !== "team" && group !== "settings")
      .sort();
    expect([...agentScopes].sort()).toEqual(groups);
  });
});
