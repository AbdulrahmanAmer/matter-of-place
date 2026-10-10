// B7 step 15a, invariant 15 (GP-01): the data requests of screen 25. The list carries the days left of the 45 day
// clock; the four writes are admin only, people only and need a sign-in within 15 minutes, which `defineAdminRoute`
// enforces from the matrix (API-02). Run through the route files with the real guards.
import "../fixtures/worker-env";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/db";
import { agentScopes } from "../../src/domain/admin-team";
import {
  exportSubject,
  listSubjectRequests,
  setSubjectRequestStatus,
} from "../../src/server/audit/subject-requests";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import { fakeDb } from "../fixtures/fake-db";
import {
  CSRF_KEY,
  fakeAuth,
  rolesDb,
  routeHandler,
  SESSION_ID,
  sessionCookie,
  signer,
  SITE,
  stubAuthEnv,
} from "../fixtures/supabase-auth";

type KeyRow = Database["public"]["Functions"]["agent_key_by_hash"]["Returns"][number];
type RequestRow = Database["public"]["Tables"]["subject_requests"]["Row"];

const NOW = Date.parse("2026-10-10T12:00:00Z");
const DAY = 86_400_000;
const REQUEST = "00000000-0000-4000-8000-0000000000d1";

const admin: AdminActor = {
  userId: "00000000-0000-4000-8000-0000000000d0",
  kind: "human",
  roles: ["admin"],
  scopes: [],
  requestId: "req-subjects",
};

const BUNDLE = {
  request: { id: REQUEST, kind: "access", received_at: "2026-09-01T00:00:00+00:00" },
  email: "person@example.invalid",
  subscribers: [],
  inquiries: [],
  contacts: [],
  submissions: [],
};

/** A request received `daysAgo` days before NOW, due 45 days after it, as B3's generated column has it. */
const requestRow = (id: string, daysAgo: number): RequestRow => {
  const received = NOW - daysAgo * DAY;
  return {
    id,
    email: "person@example.invalid",
    kind: "deletion",
    note: null,
    status: "verifying",
    received_at: new Date(received).toISOString(),
    due_at: new Date(received + 45 * DAY).toISOString(),
    verified_at: null,
    fulfilled_at: null,
    handled_by: null,
    ip_hash: null,
    turnstile_ok: true,
    created_at: new Date(received).toISOString(),
    updated_at: new Date(received).toISOString(),
  };
};

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "done";
  } catch (error) {
    return error instanceof AppError ? `${String(error.status)} ${error.code}` : String(error);
  }
}

const codeOf = async (response: Response) =>
  z.object({ error: z.object({ code: z.string() }) }).safeParse(await response.json()).data?.error
    .code ?? "";

describe("listSubjectRequests", () => {
  it("shows a request 40 days old with 5 days left, and one received today with 45", async () => {
    const db = fakeDb({
      tables: {
        subject_requests: [
          requestRow(REQUEST, 40),
          requestRow("00000000-0000-4000-8000-0000000000d2", 0),
        ],
      },
    });
    const page = await listSubjectRequests(admin, db, { limit: 50 }, new Date(NOW));
    expect({
      days: page.items.map((row) => row.days_left),
      next: page.next_cursor,
    }).toEqual({ days: [5, 45], next: null });
  });

  it("names the last row of a full page as the next cursor", async () => {
    const rows = [requestRow(REQUEST, 1), requestRow("00000000-0000-4000-8000-0000000000d2", 2)];
    const page = await listSubjectRequests(
      admin,
      fakeDb({ tables: { subject_requests: rows } }),
      { limit: 1 },
      new Date(NOW),
    );
    expect({ ids: page.items.map((row) => row.id), next: page.next_cursor }).toEqual({
      ids: [REQUEST],
      next: `${rows[0]?.received_at ?? ""}~${REQUEST}`,
    });
  });
});

