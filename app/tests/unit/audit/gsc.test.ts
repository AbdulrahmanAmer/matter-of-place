import { createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeContext } from "../../../../workspace/audits/tools/common.mjs";
import { collect, keywordCoverage, parseGsc } from "../../../../workspace/audits/tools/gsc.mjs";

const NOW = new Date("2026-10-03T00:00:00Z");

function recorded(): unknown {
  return JSON.parse(
    readFileSync(
      new URL("../../../../workspace/audits/tools/fixtures/gsc-query.json", import.meta.url),
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
    expect(collected["keywords"]).toMatchObject({ value: { total: 24, window_days: 28 } });
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
    });
  });
});
