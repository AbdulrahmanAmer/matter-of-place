import { createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeContext } from "../../../../workspace/audits/tools/common.mjs";
import {
  BRAND_QUERIES,
  brandRows,
  collect,
  keywordCoverage,
  parseGsc,
  withPreviousBrand,
} from "../../../../workspace/audits/tools/gsc.mjs";

const NOW = new Date("2026-10-03T00:00:00Z");

function recorded(name = "gsc-query"): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../../workspace/audits/tools/fixtures/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

/** A service account key made for this test only; nothing of it is committed. */
function account() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = {
    client_email: "audit@example.iam.gserviceaccount.test",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  return { publicKey, b64: Buffer.from(JSON.stringify(key)).toString("base64") };
}

describe("parseGsc", () => {
  it("turns a recorded searchAnalytics answer into query rows", () => {
    expect(parseGsc(recorded())[0]).toEqual({
      query: "architect designed home california",
      impressions: 120,
      clicks: 4,
      position: 8.2,
    });
    expect(parseGsc(recorded())).toHaveLength(4);
  });
});

describe("keywordCoverage", () => {
  it("counts a term covered by a case-folded query with an impression: two of three", () => {
    expect(
      keywordCoverage(parseGsc(recorded()), [
        "architect designed home",
        "palm beach",
        "brownstone",
      ]),
    ).toEqual({ covered: 2, total: 3, missing: ["brownstone"] });
  });
});

describe("brandRows (W8 item 12c)", () => {
  it("tracks exactly the two brand queries", () => {
    expect(BRAND_QUERIES).toEqual(["matter of place", "matter of place real estate"]);
  });

  it("reads the position, impressions and clicks of each tracked query, and no other query", () => {
    expect(brandRows(parseGsc(recorded("gsc-brand"))).at(0)).toEqual({
      name: "matter of place",
      status: "ranked",
      impressions: 9,
      clicks: 0,
      position: 8.33,
    });
    expect(brandRows(parseGsc(recorded("gsc-brand")))).toHaveLength(2);
  });

  it("writes a query with no impression as no impressions, never as position 0", () => {
    const [, second] = brandRows(parseGsc(recorded("gsc-brand")));
    expect(second).toEqual({
      name: "matter of place real estate",
      status: "no impressions",
      impressions: 0,
      clicks: 0,
    });
    expect(second).not.toHaveProperty("position");
  });

  it("writes a query Search Console did not return as no impressions", () => {
    expect(brandRows([]).map((row) => row.status)).toEqual(["no impressions", "no impressions"]);
  });

  it("matches the query whatever its case, and not a longer query that contains it", () => {
    const rows = parseGsc({
      rows: [
        { keys: ["Matter Of Place"], impressions: 3, clicks: 1, position: 2 },
        { keys: ["matter of place real estate agents"], impressions: 5, clicks: 0, position: 4 },
      ],
    });
    expect(brandRows(rows).map(({ name, status }) => [name, status])).toEqual([
      ["matter of place", "ranked"],
      ["matter of place real estate", "no impressions"],
    ]);
  });
});

describe("withPreviousBrand", () => {
  const now = {
    window_days: 28,
    queries: brandRows(parseGsc(recorded("gsc-brand"))),
  };

  it("puts last run's numbers beside this run's, a query with none as no impressions", () => {
    const last = {
      brand_queries: {
        window_days: 28,
        queries: [
          { name: "matter of place", status: "ranked", impressions: 7, clicks: 0, position: 9.1 },
          {
            name: "matter of place real estate",
            status: "no impressions",
            impressions: 0,
            clicks: 0,
          },
        ],
      },
    };
    const [first, second] = withPreviousBrand(now, last).queries;
    expect(first?.previous).toEqual({ status: "ranked", impressions: 7, clicks: 0, position: 9.1 });
    expect(second?.previous).toEqual({ status: "no impressions", impressions: 0, clicks: 0 });
  });

  it("gives previous null when there is no earlier sidecar or it held no brand numbers", () => {
    expect(withPreviousBrand(now, null).queries.map((row) => row.previous)).toEqual([null, null]);
    expect(withPreviousBrand(now, { gsc: {} }).queries.map((row) => row.previous)).toEqual([
      null,
      null,
    ]);
  });
});

