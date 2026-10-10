// B7 step 15a, invariant 16 (GG-01): screen 24's redirects. `putRedirect` checks a row against the active rows with
// `redirectSchema` before any RPC, and refuses with 422 `invalid_redirect`; removing a row archives it.
import "../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/db";
import { agentScopes } from "../../src/domain/admin-team";
import type { RedirectRow } from "../../src/domain/admin-settings";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import { archiveRedirect, putRedirect } from "../../src/server/settings/service";
import { fakeDb } from "../fixtures/fake-db";
import { routeHandler, SITE, stubAuthEnv } from "../fixtures/supabase-auth";

type KeyRow = Database["public"]["Functions"]["agent_key_by_hash"]["Returns"][number];

const admin: AdminActor = {
  userId: "00000000-0000-4000-8000-0000000000e0",
  kind: "human",
  roles: ["admin"],
  scopes: [],
  requestId: "req-redirects",
};

const ID_A = "00000000-0000-4000-8000-0000000000e1";
const ID_B = "00000000-0000-4000-8000-0000000000e2";

const active = (rows: [id: string, from: string, to: string][]): RedirectRow[] =>
  rows.map(([id, from_path, to_path]) => ({ id, from_path, to_path, status: 301 }));

/** A client holding `rows` as the active redirects, whose put_redirect echoes its row. */
function client(rows: RedirectRow[]) {
  const seen: unknown[] = [];
  const stamp = "2026-10-10T00:00:00Z";
  const db = fakeDb({
    tables: {
      redirects: rows.map((row) => ({
        ...row,
        enabled: true,
        note: null,
        archived_at: null,
        created_by: null,
        created_at: stamp,
        updated_at: stamp,
      })),
    },
    rpc: {
      put_redirect: (args) => {
        seen.push(args);
        return {
          id: args.p_id ?? ID_B,
          from_path: args.p_from_path,
          to_path: args.p_to_path,
          status: args.p_status,
        };
      },
    },
  });
  return { db, seen };
}

const rpcNames = (db: ReturnType<typeof fakeDb>) =>
  db.calls.filter((call) => call.kind === "rpc").map((call) => call.name);

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "saved";
  } catch (error) {
    return error instanceof AppError
      ? `${String(error.status)} ${error.code}: ${error.message}`
      : String(error);
  }
}

describe("putRedirect", () => {
  it("refuses an /admin and an /api source with 422 invalid_redirect before any RPC", async () => {
    const { db } = client([]);
    const answers = [
      await refusal(
        putRedirect(admin, db, { from_path: "/admin/team", to_path: "/", status: 301 }),
      ),
      await refusal(
        putRedirect(admin, db, { from_path: "/api/public/site", to_path: "/", status: 301 }),
      ),
    ];
    expect({ answers, rpc: rpcNames(db) }).toEqual({
      answers: [
        "422 invalid_redirect: Admin and API addresses cannot be redirected.",
        "422 invalid_redirect: Admin and API addresses cannot be redirected.",
      ],
      rpc: [],
    });
  });

  it("refuses a to_path of https://example.com/x with 422 invalid_redirect before any RPC", async () => {
    const { db } = client([]);
    const answer = await refusal(
      putRedirect(admin, db, {
        from_path: "/summer",
        to_path: "https://example.com/x",
        status: 301,
      }),
    );
    expect({ answer, rpc: rpcNames(db) }).toEqual({
      answer: "422 invalid_redirect: The new address must be a path on this site.",
      rpc: [],
    });
  });

  it("refuses a pair that loops through the active rows, directly or over two hops", async () => {
    const { db } = client(
      active([
        [ID_A, "/b", "/c"],
        [ID_B, "/c", "/a"],
      ]),
    );
    const answers = [
      await refusal(putRedirect(admin, db, { from_path: "/a", to_path: "/b", status: 301 })),
      await refusal(putRedirect(admin, db, { from_path: "/c-old", to_path: "/c", status: 301 })),
    ];
    expect({ answers, rpc: rpcNames(db) }).toEqual({
      answers: ["422 invalid_redirect: These addresses would redirect in a loop.", "saved"],
      rpc: ["put_redirect"],
    });
  });

  it("refuses a duplicate active source, and saves a change to that same row by its id", async () => {
    const { db, seen } = client(active([[ID_A, "/old", "/new"]]));
    const duplicate = await refusal(
      putRedirect(admin, db, { from_path: "/old", to_path: "/other", status: 302 }),
    );
    const edited = await putRedirect(admin, db, {
      id: ID_A,
      from_path: "/old",
      to_path: "/other",
      status: 302,
    });
    expect({ duplicate, edited, seen }).toEqual({
      duplicate: "422 invalid_redirect: That old address is already redirected.",
      edited: { id: ID_A, from_path: "/old", to_path: "/other", status: 302 },
      seen: [
        {
          p_from_path: "/old",
          p_to_path: "/other",
          p_status: 302,
          p_actor: admin.userId,
          p_actor_kind: "human",
          p_request_id: "req-redirects",
          p_id: ID_A,
        },
      ],
    });
  });
});

