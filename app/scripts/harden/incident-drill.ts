// `bun run scripts/harden/incident-drill.ts --env dev --base <dev>` (H1-39, GS-05), with the dev profile loaded, against a
// Worker that serves the one database. It acts as the operator with the database role (the admin routes of these switches
// need a person with a recent sign-in, so the game day walks the screens) and flips the three switches of
// `docs/runbooks/incident.md` and back: (1) `coming_soon_global`, to the opposite of the value it reads, until `<base>/api/public/markets`
// shows or drops `comingSoon` on every market, then restored and polled again; (2) the `instagram` row of `channel_settings` off,
// with one approved carousel asset and one `post_meta` job, which must end `done` as `skipped_disabled` with no `social_posts`
// row; (3) a throwaway agent key that answers `200` and, once `revoked_at` is set, `401`, and is then deleted. Each switch must take under 60
// seconds and every restored row is read again. It commits rows to the one database, so it refuses production first
// (ruling H35 (5)), holds the writer lock (G34) and removes its asset and jobs by H1's cleanup rule.
// Prints `incident drill ok` with the elapsed seconds, or the failing check and exit 1.
import { z } from "zod";
import { assertNotProduction } from "../lib/assert-not-production.mjs";
import {
  askRunner,
  deleteAgentKey,
  drillBase,
  enqueue,
  idsOf,
  insertAgentKey,
  meStatus,
  revokeAgentKey,
  waitForDone,
} from "./drill-lib.ts";
import { openProbeDb, type ProbeDb } from "./probe-db.ts";

// One channel in `params.channels` answers the bare status; the `from_settings` form answers one per channel.
const skippedDisabled = z.union([
  z.literal("skipped_disabled"),
  z.object({ instagram: z.literal("skipped_disabled") }),
]);
const marketsBody = z.array(z.object({ comingSoon: z.boolean() }));
const PAGE_WAIT_MS = 30_000;
const SWITCH_LIMIT_S = 60;
const POLL_MS = 1000;

interface State {
  comingSoon: string;
  instagram: string;
}

/** What a switch printed and its slowest step in seconds. */
interface Timed {
  shown: string;
  longest: number;
}

const seconds = (since: number) => (Date.now() - since) / 1000;

async function first(db: ProbeDb, text: string, params: unknown[] = []): Promise<string> {
  const value = (await db.rows(text, params))[0]?.["v"];
  if (value === null || value === undefined) throw new Error(`incident drill: no row for ${text}`);
  return value;
}

const readState = async (db: ProbeDb): Promise<State> => ({
  comingSoon: await first(
    db,
    "select value::text as v from public.settings where key = 'coming_soon_global'",
  ),
  instagram: await first(
    db,
    "select enabled::text as v from public.channel_settings where channel = 'instagram'",
  ),
});

const setComingSoon = (db: ProbeDb, value: string) =>
  db.rows("update public.settings set value = $1::jsonb where key = 'coming_soon_global'", [value]);

const setInstagram = (db: ProbeDb, enabled: string) =>
  db.rows("update public.channel_settings set enabled = $1::boolean where channel = 'instagram'", [
    enabled,
  ]);

/** Whether every market of `GET <base>/api/public/markets` is `comingSoon`; an empty list throws, it shows nothing. */
async function allComingSoon(base: string): Promise<boolean> {
  const response = await fetch(`${base}/api/public/markets`, {
    signal: AbortSignal.timeout(20_000),
  });
  const markets = marketsBody.parse(await response.json());
  if (markets.length === 0) throw new Error("incident drill: /api/public/markets lists no market");
  return markets.every((market) => market.comingSoon);
}

/**
 * Seconds until `GET <base>/api/public/markets` shows the global switch (every market `comingSoon`) or its absence, or
 * throws after 30 seconds. The page HTML is not the observable: a preview Worker still renders a property card with the
 * switch on (measured 2026-10-10), while the catalog JSON follows the switch within the state memo.
 */
