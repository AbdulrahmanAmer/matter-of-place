import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import type { PersonDetail } from "../../src/domain/admin-people";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import { getPerson, listPeople, setPersonNotes } from "../../src/server/people/service";
import { fakeDb } from "../fixtures/fake-db";

// Screens 26 and 27 (B7 step 5a, invariant 23): one RPC per call, all six roles read, the four editorial roles note.

const PERSON = "00000000-0000-4000-8000-0000000000e1";

const actor = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-people",
});

const commercial = actor(["commercial"]);

// The shape `people_list` returns; generated types read every column of a returned table as not null.
const row = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  name: `Person ${String(n)}`,
  kind: "agent" as const,
  brokerage: "Fixture Brokerage",
  email: `person${String(n)}@example.test`,
  requests: 2,
  accepted: 1,
  published: 0,
  last_activity_at: "2026-10-06T12:00:00+00:00",
});

const detail: PersonDetail = {
  contact: {
    id: PERSON,
    kind: "agent",
    name: "Ana Fixture",
    email: "ana@example.test",
    phone: null,
    brokerage: "Fixture Brokerage",
    notes: null,
    updated_at: "2026-10-06T12:00:00.123456+00:00",
  },
  requests: [],
  properties: [],
  payments: [],
  emails: [],
  inquiries: [],
};

/** What a call answered: its result, or the status and code it was refused with. */
async function outcome(call: Promise<unknown>): Promise<unknown> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code };
    throw error;
  }
}

describe("listPeople", () => {
  it("lists for a commercial actor in one people_list call, the search passed unchanged", async () => {
    const search = " 50% O'Brien_ ";
    const db = fakeDb({ rpc: { people_list: () => [row(1)] } });
    const answer = await listPeople(commercial, db, { limit: 50, search, kind: "owner" });
    expect({ answer, calls: db.calls }).toEqual({
      answer: { items: [row(1)], next_cursor: null },
      calls: [
        {
          kind: "rpc",
          name: "people_list",
          args: [{ p_limit: 50, p_search: search, p_kind: "owner" }],
        },
      ],
    });
  });

  it("gives a full page the cursor of its last row and hands that cursor back as id and name", async () => {
    const first = fakeDb({ rpc: { people_list: () => [row(1), row(2)] } });
    const { next_cursor: cursor } = await listPeople(commercial, first, { limit: 2 });
    const second = fakeDb({ rpc: { people_list: () => [] } });
    await listPeople(commercial, second, { limit: 2, ...(cursor === null ? {} : { cursor }) });
    expect({ cursor, args: second.calls[0]?.args }).toEqual({
      cursor: `${row(2).id}~Person 2`,
      args: [{ p_limit: 2, p_cursor_id: row(2).id, p_cursor_name: "Person 2" }],
    });
  });
});

describe("getPerson", () => {
  it("reads one person for a commercial actor in one person_detail call", async () => {
    const db = fakeDb({ rpc: { person_detail: () => detail } });
    expect({
      answer: await getPerson(commercial, db, PERSON),
      calls: db.calls,
    }).toEqual({
      answer: detail,
      calls: [{ kind: "rpc", name: "person_detail", args: [{ p_contact_id: PERSON }] }],
    });
  });

  it("answers 404 not_found for an unknown person", async () => {
    const db = fakeDb({
      rpc: { person_detail: () => Object.assign(new Error("not_found"), { code: "P0001" }) },
    });
    expect(await outcome(getPerson(commercial, db, PERSON))).toEqual({
      status: 404,
      code: "not_found",
    });
  });
});

describe("setPersonNotes", () => {
  const input = { notes: "Prefers a call.", expected_updated_at: detail.contact.updated_at };

  it("saves for a media_ops actor in one set_contact_notes call with the actor triple", async () => {
    const db = fakeDb({ rpc: { set_contact_notes: () => "2026-10-06T12:05:00.000001+00:00" } });
    expect({
      answer: await setPersonNotes(actor(["media_ops"]), db, PERSON, input),
      calls: db.calls,
    }).toEqual({
      answer: { updated_at: "2026-10-06T12:05:00.000001+00:00" },
      calls: [
        {
          kind: "rpc",
          name: "set_contact_notes",
          args: [
            {
              p_contact_id: PERSON,
              p_notes: input.notes,
              p_expected_updated_at: input.expected_updated_at,
              p_actor: "00000000-0000-4000-8000-000000000001",
              p_actor_kind: "human",
              p_request_id: "req-people",
            },
          ],
        },
      ],
    });
  });

  it("refuses a commercial actor with 403 before any database call", async () => {
    const db = fakeDb();
    expect({
      answer: await outcome(setPersonNotes(commercial, db, PERSON, input)),
      calls: db.calls.length,
    }).toEqual({ answer: { status: 403, code: "forbidden" }, calls: 0 });
  });

  it("answers 409 stale when someone else saved first", async () => {
    const db = fakeDb({
      rpc: { set_contact_notes: () => Object.assign(new Error("stale"), { code: "P0001" }) },
    });
    expect(await outcome(setPersonNotes(actor(["chief_editor"]), db, PERSON, input))).toEqual({
      status: 409,
      code: "stale",
    });
  });
});
