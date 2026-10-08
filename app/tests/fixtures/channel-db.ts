// The database of B10's posting tests: RPCs recorded as fakeDb records them, with tables that honour the filters a
// channel query uses, and a world of one property, one asset and the five channel rows whose social.sql functions keep
// their rows as the SQL does (one row per asset and channel, the in-flight compare-and-set, posting a scheduled row).
import type { Json } from "../../src/db/index.ts";
import { fakeDb, type FakeDb } from "./fake-db";

type Row = Record<string, unknown>;
type Check = (row: Row) => boolean;
/** An RPC by name; an `Error` it returns is the call's error, anything else its data. */
export type Handler = (args: Row) => unknown;

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** A column of a row, or the value at a JSON path such as `data->utm->>utm_source` (PostgREST spells it so). */
function valueAt(row: Row, column: string): unknown {
  const [head = "", ...path] = column.split(/->>?/);
  return path.reduce<unknown>(
    (value, key) =>
      typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined,
    row[head],
  );
}

/**
 * `tables` answer `from(name)` with the rows every filter of the query keeps, `handlers` answer `rpc(name)`; any
 * other table or function throws, and every call is recorded in `calls` as fakeDb does.
 */
export function tableDb(
  tables: Record<string, Row[]>,
  handlers: Record<string, Handler> = {},
): FakeDb {
  const db = fakeDb();
  const rpc = (name: string, args: Row = {}) => {
    db.calls.push({ kind: "rpc", name, args: [args] });
    const handler = handlers[name];
    if (handler === undefined) throw new Error(`unexpected rpc ${name}`);
    return Promise.resolve(handler(args)).then((answer) =>
      answer instanceof Error
        ? { data: null, error: answer }
        : { data: answer ?? null, error: null },
    );
  };
  const from = (name: string) => {
    db.calls.push({ kind: "from", name, args: [] });
    const rows = tables[name];
    if (rows === undefined) throw new Error(`unexpected table ${name}`);
    const checks: Check[] = [];
    let sort: { column: string; ascending: boolean } | null = null;
    let window: [number, number] | null = null;
    let counted = false;
    const answer = () => {
      const kept = rows.filter((row) => checks.every((check) => check(row)));
      if (sort !== null) {
        const { column, ascending } = sort;
        kept.sort((a, b) => text(a[column]).localeCompare(text(b[column])) * (ascending ? 1 : -1));
      }
      const data = window === null ? kept : kept.slice(window[0], window[1] + 1);
      return { data, error: null, count: counted ? kept.length : null };
    };
    // The promise settles after the chain is built, so every filter is in place when the rows are picked.
    const chain = Object.assign(Promise.resolve().then(answer), {
      select: (_columns?: string, options?: { count?: string }) => {
        counted = options?.count === "exact";
        return chain;
      },
      eq: (column: string, value: unknown) => {
        checks.push((row) => valueAt(row, column) === value);
        return chain;
      },
      neq: (column: string, value: unknown) => {
        checks.push((row) => row[column] !== value);
        return chain;
      },
      in: (column: string, values: readonly unknown[]) => {
        checks.push((row) => values.includes(row[column]));
        return chain;
      },
      is: (column: string, value: null) => {
        checks.push((row) => (row[column] ?? null) === value);
        return chain;
      },
      not: (column: string, _operator: "is", value: null) => {
        checks.push((row) => (row[column] ?? null) !== value);
        return chain;
      },
      gte: (column: string, value: string) => {
        checks.push((row) => row[column] != null && text(row[column]) >= value);
        return chain;
      },
      lt: (column: string, value: string) => {
        checks.push((row) => row[column] != null && text(row[column]) < value);
        return chain;
      },
      order: (column: string, options: { ascending: boolean }) => {
        sort = { column, ascending: options.ascending };
        return chain;
      },
      limit: (count: number) => {
        window = [0, count - 1];
        return chain;
      },
      range: (start: number, end: number) => {
        window = [start, end];
        return chain;
      },
    });
    return chain;
  };
  return Object.assign(db, { from, rpc });
}

export const PROPERTY = "3f2a9c1d-0000-4000-8000-0000000000c1";
export const ASSET = "3f2a9c1d-0000-4000-8000-0000000000c2";
export const HUMAN = "3f2a9c1d-0000-4000-8000-0000000000c3";
export const AGENT = "3f2a9c1d-0000-4000-8000-0000000000c4";
export const POST = "3f2a9c1d-0000-4000-8000-0000000000c5";
export const JOB = "3f2a9c1d-0000-4000-8000-0000000000c6";
/** When `mark_social_post_posted` says the row was posted. */
export const POSTED_AT = "2026-10-06T14:00:30.000Z";

/** Tuesday to Thursday, 09:00 to 12:00 in New York, two posts a day: the window social.sql seeds. */
export const WINDOW = {
  days: [2, 3, 4],
  from: "09:00",
  to: "12:00",
  tz: "America/New_York",
  daily_cap: 2,
};

