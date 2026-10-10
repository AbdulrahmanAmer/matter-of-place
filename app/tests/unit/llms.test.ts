import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import type { Json } from "../../src/db";
import { applyVisibility } from "../../src/server/catalog/visibility";
import { mapSnapshot, parseSnapshot, toPropertyCard } from "../../src/server/public/mappers";
import type { PublicState, ServedCatalog } from "../../src/server/public/state";
import {
  buildLlmsFull,
  buildLlmsTxt,
  llmsPaths,
  MAX_BYTES,
  NO_PROPERTIES_SENTENCE,
} from "../../src/server/seo/llms";
import { staticSitemapPaths } from "../../src/server/seo/sitemap";
import { propertyJson, snapshotJson } from "../fixtures/snapshot";

const ORIGIN = "https://matterofplace.com";

const state: PublicState = {
  catalogVersion: 7,
  flags: {},
  comingSoonGlobal: false,
  comingSoonMarkets: {},
  site: {},
  illustrativeContent: false,
  ogStatic: {},
};

const MARKETS: Json[] = [
  {
    slug: "california",
    name: "California",
    country: "United States",
    currency: "USD",
    intro: "A long coast. Many climates.",
    places: [],
    image: null,
    interest_copy: null,
  },
  {
    slug: "florida",
    name: "Florida",
    country: "United States",
    currency: "USD",
    intro: "A low coast.",
    places: [],
    image: null,
    interest_copy: null,
  },
];
const REGIONS: Json[] = [
  {
    slug: "bay-area",
    market_slug: "california",
    name: "Bay Area",
    intro: "Hills and water.",
    places: [],
    image: null,
  },
];

const idOf = (slug: string): string => `00000000-0000-4000-8000-${slug.padStart(12, "0")}`;

function property(slug: string, extra: Record<string, Json> = {}): Json {
  const base = propertyJson(slug);
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    throw new Error("propertyJson returned a value that is not an object");
  }
  return { ...base, ...extra };
}

const story = (slug: string, extra: Record<string, Json> = {}): Json => ({
  id: `story-${slug}`,
  slug,
  title: "A quiet house",
  deck: "A deck about a house on a hill.",
  category: "Places",
  market_slug: "california",
  image: null,
  body: ["First paragraph.", "Second paragraph."],
  properties: [],
  published_at: "2026-09-01T00:00:00+00:00",
  updated_at: "2026-09-02T10:00:00+00:00",
  ...extra,
});

/** The catalog as `getCatalog` serves it: mapped, then filtered for visibility, with the list cards. */
function served(
  parts: Record<string, Json>,
  over: Partial<PublicState> = {},
): { catalog: ServedCatalog; current: PublicState } {
  const current = { ...state, ...over };
  const mapped = mapSnapshot(
    parseSnapshot(snapshotJson(7, { markets: MARKETS, regions: REGIONS, ...parts })),
    current,
  );
  const visible = applyVisibility(mapped, { state: current, env: { MOP_ENV: "production" } });
  return {
    catalog: { ...visible, cards: visible.properties.map(toPropertyCard) },
    current,
  };
}

function textOf(
  build: typeof buildLlmsTxt,
  parts: Record<string, Json>,
  over: Partial<PublicState> = {},
  maxBytes?: number,
): string {
  const { catalog, current } = served(parts, over);
  return build(catalog, current, maxBytes);
}

const links = (text: string): string[] =>
  [...text.matchAll(/(?<!\\)\]\(([^)]*)\)/g)].flatMap((match) => match[1] ?? []);

