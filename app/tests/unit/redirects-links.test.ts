// W7 item 6: screen 24 lists `slug_history` (each old property address and the property it now leads to) beside the
// redirect rows, and answers a typed path from the same rules the site uses (`loadRedirectMap`): an active redirect row
// first, then the old address of a published property, else nothing.
import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/db";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { checkLink } from "../../src/server/redirect-links/service";
import { listRedirects } from "../../src/server/settings/service";
import { fakeDb } from "../fixtures/fake-db";

type PropertyRow = Database["public"]["Tables"]["properties"]["Row"];
type RedirectTableRow = Database["public"]["Tables"]["redirects"]["Row"];

const admin: AdminActor = {
  userId: "00000000-0000-4000-8000-0000000000a0",
  kind: "human",
  roles: ["admin"],
  scopes: [],
  requestId: "req-links",
};

const RIDGE = "00000000-0000-4000-8000-0000000000a1";
const COVE = "00000000-0000-4000-8000-0000000000a2";
const STAMP = "2026-10-10T00:00:00Z";

const property = (id: string, slug: string, title: string, state: string): PropertyRow =>
  z.custom<PropertyRow>().parse({ id, slug, title, editorial_state: state });

const redirect = (
  from_path: string,
  to_path: string,
  status = 301,
  archived_at: string | null = null,
): RedirectTableRow =>
  z.custom<RedirectTableRow>().parse({
    id: `00000000-0000-4000-8000-${String(from_path.length).padStart(12, "0")}`,
    from_path,
    to_path,
    status,
    archived_at,
  });

const history = (slug: string, property_id: string) => ({ slug, property_id, changed_at: STAMP });

const PROPERTIES = [
  property(RIDGE, "the-ridge", "The Ridge", "published"),
  property(COVE, "the-cove", "The Cove", "draft"),
];

function client(options: {
  redirects?: RedirectTableRow[];
  slugs?: ReturnType<typeof history>[];
  properties?: PropertyRow[];
}) {
  return fakeDb({
    tables: {
      redirects: options.redirects ?? [],
      slug_history: options.slugs ?? [],
      properties: options.properties ?? PROPERTIES,
    },
  });
}

const read = (db: ReturnType<typeof client>, input: { path?: string; limit?: number } = {}) =>
  listRedirects(
    admin,
    db,
    { limit: input.limit ?? 50, ...(input.path ? { path: input.path } : {}) },
    // the route passes the check in (redirect-links/service.ts), as here
    checkLink,
  );

describe("listRedirects, old property addresses", () => {
  it("lists each old slug with the title and current slug of its property, and whether it is published", async () => {
    const db = client({ slugs: [history("old-cove", COVE), history("old-ridge", RIDGE)] });
    const { old_addresses } = await read(db);
    expect(old_addresses.items).toEqual([
      {
        slug: "old-cove",
        property_id: COVE,
        title: "The Cove",
        current_slug: "the-cove",
        live: false,
      },
      {
        slug: "old-ridge",
        property_id: RIDGE,
        title: "The Ridge",
        current_slug: "the-ridge",
        live: true,
      },
    ]);
  });

  it("holds one more row than the page back to know there is a next page, and gives the last slug on the page as its cursor", async () => {
    const db = client({
      slugs: [history("old-a", RIDGE), history("old-b", RIDGE), history("old-c", RIDGE)],
    });
    const { old_addresses } = await read(db, { limit: 2 });
    expect({
      slugs: old_addresses.items.map((row) => row.slug),
      next: old_addresses.next_cursor,
    }).toEqual({ slugs: ["old-a", "old-b"], next: "old-b" });
  });

  it("answers no check, and reads no table for it, when no path was sent", async () => {
    const db = client({ slugs: [] });
    const page = await read(db);
    expect({ check: page.check, tables: db.calls.map((call) => call.name) }).toEqual({
      check: null,
      tables: ["redirects", "slug_history"],
    });
  });
});

describe("listRedirects, the test-a-link check", () => {
  it("answers an active redirect row before an old address of the same path", async () => {
    const db = client({
      redirects: [redirect("/property/old-ridge", "/markets", 302)],
      slugs: [history("old-ridge", RIDGE)],
    });
    const { check } = await read(db, { path: "/property/old-ridge" });
    expect(check?.steps).toEqual([
      { from: "/property/old-ridge", to: "/markets", status: 302, source: "redirect" },
    ]);
  });

  it("leads the old address of a published property to its current page with a 301, and not that of a draft", async () => {
    const db = client({ slugs: [history("old-ridge", RIDGE), history("old-cove", COVE)] });
    const ridge = (await read(db, { path: "/property/old-ridge" })).check;
    const cove = (await read(db, { path: "/property/old-cove" })).check;
    expect({ ridge: ridge?.steps, cove: cove?.steps }).toEqual({
      ridge: [
        {
          from: "/property/old-ridge",
          to: "/property/the-ridge",
          status: 301,
          source: "old_address",
        },
      ],
      cove: [],
    });
  });

  it("ignores an archived redirect row and answers no redirect for a path nothing leads from", async () => {
    const db = client({
      redirects: [redirect("/summer", "/markets", 301, STAMP)],
    });
    const summer = (await read(db, { path: "/summer" })).check;
    const other = (await read(db, { path: "/elsewhere" })).check;
    expect({ summer, other }).toEqual({
      summer: { path: "/summer", steps: [], loop: false },
      other: { path: "/elsewhere", steps: [], loop: false },
    });
  });

  it("reads a pasted address, a query string, capitals and a trailing slash as the site does", async () => {
    const db = client({ redirects: [redirect("/summer", "/markets", 302)] });
    const paths = [
      "https://matterofplace.com/Summer/?utm=x#top",
      "/SUMMER/",
      "summer",
      "/summer?x=1",
    ];
    const answers = [];
    for (const path of paths) answers.push((await read(db, { path })).check?.steps.length);
    expect(answers).toEqual([1, 1, 1, 1]);
  });

  it("follows each hop in order, and stops with loop true when the hops run in a circle", async () => {
    const chain = client({
      redirects: [
        redirect("/summer", "/markets", 302),
        redirect("/markets", "/property/old-ridge"),
      ],
      slugs: [history("old-ridge", RIDGE)],
    });
    const circle = client({
      redirects: [redirect("/a", "/b"), redirect("/b", "/a")],
    });
    const followed = (await read(chain, { path: "/summer" })).check;
    const circled = (await read(circle, { path: "/a" })).check;
    expect({
      hops: followed?.steps.map((step) => `${step.from} > ${step.to}`),
      loop: followed?.loop,
      circled: circled?.steps.map((step) => step.from),
      circleLoop: circled?.loop,
    }).toEqual({
      hops: [
        "/summer > /markets",
        "/markets > /property/old-ridge",
        "/property/old-ridge > /property/the-ridge",
      ],
      loop: false,
      circled: ["/a", "/b"],
      circleLoop: true,
    });
  });
});
