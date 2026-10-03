import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeContext } from "../../../../workspace/audits/tools/common.mjs";
import { classifyCrawl, collect, parseRows } from "../../../../workspace/audits/tools/crawl.mjs";

const DEV_HOST = "matter-of-place-dev.holy-meadow-4327.workers.dev";

function recordedOutput(): string {
  const parsed: unknown = JSON.parse(
    readFileSync(
      new URL("../../../../workspace/audits/tools/fixtures/crawl-seo.json", import.meta.url),
      "utf8",
    ),
  );
  return typeof parsed === "object" && parsed !== null && "output" in parsed
    ? String(parsed.output)
    : "";
}

describe("parseRows", () => {
  it("reads ok, skip and fail lines, and ignores the echo of the command", () => {
    expect(
      parseRows(recordedOutput(), 1, "check-seo").map((row) => [row.status, row.check]),
    ).toEqual([
      ["ok", "sitemap reachable"],
      ["ok", "title unique /"],
      [
        "fail",
        "x-robots-tag noindex, nofollow on https://matter-of-place-dev.holy-meadow-4327.workers.dev/",
      ],
      ["fail", "robots.txt disallows all"],
      ["fail", "description length /faq"],
    ]);
  });

  it("turns a non-zero exit with no fail line into a failed row", () => {
    expect(parseRows("ok one\n", 1, "validate-llms")).toEqual([
      { check: "one", status: "ok", detail: "" },
      { check: "validate-llms exited 1", status: "fail", detail: "" },
    ]);
  });
});

describe("classifyCrawl", () => {
  const rows = parseRows(recordedOutput(), 1, "check-seo");

  it("moves the indexability rows of a workers.dev host to not_measured, G19", () => {
    const result = classifyCrawl(rows, DEV_HOST);
    expect(result.notMeasured).toEqual([
      { check: "sitemap reachable", reason: "non-production host, G19" },
      {
        check:
          "x-robots-tag noindex, nofollow on https://matter-of-place-dev.holy-meadow-4327.workers.dev/",
        reason: "non-production host, G19",
      },
      { check: "robots.txt disallows all", reason: "non-production host, G19" },
    ]);
    expect(result.rows.map((row) => row.check)).toEqual([
      "title unique /",
      "description length /faq",
    ]);
  });

  it("keeps the noindex row as a red row on matterofplace.com", () => {
    const result = classifyCrawl(rows, "matterofplace.com");
    expect(result.notMeasured).toEqual([]);
    expect(result.rows.filter((row) => row.status === "fail")).toHaveLength(3);
  });
});

describe("crawl collect", () => {
  it("folds the three checkers into seo and aeo and notes the moved rows", async () => {
    const outputs: Record<string, { status: number; stdout: string }> = {
      "scripts/check-seo.ts": { status: 1, stdout: recordedOutput() },
      "scripts/validate-jsonld.ts": {
        status: 1,
        stdout: "ok https://x.test/ Organization\nfail https://x.test/faq missing mainEntity",
      },
      "scripts/validate-llms.ts": { status: 0, stdout: "ok llms.txt" },
    };
    const ctx = makeContext({
      env: {},
      siteUrl: `https://${DEV_HOST}`,
      run: (_command, args) => outputs[args[1] ?? ""] ?? { status: 1, stdout: "" },
      fetchImpl: (url) =>
        Promise.resolve(
          url.endsWith("/llms.txt")
            ? new Response("# llms")
            : new Response('<html><head><link rel="alternate" href="/llms.txt"></head></html>'),
        ),
    });
    expect(await collect(ctx)).toEqual({
      seo: { value: { checks: 2, failed: ["description length /faq"] } },
      aeo: {
        value: {
          jsonld_checked: 1,
          jsonld_failed: ["/faq"],
          llms_present: true,
          llms_ok: true,
          llms_linked: true,
        },
      },
      seo_indexability: { notMeasured: "non-production host, G19" },
    });
  });
});