describe.each([
  ["llms.txt", buildLlmsTxt],
  ["llms-full.txt", buildLlmsFull],
])("%s", (_name, build) => {
  const sample = (): string =>
    textOf(build, { properties: [property("p1")], stories: [story("a-quiet-house")] });

  it("opens with the brand as a level-one heading and a blockquote summary", () => {
    const lines = sample().split("\n");
    expect(lines[0]).toBe("# Matter of Place");
    expect(lines[1]).toBe("");
    expect(lines[2]).toMatch(/^> .*California, New York and Florida\.$/);
  });

  it("has a section for the markets, the properties and the stories", () => {
    const headings = sample().match(/^## .*$/gm);
    expect(headings).toEqual(
      build === buildLlmsTxt
        ? ["## Pages", "## Markets", "## Properties", "## Stories"]
        : ["## Markets", "## Properties", "## Stories"],
    );
  });

  it("writes every link as an absolute https address and none as a relative one", () => {
    const addresses = links(sample());
    expect(addresses.length).toBeGreaterThan(4);
    for (const address of addresses) expect(address).toMatch(/^https:\/\/matterofplace\.com\//);
  });

  it("says in one sentence that nothing is published, and lists no property, while there is none", () => {
    const text = textOf(build, { properties: [] });
    expect(text).toContain(`## Properties\n\n${NO_PROPERTIES_SENTENCE}`);
    expect(links(text).filter((address) => address.includes("/property/"))).toEqual([]);
    expect(links(text)).not.toContain(`${ORIGIN}/properties`);
  });

  it("leaves out a taken-down property, the old slug of a moved one and a hidden one", () => {
    const text = textOf(
      build,
      {
        properties: [
          property("kept"),
          property("taken"),
          property("old-name"),
          property("new-name"),
        ],
        gone: ["taken"],
        slug_history: [{ slug: "old-name", property_id: idOf("new-name") }],
      },
      { comingSoonMarkets: { florida: true } },
    );
    const listed = links(text).filter((address) => address.includes("/property/"));
    expect([...listed].sort()).toEqual([`${ORIGIN}/property/kept`, `${ORIGIN}/property/new-name`]);
  });

  it("links an empty market to its guide and a market with a property to its page", () => {
    const addresses = links(sample());
    expect(addresses).toContain(`${ORIGIN}/california`);
    expect(addresses).toContain(`${ORIGIN}/florida/guide`);
    expect(addresses).not.toContain(`${ORIGIN}/florida`);
  });

  it("lists an archive of three properties only while the flag is on", () => {
    const styled = Array.from({ length: 3 }, (_unused, index) =>
      property(`s${String(index)}`, { style: "Modernist" }),
    );
    const on = textOf(build, { properties: styled }, { flags: { archive_pages: true } });
    expect(on).toContain("## Archives");
    expect(links(on)).toContain(`${ORIGIN}/archive/style/modernist`);
    expect(textOf(build, { properties: styled })).not.toContain("## Archives");
  });

  it("cannot be made to carry a link by the free text of a submission", () => {
    const text = textOf(build, {
      properties: [property("p1", { title: "House [click](https://example.com/x)" })],
    });
    expect(links(text).filter((address) => !address.startsWith(ORIGIN))).toEqual([]);
  });

  it("names a property and a story without the full stop of its headline", () => {
    const text = textOf(build, {
      properties: [property("p1", { title: "Terraces above the cove." })],
      stories: [story("a-quiet-house", { title: "A quiet house." })],
    });
    expect(text).toContain("[Terraces above the cove, Tiburon](");
    expect(text).toContain("[A quiet house](");
  });

  it("names no street address", () => {
    expect(sample()).not.toContain("1 Cliff Road");
  });
});

describe("llms-full.txt", () => {
  it("gives the facts and the text of a property and of a story", () => {
    const text = textOf(buildLlmsFull, {
      properties: [property("p1", { architect: "A. Architect" })],
      stories: [story("a-quiet-house")],
    });
    expect(text).toContain("### [Cliff House, Tiburon](https://matterofplace.com/property/p1)");
    expect(text).toContain("Residence in Tiburon, California.");
    expect(text).toContain("4 bedrooms, 3 bathrooms, 3,200 sq ft");
    expect(text).toContain("Architect: A. Architect.");
    expect(text).toContain("One paragraph.");
    expect(text).toContain("Place: A quiet hill.");
    expect(text).toContain("First paragraph.\n\nSecond paragraph.");
  });

  it("names the representative and writes neither a phone number nor an email address", () => {
    const text = textOf(buildLlmsFull, {
      properties: [property("p1", { representative_id: "r1" })],
      representatives: [
        {
          id: "r1",
          name: "Ada Agent",
          brokerage: "Harbor Realty",
          license: "01234567",
          email: "ada@harbor.example",
          phone: "+1 415 555 0100",
          photo: null,
        },
      ],
    });
    expect(text).toContain("Presented by Ada Agent, Harbor Realty.");
    expect(text).not.toMatch(/ada@harbor|555 0100|01234567|@/);
  });

  it("says when the owner presents the home", () => {
    const text = textOf(buildLlmsFull, {
      properties: [property("p1", { presented_by_owner: true })],
    });
    expect(text).toContain("Presented by the owner.");
  });
});

describe("the size cap", () => {
  it("is 500 KB", () => {
    expect(MAX_BYTES).toBe(512_000);
  });

  it("cuts llms-full.txt after the last entry that fits, and says so in a line", () => {
    const huge = "word ".repeat(120_000);
    const text = textOf(buildLlmsFull, {
      properties: [property("p1")],
      stories: [story("big", { body: [huge] }), story("small")],
    });
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MAX_BYTES);
    expect(text).toContain("### [Cliff House, Tiburon]");
    expect(text).not.toContain("word word word");
    expect(text).toMatch(
      /\nList truncated: 2 more entries\. Every page is listed at https:\/\/matterofplace\.com\/sitemap\.xml\.\n$/,
    );
  });

  it("cuts llms.txt the same way under a smaller cap, whole entries only", () => {
    const parts = { properties: [property("p1"), property("p2"), property("p3")] };
    const whole = textOf(buildLlmsTxt, parts);
    const cut = textOf(buildLlmsTxt, parts, {}, 1100);
    expect(whole).not.toContain("List truncated");
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(1100);
    expect(cut).toMatch(/\nList truncated: \d+ more entries\. /);
    for (const line of cut.split("\n").filter((entry) => entry.startsWith("- "))) {
      expect(whole).toContain(line);
    }
  });

  it("leaves a short file whole", () => {
    expect(textOf(buildLlmsTxt, {})).not.toContain("List truncated");
  });
});

describe("the pages it lists", () => {
  it("are all pages of the sitemap", () => {
    for (const path of llmsPaths) expect(staticSitemapPaths).toContain(path);
  });
});