describe("gsc collect", () => {
  it("records both keys under not_measured while the credential is unset, with no call", async () => {
    let calls = 0;
    const ctx = makeContext({
      env: {},
      siteUrl: "https://matterofplace.com",
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(new Response("{}"));
      },
    });
    expect(await collect(ctx)).toEqual({
      gsc: { notMeasured: "GOOGLE_SA_JSON_B64 unset" },
      keywords: { notMeasured: "GOOGLE_SA_JSON_B64 unset" },
      brand_queries: { notMeasured: "GOOGLE_SA_JSON_B64 unset" },
    });
    expect(calls).toBe(0);
  });

  it("signs the token request with the service account key and writes keywords", async () => {
    const { publicKey, b64 } = account();
    const requests: { url: string; body: string }[] = [];
    const ctx = makeContext({
      env: { GOOGLE_SA_JSON_B64: b64 },
      siteUrl: "https://matterofplace.com",
      now: () => NOW,
      fetchImpl: (url, init) => {
        requests.push({ url, body: typeof init?.body === "string" ? init.body : "" });
        return Promise.resolve(
          url.startsWith("https://oauth2.googleapis.com/token")
            ? Response.json({ access_token: "access-token-for-test" })
            : Response.json(recorded()),
        );
      },
    });
    const collected = await collect(ctx);
    const assertion = new URLSearchParams(requests[0]?.body).get("assertion") ?? "";
    const [header = "", claims = "", signature = ""] = assertion.split(".");
    const verifier = createVerify("RSA-SHA256").update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(requests[1]?.url).toBe(
      "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Amatterofplace.com/searchAnalytics/query",
    );
    expect(requests[1]?.body).toContain('"startDate":"2026-09-03"');
    // workspace/audits/keywords.json: 24 terms, then 9 owned on the operator's search assignment (H112).
    expect(collected["keywords"]).toMatchObject({ value: { total: 33, window_days: 28 } });
    expect(collected["gsc"]).toMatchObject({ value: { queries: 4, impressions: 225, clicks: 11 } });
  });

  it("records not_measured for a refused answer, never a throw", async () => {
    const ctx = makeContext({
      env: { GOOGLE_SA_JSON_B64: account().b64 },
      siteUrl: "https://matterofplace.com",
      now: () => NOW,
      fetchImpl: (url) =>
        Promise.resolve(
          url.startsWith("https://oauth2.googleapis.com/token")
            ? Response.json({ access_token: "access-token-for-test" })
            : new Response("{}", { status: 403 }),
        ),
    });
    expect(await collect(ctx)).toEqual({
      gsc: { notMeasured: "Search Console HTTP 403" },
      keywords: { notMeasured: "Search Console HTTP 403" },
      brand_queries: { notMeasured: "Search Console HTTP 403" },
    });
  });

  it("records the brand queries from the answer: a position for one, no impressions for the other", async () => {
    const { b64 } = account();
    const ctx = makeContext({
      env: { GOOGLE_SA_JSON_B64: b64 },
      siteUrl: "https://matterofplace.com",
      now: () => NOW,
      fetchImpl: (url) =>
        Promise.resolve(
          url.startsWith("https://oauth2.googleapis.com/token")
            ? Response.json({ access_token: "access-token-for-test" })
            : Response.json(recorded("gsc-brand")),
        ),
    });
    const collected = await collect(ctx);
    expect(collected["brand_queries"]).toEqual({
      value: {
        window_days: 28,
        queries: [
          { name: "matter of place", status: "ranked", impressions: 9, clicks: 0, position: 8.33 },
          {
            name: "matter of place real estate",
            status: "no impressions",
            impressions: 0,
            clicks: 0,
          },
        ],
      },
    });
  });

  it("records no impressions for both brand queries when the answer has no rows, and nothing else as measured", async () => {
    const { b64 } = account();
    const ctx = makeContext({
      env: { GOOGLE_SA_JSON_B64: b64 },
      siteUrl: "https://matterofplace.com",
      now: () => NOW,
      fetchImpl: (url) =>
        Promise.resolve(
          url.startsWith("https://oauth2.googleapis.com/token")
            ? Response.json({ access_token: "access-token-for-test" })
            : Response.json({}),
        ),
    });
    const collected = await collect(ctx);
    expect(collected["gsc"]).toHaveProperty("notMeasured");
    expect(collected["keywords"]).toHaveProperty("notMeasured");
    expect(collected["brand_queries"]).toMatchObject({
      value: { queries: [{ status: "no impressions" }, { status: "no impressions" }] },
    });
  });
});
