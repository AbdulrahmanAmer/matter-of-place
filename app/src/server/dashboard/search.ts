import {
  adminSearchKinds,
  type AdminSearchAnswer,
  type AdminSearchHit,
  type AdminSearchKind,
} from "../../domain/admin-search.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { authorize, can, type ActionId } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { listPeople } from "../people/service.ts";
import { listSubmissions } from "../submissions/service.ts";

// `GET /api/admin/search?q=` (W3, admin pass): the top bar's one search box. Each group is read only for an actor who
// may list it, at most five hits each. Requests and people go through their lists' own search; the rest match a name
// with `ilike`, the text stripped of the characters PostgREST and `like` treat as syntax.

const PER_GROUP = 5;
const listAction: Record<AdminSearchKind, ActionId> = {
  requests: "submissions.list",
  people: "people.list",
  properties: "properties.list",
  inquiries: "inquiries.list",
  invoices: "payments.list",
  stories: "stories.list",
};

const unavailable = () =>
  new AppError("unavailable", undefined, "Search could not read the records right now.");

/** Each row once, in the order found, at most PER_GROUP. */
function firstUnique<Row extends { id: string }>(rows: readonly Row[]): Row[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .slice(0, PER_GROUP);
}

/** The text as a `like` pattern: no `%`, `_`, backslash, comma, parenthesis, star or quote left to mean anything. */
export function likePattern(text: string): string {
  return `%${text.replace(/[%_\\,()*"]/g, " ").trim()}%`;
}

async function hitsFor(
  kind: AdminSearchKind,
  actor: AdminActor,
  db: Db,
  q: string,
): Promise<AdminSearchHit[]> {
  const pattern = likePattern(q);
  switch (kind) {
    case "requests": {
      const page = await listSubmissions(actor, db, { limit: PER_GROUP, search: q });
      return page.items.map((row) => ({
        id: row.id,
        title: row.address,
        detail: `${row.city}, ${row.state} · ${row.submitter_name}`,
        href: `/admin/requests/${row.id}`,
      }));
    }
    case "people": {
      const page = await listPeople(actor, db, { limit: PER_GROUP, search: q });
      return page.items.map((row) => ({
        id: row.id,
        title: row.name,
        detail: row.brokerage === null ? row.email : `${row.brokerage} · ${row.email}`,
        href: `/admin/people/${row.id}`,
      }));
    }
    case "properties": {
      // R44: no free text inside a built `or` string; one `ilike` per column, merged.
      const read = (column: "title" | "address") =>
        db
          .from("properties")
          .select("id, title, city, state")
          .ilike(column, pattern)
          .limit(PER_GROUP);
      const [byTitle, byAddress] = await Promise.all([read("title"), read("address")]);
      if (byTitle.error !== null || byAddress.error !== null) throw unavailable();
      return firstUnique([...byTitle.data, ...byAddress.data]).map((row) => ({
        id: row.id,
        title: row.title,
        detail: `${row.city}, ${row.state}`,
        href: `/admin/properties/${row.id}`,
      }));
    }
    case "inquiries": {
      const read = (column: "name" | "email") =>
        db
          .from("inquiries")
          .select("id, name, email, subject_title")
          .ilike(column, pattern)
          .order("created_at", { ascending: false })
          .limit(PER_GROUP);
      const [byName, byEmail] = await Promise.all([read("name"), read("email")]);
      if (byName.error !== null || byEmail.error !== null) throw unavailable();
      return firstUnique([...byName.data, ...byEmail.data]).map((row) => ({
        id: row.id,
        title: row.name,
        detail: row.subject_title ?? row.email,
        href: `/admin/inquiries?id=${row.id}`,
      }));
    }
    case "invoices": {
      const { data, error } = await db
        .from("payments")
        .select("id, invoice_number, status")
        .ilike("invoice_number", pattern)
        .limit(PER_GROUP);
      if (error !== null) throw unavailable();
      return data.map((row) => ({
        id: row.id,
        title: row.invoice_number ?? "Draft invoice",
        detail: row.status,
        href: `/admin/invoices/${row.id}`,
      }));
    }
    case "stories": {
      const { data, error } = await db
        .from("stories")
        .select("id, title, market_slug")
        .ilike("title", pattern)
        .limit(PER_GROUP);
      if (error !== null) throw unavailable();
      return data.map((row) => ({
        id: row.id,
        title: row.title,
        detail: row.market_slug,
        href: `/admin/stories/${row.id}`,
      }));
    }
  }
}

export async function searchAdmin(
  actor: AdminActor,
  db: Db,
  input: { q: string },
): Promise<AdminSearchAnswer> {
  authorize(actor, "dashboard.search");
  const kinds = adminSearchKinds.filter((kind) => can(actor, listAction[kind]));
  const groups = await Promise.all(
    kinds.map(async (kind) => ({ kind, items: await hitsFor(kind, actor, db, input.q) })),
  );
  return { groups: groups.filter((group) => group.items.length > 0) };
}
