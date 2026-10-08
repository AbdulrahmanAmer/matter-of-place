import type { Json } from "../../src/db";
import type { NewsletterBlock } from "../../src/domain/newsletter";
import { resetPublicStateMemo } from "../../src/server/public/state";
import { filteredFrom } from "./email-send";
import type { FakeCall, FakeDb } from "./fake-db";
import { stateJson } from "./snapshot";

// The database of the Place Notes assembly (B11 step 3): tables that answer their filters as Postgres would, and the
// two SQL functions of step 4 as handlers the test registers. They are not in the generated types yet, so the one
// client cast of `fakeDb` (CS-12) is repeated here for the same reason.

export type Row = Record<string, unknown>;
export type Handler = (args: Record<string, unknown>) => unknown;

export const uuid = (n: number): string => `5e1f0a00-0000-4000-8000-${String(n).padStart(12, "0")}`;

export interface IssueOptions {
  id?: string;
  number?: number;
  status?: "draft" | "approved" | "sending" | "sent";
  blocks?: unknown[];
  subject?: string | null;
  preheader?: string | null;
  sent_at?: string | null;
}

export const issueRow = (options: IssueOptions = {}): Row => ({
  id: uuid(900),
  number: 1,
  status: "draft",
  blocks: [],
  subject: null,
  preheader: null,
  sent_at: null,
  ...options,
});

export const propertyBlock = (
  property: number,
  title = "Oak Hill",
  deck = "A quiet street.",
): Extract<NewsletterBlock, { type: "property" }> => ({
  id: `property:${uuid(property)}`,
  type: "property",
  property_id: uuid(property),
  asset_id: uuid(property + 100),
  title,
  deck,
});

export const storyBlock = (
  story: number,
  title = "Under the oaks",
  deck = "A walk.",
): Extract<NewsletterBlock, { type: "story" }> => ({
  id: `story:${uuid(story)}`,
  type: "story",
  story_id: uuid(story),
  title,
  deck,
});

export const propertyRow = (property: number, options: Row = {}): Row => ({
  id: uuid(property),
  published_at: "2026-10-03T09:00:00.000Z",
  campaign_tier: "Editorial",
  editorial_state: "published",
  taken_down_at: null,
  ...options,
});

export const assetRow = (property: number, revision: number, options: Row = {}): Row => ({
  id: uuid(property * 10 + revision),
  property_id: uuid(property),
  revision,
  kind: "newsletter_block",
  status: "approved",
  approved_at: "2026-10-03T10:00:00.000Z",
  meta: {
    block: {
      title: `Property ${String(property)} revision ${String(revision)}`,
      deck: "A quiet street.",
    },
  },
  ...options,
});

export const storyRow = (story: number, options: Row = {}): Row => ({
  id: uuid(story),
  title: "Under the oaks",
  deck: "A walk.",
  editorial_state: "published",
  archived_at: null,
  published_at: "2026-10-02T09:00:00.000Z",
  ...options,
});

/**
 * `calls` holds every `from` and `rpc` made, in order; an `rpc` the test did not register throws, except
 * `public_state`: the identity lines of an email are read from the shared public state (B16), which this world
 * answers with the `settings` row `site` when the tables hold one. That state is memoised per isolate, so a new
 * world starts without the last one's.
 */
export function newsletterDb(tables: Record<string, Row[]>, rpc: Record<string, Handler> = {}) {
  resetPublicStateMemo();
  const site = tables["settings"]?.find((row) => row["key"] === "site")?.["value"];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a settings row is JSON by construction
  const state: Handler = () => stateJson(7, { site: (site ?? null) as Json });
  const handlers: Record<string, Handler> = { public_state: state, ...rpc };
  const calls: FakeCall[] = [];
  const from = filteredFrom(
    { newsletter_issues: [], assets: [], properties: [], stories: [], ...tables },
    calls,
  );
  const call = (name: string, args: Record<string, unknown>) => {
    calls.push({ kind: "rpc", name, args: [args] });
    const handler = handlers[name];
    if (handler === undefined) throw new Error(`unexpected rpc ${name}`);
    const answer = handler(args);
    return Promise.resolve(
      answer instanceof Error
        ? { data: null, error: { code: "XX000" } }
        : { data: answer, error: null },
    );
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the one cast of the fake client (CS-12)
  const db = { from, rpc: call, calls } as unknown as FakeDb;
  return {
    db,
    calls,
    rpcCalls: (name: string) => calls.filter((c) => c.kind === "rpc" && c.name === name),
  };
}