describe("the writes", () => {
  it("setSubjectRequestStatus sends the note only when there is one, with the audit triple", async () => {
    const seen: unknown[] = [];
    const db = fakeDb({
      rpc: {
        set_subject_request_status: (args) => {
          seen.push(args);
          return {
            id: REQUEST,
            status: "verifying",
            verified_at: null,
            fulfilled_at: null,
            handled_by: admin.userId,
          };
        },
      },
    });
    await setSubjectRequestStatus(admin, db, { id: REQUEST, action: "start_verification" });
    await setSubjectRequestStatus(admin, db, { id: REQUEST, action: "reject", note: "No reply." });
    const triple = { p_actor: admin.userId, p_actor_kind: "human", p_request_id: "req-subjects" };
    expect(seen).toEqual([
      { p_subject_request_id: REQUEST, p_action: "start_verification", ...triple },
      { p_subject_request_id: REQUEST, p_action: "reject", ...triple, p_note: "No reply." },
    ]);
  });

  it("answers the SQL refusals not_verified, wrong_kind and wrong_state as 409", async () => {
    const answers = [];
    for (const code of ["not_verified", "wrong_kind", "wrong_state"]) {
      const db = fakeDb({ rpc: { export_subject: () => new Error(code) } });
      answers.push(await refusal(exportSubject(admin, db, { id: REQUEST })));
    }
    expect(answers).toEqual(["409 not_verified", "409 wrong_kind", "409 wrong_state"]);
  });
});

const WRITES = [
  ["audit.subject-requests.$id.status", { action: "start_verification" }],
  ["audit.subject-requests.$id.export", {}],
  ["audit.subject-requests.$id.delete", {}],
  ["audit.subject-requests.$id.opt-out", {}],
] as const;

describe("the data-request routes", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("answer an agent key 403 human_only on every write", async () => {
    stubAuthEnv();
    const { setDbForTests } = await import("../../src/server/lib/db");
    setDbForTests(
      fakeDb({
        rpc: {
          agent_key_by_hash: () => [
            z.custom<KeyRow>().parse({
              key_id: "00000000-0000-4000-8000-0000000000d3",
              user_id: "00000000-0000-4000-8000-0000000000d4",
              scopes: [...agentScopes, "audit"],
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
    const answers: string[] = [];
    for (const [file, body] of WRITES) {
      const module: unknown = await import(`../../src/routes/api/admin/${file}.ts`);
      const response = await routeHandler(
        module,
        "POST",
      )({
        request: new Request(`${SITE}/api/admin/audit/subject-requests/${REQUEST}`, {
          method: "POST",
          headers: {
            authorization: "Bearer mopk_local_agent",
            "cf-connecting-ip": "203.0.113.5",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        context: { requestId: "r1" },
        params: { id: REQUEST },
      });
      answers.push(`${file} ${String(response.status)} ${await codeOf(response)}`);
    }
    expect(answers).toEqual(WRITES.map(([file]) => `${file} 403 human_only`));
  });

  describe("a person's session", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });

    it("gets 401 reauth_required on every write 20 minutes after sign-in, and the export 10 minutes after", async () => {
      const key = await signer("kid-subjects");
      stubAuthEnv();
      fakeAuth([key.jwk]);
      vi.resetModules();
      const { setDbForTests } = await import("../../src/server/lib/db");
      setDbForTests(
        rolesDb([{ role: "admin", disabled: false }], { rpc: { export_subject: () => BUNDLE } }),
      );
      const send = async (file: string, body: object, minutesAgo: number) => {
        const module: unknown = await import(`../../src/routes/api/admin/${file}.ts`);
        const token = await key.token({ now: NOW, signedInAt: NOW - minutesAgo * 60_000 });
        const response = await routeHandler(
          module,
          "POST",
        )({
          request: new Request(`${SITE}/api/admin/audit/subject-requests/${REQUEST}`, {
            method: "POST",
            headers: {
              cookie: sessionCookie(token, NOW),
              "content-type": "application/json",
              "x-mop-csrf": createHmac("sha256", CSRF_KEY).update(SESSION_ID).digest("base64url"),
            },
            body: JSON.stringify(body),
          }),
          context: { requestId: "r1" },
          params: { id: REQUEST },
        });
        return `${String(response.status)} ${response.ok ? "" : await codeOf(response)}`;
      };
      const stale = [];
      for (const [file, body] of WRITES) stale.push(await send(file, body, 20));
      expect({
        stale,
        recent: await send("audit.subject-requests.$id.export", {}, 10),
      }).toEqual({ stale: WRITES.map(() => "401 reauth_required"), recent: "200 " });
    });
  });
});
