import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { ADMIN_PAGE_MAX, adminPageSchema } from "../../src/domain/admin-page";
import {
  listSubmissionsInputSchema,
  submissionListSchema,
  type SubmissionListRow,
} from "../../src/domain/admin-submissions";
import { defineAdminRoute, type AdminDeps } from "../../src/server/lib/admin-route";
import { listSubmissions } from "../../src/server/submissions/service";
import { fakeDb, type FakeDbOptions } from "../fixtures/fake-db";

// Invariant 17c: every admin list is one keyset page of at most 50 rows, and screen 7's "New from request" list holds
// only accepted requests without a property.

const editor = {
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles: ["managing_editor"],
  scopes: [],
} as const;

function row(n: number, overrides: Partial<SubmissionListRow> = {}): SubmissionListRow {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    received_at: new Date(Date.UTC(2026, 9, 1) - n * 60_000).toISOString(),
    address: `${String(n)} Fixture Lane`,
    city: "Montecito",
    state: "California",
    submitter_kind: "agent",
    submitter_name: `Submitter ${String(n)}`,
    brokerage: "Fixture Brokerage",
    package: "The Feature",
    workflow_state: "Submitted",
    accepted_at: null,
    duplicate_of: null,
    turnstile_ok: true,
    property_id: null,
    ...overrides,
  };
}

type ListRpc = NonNullable<NonNullable<FakeDbOptions["rpc"]>["list_submissions"]>;

/** The list route with stand-in guards over a database whose `list_submissions` answers `rpc`. */
function listRoute(rpc: ListRpc) {
  const deps: AdminDeps = {
    db: () => fakeDb({ rpc: { list_submissions: rpc } }),
    requireActor: () => Promise.resolve(editor),
    verifyCsrf: () => Promise.resolve(),
    assertSessionFresh: () => undefined,
    requireRecentAuth: () => undefined,
  };
  const route = defineAdminRoute(
    {
      method: "GET",
      action: "submissions.list",
      input: listSubmissionsInputSchema,
      output: submissionListSchema,
      handler: (ctx, input) => listSubmissions(ctx.actor, ctx.db, input),
    },
    deps,
  );
  return (query: string) =>
    route({
      request: new Request(`https://example.test/api/admin/submissions${query}`),
      context: { requestId: "req-page" },
    });
}

describe("adminPageSchema", () => {
  it("defaults the limit to 50 and refuses more than 50", () => {
    expect(ADMIN_PAGE_MAX).toBe(50);
    expect(adminPageSchema.parse({}).limit).toBe(50);
    expect(adminPageSchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(adminPageSchema.parse({ limit: "50" }).limit).toBe(50);
  });
});

describe("GET /api/admin/submissions", () => {
  it("answers limit=51 with 422 and asks the database nothing", async () => {
    let calls = 0;
    const response = await listRoute(() => {
      calls += 1;
      return [];
    })("?limit=51");
    expect({ status: response.status, calls }).toEqual({ status: 422, calls: 0 });
  });

  it("returns at most 50 rows without a limit, and a cursor to the next page", async () => {
    const response = await listRoute(() => Array.from({ length: 60 }, (_, n) => row(n + 1)))("");
    const page = submissionListSchema.parse(await response.json());
    expect({
      status: response.status,
      rows: page.items.length,
      next: page.next_cursor,
    }).toEqual({
      status: 200,
      rows: 50,
      next: `${row(50).received_at}~${row(50).id}`,
    });
  });
});

describe("listSubmissions", () => {
  it("with without_property=true answers only the accepted request that has no property", async () => {
    const accepted = {
      workflow_state: "Accepted",
      accepted_at: "2026-09-20T10:00:00.000Z",
    } as const;
    const withProperty = row(1, {
      ...accepted,
      property_id: "00000000-0000-4000-8000-0000000000aa",
    });
    const without = row(2, accepted);
    // The stand-in keeps `list_submissions`'s contract for the flag: a row with a property is left out.
    const db = fakeDb({
      rpc: {
        list_submissions: (args) =>
          [withProperty, without].filter(
            (candidate) => args.p_without_property !== true || candidate.property_id === null,
          ),
      },
    });
    const page = await listSubmissions(
      { ...editor, requestId: "req-1" },
      db,
      listSubmissionsInputSchema.parse({ without_property: "true" }),
    );
    expect(page.items.map((item) => item.id)).toEqual([without.id]);
  });
});
