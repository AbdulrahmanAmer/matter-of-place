import "../../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bumpCatalogVersion } from "../../../src/server/jobs/steps/bump-catalog-version";
import { getStep } from "../../../src/server/jobs/steps/index";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { context, PROPERTY_ID } from "../../fixtures/asset-rows";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";

// Whether B11's `market_open_notice` system job is registered; any other type falls through to B8's real registry.
const noticeRegistered = vi.hoisted(() => ({ value: false }));

vi.mock(import("../../../src/server/jobs/system/index.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getSystemJob: (type: string) =>
      type === "market_open_notice" && noticeRegistered.value
        ? actual.getSystemJob("prune")
        : actual.getSystemJob(type),
  };
});

type OpenArgs = { p_property_id: string; p_notify?: boolean };

interface Setup {
  db: FakeDb;
  opened: OpenArgs[];
}

/** `open` is what `open_market_on_publish` answers: a slug, or the SQL null of a market that did not change. */
function setup(open: string | null | Error = "california"): Setup {
  const opened: OpenArgs[] = [];
  const db = fakeDb({
    rpc: {
      open_market_on_publish: (args) => {
        opened.push(args);
        // The generated type says string; the SQL function returns null when nothing opened.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- null is what the database sends here
        return open === null ? JSON.parse("null") : open;
      },
      bump_catalog_version: () => 8,
    },
  });
  return { db, opened };
}

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  noticeRegistered.value = false;
  const capture = (line: string) => {
    lines.push(line);
  };
  vi.spyOn(console, "log").mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const run = (
  db: FakeDb,
  params: { flip_coming_soon: boolean },
  data = { property_id: PROPERTY_ID },
) => bumpCatalogVersion.run(context(db, "bump_catalog_version"), params, data);

const rpcNames = (db: FakeDb) => db.calls.map((call) => `${call.kind}:${call.name}`);

describe("bump_catalog_version step", () => {
  it("is in the registry", () => {
    expect(getStep("bump_catalog_version")).toBe(bumpCatalogVersion);
  });

  it("with flip_coming_soon opens the market, then bumps, and never reads settings", async () => {
    const { db } = setup();
    await run(db, { flip_coming_soon: true });
    expect(rpcNames(db)).toEqual(["rpc:open_market_on_publish", "rpc:bump_catalog_version"]);
  });

  it("with flip_coming_soon false only bumps", async () => {
    const { db } = setup();
    const result = await run(db, { flip_coming_soon: false });
    expect(rpcNames(db)).toEqual(["rpc:bump_catalog_version"]);
    expect(result).toEqual({ status: "done", result: { markets_opened: [] } });
  });

  it("asks for the notice only when market_open_notice is registered", async () => {
    noticeRegistered.value = true;
    const withNotice = setup();
    await run(withNotice.db, { flip_coming_soon: true });
    noticeRegistered.value = false;
    const without = setup();
    await run(without.db, { flip_coming_soon: true });
    expect([withNotice.opened[0]?.p_notify, without.opened[0]?.p_notify]).toEqual([true, false]);
    const logged = lines.map((line) => JSON.parse(line) as unknown);
    expect(logged).toEqual([
      {
        level: "info",
        event: "market_open_notice_not_implemented",
        slug: "california",
      },
    ]);
  });

  it("answers the slug the function returned, and none when the market did not change", async () => {
    const opened = await run(setup("california").db, { flip_coming_soon: true });
    const unchanged = await run(setup(null).db, { flip_coming_soon: true });
    expect(opened).toEqual({ status: "done", result: { markets_opened: ["california"] } });
    expect(unchanged).toEqual({ status: "done", result: { markets_opened: [] } });
  });

  it("throws an rpc error so the runner's backoff retries", async () => {
    await expect(run(setup(new Error("down")).db, { flip_coming_soon: true })).rejects.toThrow(
      "open_market_on_publish_failed",
    );
  });

  it("refuses a flip with no property_id as a dead job", async () => {
    await expect(
      bumpCatalogVersion.run(
        context(setup().db, "bump_catalog_version"),
        { flip_coming_soon: true },
        {},
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});
