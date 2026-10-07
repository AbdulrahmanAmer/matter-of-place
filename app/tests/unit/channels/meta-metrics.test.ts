import { describe, expect, it } from "vitest";
import { META_METRICS, normaliseMetaInsights } from "../../../src/server/channels/meta-metrics.ts";
import insights from "../../fixtures/graph/media-insights.json";

// The one table of Meta metric names (B10 Outputs). The fixture is Meta's documented insights answer, not yet a
// recording of a live post (docs/runbooks/meta.md, "Insights").

// The names Meta's IG Media Insights page lists for new media (read 2026-10-07); `impressions` is treated as
// deprecated there and `plays` is not on the page.
const DOCUMENTED = new Set([
  "views",
  "reach",
  "likes",
  "comments",
  "shares",
  "saved",
  "total_interactions",
  "reposts",
  "follows",
  "profile_visits",
  "profile_activity",
  "navigation",
  "replies",
]);
const fetchedAt = new Date("2026-10-07T12:00:00Z");

describe("normaliseMetaInsights", () => {
  it("maps every table name in the recorded fixture to its field and keeps the answer in raw", () => {
    const names = insights.response.data
      .map((item) => item.name)
      .filter((name) => name in META_METRICS);
    expect(names).toEqual(["reach", "likes"]);
    expect(normaliseMetaInsights(insights.response, fetchedAt)).toEqual({
      reach: 4,
      views: null,
      saves: null,
      shares: null,
      likes: 2,
      comments: null,
      clicks: null,
      fetched_at: "2026-10-07T12:00:00.000Z",
      raw: insights.response,
    });
  });

  it("puts an unknown name only in raw", () => {
    const answer = {
      data: [
        { name: "saved", values: [{ value: 5 }] },
        { name: "brand_new_metric", values: [{ value: 9 }] },
      ],
    };
    const metrics = normaliseMetaInsights(answer, fetchedAt);
    expect(metrics.saves).toBe(5);
    expect(Object.values(metrics)).not.toContain(9);
    expect(metrics.raw).toBe(answer);
  });

  it("holds only names Meta documents for new media", () => {
    expect(Object.keys(META_METRICS).filter((name) => !DOCUMENTED.has(name))).toEqual([]);
  });
});
