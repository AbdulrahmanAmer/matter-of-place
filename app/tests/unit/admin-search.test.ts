import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { likePattern, searchAdmin } from "../../src/server/dashboard/search";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { propertyRow } from "../fixtures/asset-rows";
import { fakeDb } from "../fixtures/fake-db";

// The top bar's search (admin pass): one call, each group only for an actor who may list it.

const person: AdminActor = {
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles: ["chief_editor"],
  scopes: [],
  requestId: "req-search",
};

const PROPERTY = "11111111-1111-4111-8111-111111111111";

function world() {
  return fakeDb({
    rpc: { list_submissions: () => [], people_list: () => [] },
    tables: {
      properties: [
        propertyRow({ id: PROPERTY, title: "House on the Point", city: "Montecito", state: "CA" }),
      ],
      inquiries: [],
      payments: [],
      stories: [],
    },
  });
}

describe("searchAdmin", () => {
  it("answers only the groups with hits, each hit linking to its own screen", async () => {
    const answer = await searchAdmin(person, world(), { q: "point" });
    expect(answer).toEqual({
      groups: [
        {
          kind: "properties",
          items: [
            {
              id: PROPERTY,
              title: "House on the Point",
              detail: "Montecito, CA",
              href: `/admin/properties/${PROPERTY}`,
            },
          ],
        },
      ],
    });
  });

  it("reads only the groups an agent key's scopes allow, and never the others", async () => {
    const db = world();
    const agent: AdminActor = {
      ...person,
      kind: "agent",
      roles: ["managing_editor"],
      scopes: ["dashboard", "properties"],
    };
    const answer = await searchAdmin(agent, db, { q: "point" });
    expect({
      kinds: answer.groups.map((group) => group.kind),
      // One read per searched column (R44: no free text inside a built `.or()`), all of the one table.
      read: [...new Set(db.calls.map((call) => call.name))],
    }).toEqual({ kinds: ["properties"], read: ["properties"] });
  });

  it("strips what like and PostgREST read as syntax from the text", () => {
    expect(likePattern(' 50%_off, (pool) "x" ')).toBe("%50  off   pool   x%");
  });
});