async function switchShows(base: string, on: boolean): Promise<number> {
  const since = Date.now();
  while (Date.now() - since < PAGE_WAIT_MS) {
    if ((await allComingSoon(base)) === on) return seconds(since);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(
    `incident drill: /api/public/markets does not show the global switch ${on ? "on" : "off"} after 30 seconds (a market with its own coming-soon switch on hides the switch off)`,
  );
}

async function comingSoon(db: ProbeDb, base: string, original: string): Promise<Timed> {
  const flipped = original === "true" ? "false" : "true";
  if (flipped === "true" && (await allComingSoon(base))) {
    throw new Error(
      "incident drill: every market already shows comingSoon with the global switch off, so turning it on cannot be observed",
    );
  }
  await setComingSoon(db, flipped);
  const on = await switchShows(base, flipped === "true");
  await setComingSoon(db, original);
  const back = await switchShows(base, original === "true");
  return {
    shown: `${on.toFixed(1)} s to ${flipped === "true" ? "on" : "off"}, ${back.toFixed(1)} s back`,
    longest: Math.max(on, back),
  };
}

async function channelOff(
  db: ProbeDb,
  original: State,
  run: string,
  jobs: string[],
  assets: string[],
): Promise<Timed> {
  const since = Date.now();
  await setInstagram(db, "false");
  const [property] = await db.rows(
    "select id::text as id, campaign_tier::text as tier, market_slug as market from public.properties where slug = 'oak-hill-residence'",
  );
  if (property?.["id"] === undefined || property["id"] === null) {
    throw new Error("incident drill: the dev property oak-hill-residence is missing");
  }
  const asset = await first(
    db,
    "insert into public.assets (property_id, kind, status, files) values ($1, 'carousel', 'approved', '[]'::jsonb) returning id::text as v",
    [property["id"]],
  );
  assets.push(asset);
  const job = await enqueue(
    db,
    "post_meta",
    {
      params: { channels: ["instagram"] },
      data: {
        asset_id: asset,
        property_id: property["id"],
        kind: "carousel",
        tier: property["tier"],
        market: property["market"],
      },
    },
    `post_meta:h1-drill-${run}`,
  );
  jobs.push(job);
  await askRunner();
  const result = await waitForDone(db, job, "post_meta", "incident drill");
  if (!skippedDisabled.safeParse(result).success) {
    throw new Error(
      `incident drill: the post_meta job answered ${JSON.stringify(result)}, not skipped_disabled`,
    );
  }
  const posts = await first(
    db,
    "select count(*)::text as v from public.social_posts where asset_id = $1",
    [asset],
  );
  if (posts !== "0")
    throw new Error(`incident drill: ${posts} social_posts rows for a disabled channel`);
  await setInstagram(db, original.instagram);
  const elapsed = seconds(since);
  return { shown: `${elapsed.toFixed(1)} s`, longest: elapsed };
}

async function revokedKey(db: ProbeDb, base: string, run: string): Promise<Timed> {
  const since = Date.now();
  const key = await insertAgentKey(db, `h1 incident drill ${run}`);
  try {
    const live = await meStatus(base, key.key);
    if (live !== 200)
      throw new Error(`incident drill: the new key answered ${String(live)}, expected 200`);
    await revokeAgentKey(db, key.id);
    const revoked = await meStatus(base, key.key);
    if (revoked !== 401)
      throw new Error(`incident drill: the revoked key answered ${String(revoked)}, expected 401`);
  } finally {
    await deleteAgentKey(db, key.id);
  }
  const elapsed = seconds(since);
  return { shown: `${elapsed.toFixed(1)} s`, longest: elapsed };
}

async function restore(db: ProbeDb, original: State): Promise<void> {
  await setComingSoon(db, original.comingSoon);
  await setInstagram(db, original.instagram);
}

async function main(): Promise<number> {
  const base = drillBase("incident-drill.ts");
  if (base === null) return 64;
  const dbUrl = process.env["DEV_DB_URL"];
  await assertNotProduction({ dbUrl });
  const db = await openProbeDb(dbUrl ?? "");
  const run = Date.now().toString();
  const jobs: string[] = [];
  const assets: string[] = [];
  let failure: string | null = null;
  let report = "";
  try {
    const original = await readState(db);
    try {
      const times = [
        await comingSoon(db, base, original.comingSoon),
        await channelOff(db, original, run, jobs, assets),
        await revokedKey(db, base, run),
      ];
      report = times.map((time, index) => `switch ${String(index + 1)}: ${time.shown}`).join("; ");
      const slow = times.find((time) => time.longest >= SWITCH_LIMIT_S);
      if (slow !== undefined) {
        throw new Error(
          `incident drill: a switch took ${slow.shown}, limit ${String(SWITCH_LIMIT_S)} s`,
        );
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      await restore(db, original);
    }
    const after = await readState(db);
    if (after.comingSoon !== original.comingSoon || after.instagram !== original.instagram) {
      failure ??= `incident drill: not restored: coming_soon_global ${original.comingSoon} -> ${after.comingSoon}, instagram enabled ${original.instagram} -> ${after.instagram}`;
    }
  } catch (error) {
    failure ??= error instanceof Error ? error.message : String(error);
  }
  try {
    await db.cleanup({
      job_events: await idsOf(
        db,
        "select id::text as id from job_events where job_id::text = any($1::text[])",
        [jobs],
      ),
      jobs,
      assets,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failure = failure === null ? message : `${failure}; ${message}`;
  } finally {
    await db.close();
  }
  if (failure !== null) {
    console.error(failure);
    return 1;
  }
  console.log(`incident drill ok (${report})`);
  return 0;
}

let code: number;
try {
  code = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  code = 1;
}
// An exit, not exitCode: a writer-lock wait that the database cancels leaves its pg client open, and an open client keeps
// the process alive forever (H1-36, H1-38 and H1-39 would never finish under run-all).
process.exit(code);