export type PostRow = {
  id: string;
  asset_id: string;
  property_id: string;
  channel: string;
  status: "scheduled" | "posted" | "failed";
  scheduled_at: string;
  posted_at: string | null;
  remote_id: string | null;
  permalink: string | null;
  metrics: Json;
  error: string | null;
  withdraw_required_at: string | null;
  withdrawn_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobRow = { type: string; key: string; payload: unknown; runAfter: unknown };

/** A post row of the world: scheduled on `channel` for the world's asset unless `fields` says otherwise. */
export function postRow(channel: string, fields: Partial<PostRow> = {}): PostRow {
  return {
    id: POST,
    asset_id: ASSET,
    property_id: PROPERTY,
    channel,
    status: "scheduled",
    scheduled_at: "2026-10-06T13:55:00.000Z",
    posted_at: null,
    remote_id: null,
    permalink: null,
    metrics: {},
    error: null,
    withdraw_required_at: null,
    withdrawn_at: null,
    created_at: "2026-10-06T13:55:00.000Z",
    updated_at: "2026-10-06T13:55:00.000Z",
    ...fields,
  };
}

export interface WorldOptions {
  kind?: string;
  tier?: string;
  editorialState?: string;
  approvedBy?: string | null;
  enabled?: Partial<Record<string, boolean>>;
  approvalMode?: Record<string, string>;
  autoAfter?: string | null;
  window?: Row;
  posts?: PostRow[];
  assets?: Row[];
  audit?: Row[];
  settings?: Row[];
  files?: Json;
  meta?: Json;
  /** Fields of the world's asset row that differ from an approved, complete asset. */
  asset?: Row;
  handlers?: Record<string, Handler>;
}

const MARKER = /^(?:inflight|container):/;

/** One property, one approved asset and the channel rows, with the social.sql functions as in-memory rows. */
export function channelWorld(options: WorldOptions = {}) {
  const posts: PostRow[] = [...(options.posts ?? [])];
  const audit: Row[] = [...(options.audit ?? [])];
  const jobs: JobRow[] = [];
  const channels = ["instagram", "x", "linkedin", "facebook", "youtube"].map((channel) => ({
    channel,
    enabled: options.enabled?.[channel] ?? ["instagram", "x", "linkedin"].includes(channel),
    posting_window: options.window ?? WINDOW,
    approval_mode: options.approvalMode ?? {
      Feature: "manual",
      Reach: "manual",
      Campaign: "manual",
    },
    auto_after: options.autoAfter ?? null,
  }));
  const tables: Record<string, Row[]> = {
    assets: [
      {
        id: ASSET,
        kind: options.kind ?? "carousel",
        files: options.files ?? [
          {
            media_key: "assets/p/carousel/r1/slide-1.jpg",
            w: 1080,
            h: 1350,
            bytes: 1,
            role: "slide",
            index: 1,
          },
        ],
        caption: "Oak Hill, Larchmont.",
        alt_text: "A house.",
        meta: options.meta ?? { captions: { x: "Oak Hill.", linkedin: "Oak Hill, for agents." } },
        approved_by: options.approvedBy === undefined ? HUMAN : options.approvedBy,
        property_id: PROPERTY,
        status: "approved",
        ...options.asset,
      },
      ...(options.assets ?? []),
    ],
    properties: [
      {
        id: PROPERTY,
        slug: "oak-hill",
        title: "Oak Hill",
        editorial_state: options.editorialState ?? "published",
        campaign_tier: options.tier ?? "Feature",
      },
    ],
    settings: options.settings ?? [{ key: "linkedin", value: {} }],
    channel_settings: channels,
    user_roles: [
      { user_id: HUMAN, actor_kind: "human" },
      { user_id: AGENT, actor_kind: "agent" },
    ],
    social_posts: posts,
    audit_log: audit,
  };
  const find = (id: unknown) => posts.find((row) => row.id === id);
  const db = tableDb(tables, {
    schedule_social_post: (args) => {
      const existing = posts.find(
        (row) => row.asset_id === args["p_asset_id"] && row.channel === args["p_channel"],
      );
      if (existing !== undefined) return { ...existing };
      const at = text(args["p_scheduled_at"]);
      const created = postRow(text(args["p_channel"]), {
        asset_id: text(args["p_asset_id"]),
        scheduled_at: at,
        created_at: at,
        updated_at: at,
      });
      posts.push(created);
      return { ...created };
    },
    set_social_post_inflight: (args) => {
      const row = find(args["p_id"]);
      const marker = args["p_marker"];
      if (row?.status !== "scheduled") return marker === undefined;
      if (marker === undefined) {
        row.error = null;
        return true;
      }
      if (row.error !== null && MARKER.test(row.error)) return false;
      row.error = text(marker);
      return true;
    },
    mark_social_post_posted: (args) => {
      const row = find(args["p_id"]);
      if (row?.status !== "scheduled") return null;
      Object.assign(row, {
        status: "posted",
        posted_at: POSTED_AT,
        remote_id: text(args["p_remote_id"]),
        permalink: text(args["p_permalink"]),
        error: null,
      });
      return POSTED_AT;
    },
    fail_social_post: (args) => {
      const row = find(args["p_id"]);
      if (row?.status !== "scheduled") return false;
      Object.assign(row, { status: "failed", error: text(args["p_error"]) });
      return true;
    },
    reschedule_social_post: (args) => {
      const row = find(args["p_id"]);
      if (row === undefined) return false;
      row.scheduled_at = text(args["p_scheduled_at"]);
      audit.push({
        action: "channels.reschedule",
        entity_id: args["p_id"],
        note: args["p_note"],
        actor_id: null,
      });
      return true;
    },
    enqueue_job: (args) => {
      const key = text(args["p_idempotency_key"]);
      if (jobs.some((job) => job.key === key)) return null;
      jobs.push({
        type: text(args["p_type"]),
        key,
        payload: args["p_payload"],
        runAfter: args["p_run_after"],
      });
      return JOB;
    },
    get_vault_secret: () => "",
    record_channel_usage: () => 1,
    ...options.handlers,
  });
  return { db, posts, audit, jobs, tables };
}