describe("archiveRedirect", () => {
  it("removes through archive_redirect, which sets archived_at and keeps the row, and never deletes", async () => {
    const stored: RedirectRow & { archived_at: string | null } = {
      id: ID_A,
      from_path: "/old",
      to_path: "/new",
      status: 301,
      archived_at: null,
    };
    const db = fakeDb({
      rpc: {
        archive_redirect: (args) => {
          if (args.p_id === stored.id) stored.archived_at = "2026-10-10T08:00:00+00:00";
          return { ...stored };
        },
      },
    });
    const answer = await archiveRedirect(admin, db, { id: ID_A });
    expect({ answer, stored, calls: db.calls.map((call) => `${call.kind} ${call.name}`) }).toEqual({
      answer: { ...stored, archived_at: "2026-10-10T08:00:00+00:00" },
      stored: { ...stored, archived_at: "2026-10-10T08:00:00+00:00" },
      calls: ["rpc archive_redirect"],
    });
  });
});

describe("the redirects route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("answers an agent key 403 human_only on GET, PUT and DELETE", async () => {
    stubAuthEnv();
    const { setDbForTests } = await import("../../src/server/lib/db");
    setDbForTests(
      fakeDb({
        rpc: {
          agent_key_by_hash: () => [
            z.custom<KeyRow>().parse({
              key_id: "00000000-0000-4000-8000-0000000000e3",
              user_id: "00000000-0000-4000-8000-0000000000e4",
              scopes: [...agentScopes],
              revoked_at: null,
              last_used_at: new Date().toISOString(),
              roles: ["admin"],
            }),
          ],
          rate_limit_check: () => [{ allowed: true, retry_after: 0 }],
        },
        tables: {
          settings: [
            {
              key: "agent_daily_limits",
              value: { requests_per_day: 2000 },
              updated_at: "2026-10-10T00:00:00Z",
              updated_by: null,
            },
          ],
        },
      }),
    );
    const module: unknown = await import("../../src/routes/api/admin/settings.redirects");
    const answers: string[] = [];
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await routeHandler(
        module,
        method,
      )({
        request: new Request(`${SITE}/api/admin/settings/redirects`, {
          method,
          headers: {
            authorization: "Bearer mopk_local_agent",
            "cf-connecting-ip": "203.0.113.5",
            ...(method === "GET" ? {} : { "content-type": "application/json" }),
          },
          ...(method === "GET" ? {} : { body: "{}" }),
        }),
        context: { requestId: "r1" },
        params: {},
      });
      const body = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(await response.json());
      answers.push(`${method} ${String(response.status)} ${body.data?.error.code ?? ""}`);
    }
    expect(answers).toEqual(["GET 403 human_only", "PUT 403 human_only", "DELETE 403 human_only"]);
  });
});
