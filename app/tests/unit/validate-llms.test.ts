// scripts/validate-llms.ts (B13 step 13): the checks, run on what the real builders write and on documents broken in one place.
import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { validateLlms } from "../../scripts/validate-llms.ts";
import { applyVisibility } from "../../src/server/catalog/visibility";
import { mapSnapshot, parseSnapshot, toPropertyCard } from "../../src/server/public/mappers";
import type { PublicState } from "../../src/server/public/state";
import { buildLlmsFull, buildLlmsTxt, MAX_BYTES } from "../../src/server/seo/llms";
import { propertyJson, snapshotJson } from "../fixtures/snapshot";

const state: PublicState = {
  catalogVersion: 7,
  flags: {},
  comingSoonGlobal: false,
  comingSoonMarkets: {},
  site: {},
  illustrativeContent: false,
  ogStatic: {},
};

function built(
  build: typeof buildLlmsTxt,
  properties: ReturnType<typeof propertyJson>[],
  maxBytes?: number,
): string {
  const mapped = mapSnapshot(parseSnapshot(snapshotJson(7, { properties })), state);
  const visible = applyVisibility(mapped, { state, env: { MOP_ENV: "production" } });
  return build({ ...visible, cards: visible.properties.map(toPropertyCard) }, state, maxBytes);
}

describe.each([
  ["llms.txt", buildLlmsTxt],
  ["llms-full.txt", buildLlmsFull],
])("%s as the builder writes it", (_name, build) => {
  it("has no problem with a property listed", () => {
    expect(validateLlms(built(build, [propertyJson("p1")]))).toEqual([]);
  });

  it("has no problem with nothing published", () => {
    expect(validateLlms(built(build, []))).toEqual([]);
  });

  it("has no problem when the list is cut at the size cap", () => {
    const text = built(build, [propertyJson("p1"), propertyJson("p2")], 700);
    expect(text).toContain("List truncated:");
    expect(validateLlms(text)).toEqual([]);
  });
});

describe("a document broken in one place", () => {
  const sample = built(buildLlmsTxt, [propertyJson("p1")]);
  const replaced = (find: string, replace: string): string => {
    expect(sample).toContain(find);
    return sample.replace(find, replace);
  };

  it("reports a first line that is not a heading", () => {
    expect(validateLlms(replaced("# Matter of Place", "Matter of Place"))).toEqual([
      "line 1: the first line is not a level-one heading: Matter of Place",
    ]);
  });

  it("reports a missing blockquote summary", () => {
    expect(validateLlms(replaced("\n> ", "\n"))).toEqual([
      expect.stringMatching(/^line 3: no blockquote summary/),
    ]);
  });

  it("reports a relative link with its line", () => {
    const problems = validateLlms(replaced("https://matterofplace.com/about", "/about"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^line \d+: link is not an absolute https address \(\/about\)/);
  });

  it("reports an http link", () => {
    const problems = validateLlms(
      replaced("https://matterofplace.com/faq", "http://matterofplace.com/faq"),
    );
    expect(problems).toEqual([expect.stringMatching(/not an absolute https address/)]);
  });

  it("reads an escaped bracket as text, not as a link", () => {
    expect(validateLlms(`${sample}\nA note with \\[a\\](/relative) in it.\n`)).toEqual([]);
  });

  it("reports a list entry with no link", () => {
    expect(validateLlms(`${sample.trimEnd()}\n- a line with no link\n`)).toEqual([
      expect.stringMatching(/an entry without a link/),
    ]);
  });

  it("reads a dash at the start of an editorial paragraph as text", () => {
    const base = propertyJson("p1");
    if (typeof base !== "object" || base === null || Array.isArray(base)) {
      throw new Error("propertyJson returned a value that is not an object");
    }
    const text = built(buildLlmsFull, [{ ...base, story: ["- three acres of oak."] }]);
    expect(text).toContain("\n- three acres of oak.");
    expect(validateLlms(text)).toEqual([]);
  });

  it("takes the size cap of the builder: its last byte passes and the next one does not", () => {
    const room = MAX_BYTES - new TextEncoder().encode(sample).length;
    expect(validateLlms(`${sample}${"a".repeat(room - 1)}\n`)).toEqual([]);
    expect(validateLlms(`${sample}${"a".repeat(room)}\n`)).toEqual([
      expect.stringMatching(/the document is over \d+ bytes/),
    ]);
  });

  it("reports a truncation line that is not last", () => {
    const problems = validateLlms(
      `${sample.trimEnd()}\n\nList truncated: 2 more entries. Every page is listed at https://matterofplace.com/sitemap.xml.\n\n- [x](https://matterofplace.com/x)\n`,
    );
    expect(problems).toEqual([expect.stringMatching(/not the last line/)]);
  });

  it("reports a truncation line in the wrong form", () => {
    const problems = validateLlms(`${sample.trimEnd()}\n\nList truncated: some.\n`);
    expect(problems).toEqual([expect.stringMatching(/the truncation line is malformed/)]);
  });

  it("reports a missing final line break", () => {
    expect(validateLlms(sample.trimEnd())).toEqual([expect.stringMatching(/no final line break/)]);
  });

  it("reports a document with no section", () => {
    expect(validateLlms("# Matter of Place\n\n> A summary.\n")).toEqual([
      expect.stringMatching(/^line 1: no section/),
      expect.stringMatching(/no Properties section and no truncation line/),
    ]);
  });

  it("reports the zero-property sentence beside a listed property", () => {
    const problems = validateLlms(
      replaced("## Properties\n", "## Properties\n\nNo properties are published yet.\n"),
    );
    expect(problems).toEqual([expect.stringMatching(/sentence beside a listed property/)]);
  });

  it("reports a Properties section with neither a property nor the sentence", () => {
    const empty = built(buildLlmsTxt, []);
    const problems = validateLlms(empty.replace("No properties are published yet.", "Soon."));
    expect(problems).toEqual([expect.stringMatching(/no property and no zero-property sentence/)]);
  });
});
