import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeContext } from "../../../../workspace/audits/tools/common.mjs";
import { collect, parseGa4 } from "../../../../workspace/audits/tools/ga4.mjs";

function recorded(): unknown {
  return JSON.parse(
    readFileSync(
      new URL("../../../../workspace/audits/tools/fixtures/ga4-report.json", import.meta.url),
      "utf8",
    ),
  );
}

describe("parseGa4", () => {
  it("turns a recorded runReport answer into events and sessions", () => {
    expect(parseGa4(recorded())).toEqual({
      sessions: 620,
      events: [
        { name: "page_view", count: 1840 },
        { name: "session_start", count: 620 },
        { name: "inquiry_submit", count: 7 },
      ],
    });
  });

  it("gives no events for an empty property", () => {
    expect(parseGa4({ rowCount: 0 })).toEqual({ sessions: 0, events: [] });
  });
});

describe("ga4 collect", () => {
  it("records not_measured with the reason and makes no call while a credential is unset", async () => {
    let calls = 0;
    const fetchImpl = () => {
      calls += 1;
      return Promise.resolve(new Response("{}"));
    };
    const noProperty = makeContext({
      env: { GOOGLE_SA_JSON_B64: "x" },
      siteUrl: "https://matterofplace.com",
      fetchImpl,
    });
    expect(await collect(noProperty)).toEqual({ ga4: { notMeasured: "GA4_PROPERTY_ID unset" } });
    expect(await collect(makeContext({ env: {}, fetchImpl }))).toEqual({
      ga4: { notMeasured: "GOOGLE_SA_JSON_B64 unset" },
    });
    expect(calls).toBe(0);
  });
});
