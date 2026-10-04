// The caching proof (architecture 13, S52, F24): a warm public read costs no database call. 1,000 requests through
// `handlePublic` over a counting client make no table read and at most one `public_state` per 15 seconds, and one
// `public_catalog_snapshot` per catalog version. The HTML middleware and the edge store are `edge-cache.spec.ts`'s: no
// HTML is rendered here, a page's loader only calls these same reads.
import "./env";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { setDbForTests } from "../../src/server/lib/db";
import { handlePublic } from "../../src/server/public/pipeline";
import { countingDb } from "../fixtures/db-counter";
import { serviceClient } from "../fixtures/service";

const INTERVAL_MS = 15_000;
const REQUESTS = 1000;
const SEARCHES = 50;
const REQUEST_ID = "r1";

const counted = countingDb(serviceClient());

function call(path: string, init?: RequestInit): Promise<Response> {
  return handlePublic(new Request(`http://localhost${path}`, init), REQUEST_ID, counted);
}

const get = (path: string) => call(`/api/public${path}`);
const search = (text: string) =>
  call("/api/public/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });

function advance(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}

const cards = z.array(z.object({ slug: z.string(), title: z.string() }));
const matches = z.array(z.object({ property: z.object({ slug: z.string() }) }));

async function firstSlug(path: string): Promise<string> {
  return (
    z.array(z.object({ slug: z.string() })).parse(await (await get(path)).json())[0]?.slug ?? ""
  );
}

beforeAll(() => {
  Reflect.deleteProperty(process.env, "CATALOG_VERSION_TTL_MS");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date());
  setDbForTests(counted);
});

afterAll(() => {
  setDbForTests(undefined);
  vi.useRealTimers();
  Reflect.deleteProperty(process.env, "CATALOG_VERSION_TTL_MS");
});

describe("what a warm read costs the database", () => {
  it("makes no table read and a bounded number of RPCs for 1,000 requests", async () => {
    counted.reset();
    const started = Date.now();
    const property = await firstSlug("/properties");
    const market = await firstSlug("/markets");
    const story = await firstSlug("/stories");
    const term = cards.parse(await (await get("/properties")).json())[0]?.title ?? "";
    const routes = [
      "/properties",
      `/properties/${property}`,
      "/markets",
      `/markets/${market}`,
      "/stories",
      `/stories/${story}`,
    ];
    const every = REQUESTS / SEARCHES;
    for (let sent = 0; sent < REQUESTS; sent += 1) {
      const response =
        sent % every === every - 1
          ? await search(term)
          : await get(routes[sent % routes.length] ?? "");
      expect(response.status, `request ${String(sent)}`).toBe(200);
      expect(response.headers.get("x-catalog-version"), `request ${String(sent)}`).not.toBeNull();
      if (sent % 50 === 49) advance(1000);
    }
    const elapsedSeconds = (Date.now() - started) / 1000;
    const stateBound = Math.ceil(elapsedSeconds / (INTERVAL_MS / 1000)) + 1;
    expect(counted.counts.from).toEqual({});
    expect(Object.keys(counted.counts.rpc).sort()).toEqual([
      "public_catalog_snapshot",
      "public_state",
    ]);
    expect(counted.counts.rpc["public_catalog_snapshot"]).toBe(1);
    expect(counted.counts.rpc["public_state"]).toBeLessThanOrEqual(stateBound);
    process.stdout.write(
      `from 0, public_state <= ${String(stateBound)} (${String(counted.counts.rpc["public_state"])}), public_catalog_snapshot 1, for ${String(REQUESTS)} requests\n`,
    );
  });

  it("costs one snapshot and at most one state check after the version moves", async () => {
    const before = { ...counted.counts.rpc };
    const bumped = await serviceClient().rpc("bump_catalog_version");
    expect(bumped.error).toBeNull();
    advance(INTERVAL_MS);
    expect((await get("/properties")).status).toBe(200);
    expect(counted.counts.rpc["public_catalog_snapshot"]).toBe(
      (before["public_catalog_snapshot"] ?? 0) + 1,
    );
    expect(counted.counts.rpc["public_state"]).toBeLessThanOrEqual(
      (before["public_state"] ?? 0) + 1,
    );
  });

  it("finds the first property by a word of its title, by the plural and by a three-letter prefix, without a call", async () => {
    const [first] = cards.parse(await (await get("/properties")).json());
    const word =
      first?.title
        .split(/[^A-Za-z]+/)
        .reduce((longest, next) => (next.length > longest.length ? next : longest), "") ?? "";
    expect(word.length).toBeGreaterThanOrEqual(5);
    counted.reset();
    const firsts: string[] = [];
    for (const text of [word, `${word}s`, word.slice(0, 3)]) {
      const found = matches.parse(await (await search(text)).json());
      firsts.push(found[0]?.property.slug ?? "");
    }
    expect(firsts).toEqual([first?.slug, first?.slug, first?.slug]);
    expect(counted.counts.total).toBe(0);
  });
});

describe("writes and hooks are never cached (rule 6)", () => {
  it("answers a malformed inquiry 400 bad_request with no-store and no database call", async () => {
    counted.reset();
    const response = await call("/api/public/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(
      z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code,
    ).toBe("bad_request");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(counted.counts.total).toBe(0);
  });

  it("answers an unsigned Resend hook with no-store, whatever its status", async () => {
    const response = await call("/api/hooks/resend", { method: "POST", body: "{}" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  const adminExists = existsSync("src/routes/api/admin/me.ts");
  if (!adminExists) process.stdout.write("skipped: B7 not landed (src/routes/api/admin/me.ts)\n");
  (adminExists ? it : it.skip)("answers GET /api/admin/me with no-store", async () => {
    const response = await call("/api/admin/me");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("a database call is visible to the counter", () => {
  it("moves on every request when the interval is 0", async () => {
    process.env["CATALOG_VERSION_TTL_MS"] = "0";
    counted.reset();
    for (let sent = 0; sent < 5; sent += 1) {
      const before = counted.counts.total;
      await get("/properties");
      expect(counted.counts.total, `request ${String(sent)}`).toBeGreaterThan(before);
    }
  });
});
