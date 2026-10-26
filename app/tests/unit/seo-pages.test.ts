import "../fixtures/worker-env";
import { readFileSync } from "node:fs";
import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { absoluteUrl, siteConfig } from "../../src/config/site";
import { guidePageAt, requireSeoPage, seoPageAt, seoPages } from "../../src/content/seo";
import { guideLoaders } from "../../src/content/seo/loaders";
import { seoPageMeta, seoPagePaths } from "../../src/content/seo/meta";
import type { SeoPageContent } from "../../src/content/seo/types";
import {
  isServedPath,
  servedRelated,
  servedStaticPaths,
  splitInline,
} from "../../src/lib/seo-links";
import { seoPageJsonLd } from "../../src/lib/seo-page";
import { Route as GuideRoute } from "../../src/routes/_site.guides.$slug";
import { Route as GuidesIndexRoute } from "../../src/routes/_site.guides.index";
import { Route as HistoricRoute } from "../../src/routes/_site.historic-homes-for-sale";
import { staticSitemapPaths } from "../../src/server/seo/sitemap";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

/** The plans and fees as the site seeds them (`settings.products` is edited in /admin and starts from this file). */
const exposureSource = read("../../src/data/exposure.ts");

/** Every string a visitor reads on the page, inline links reduced to their anchors. */
function textsOf(page: SeoPageContent): string[] {
  const body = page.sections.flatMap(({ heading, body: blocks }) => [
    heading,
    ...blocks.flatMap((block) => {
      if (typeof block === "string") return [block];
      if ("h3" in block) return [block.h3];
      return "list" in block ? block.list : block.steps;
    }),
  ]);
  return [
    page.h1,
    page.lede,
    ...body,
    ...page.faq.flatMap(({ q, a }) => [q, a]),
    page.cta.heading,
    page.cta.text,
  ].map((text) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"));
}

const wordCount = (page: SeoPageContent) =>
  textsOf(page).join(" ").split(/\s+/).filter(Boolean).length;

/** Words too small to count when a query is matched against a heading ("historic homes in a town" = "historic homes town"). */
const QUERY_STOP_WORDS = new Set(["in", "a", "the", "for"]);

/** Lower case, hyphens read as spaces, stop words dropped: "Mid-Century Modern Homes" and "mid century modern homes" agree. */
const queryWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/-/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "" && !QUERY_STOP_WORDS.has(word));

const MONEY_OUTLINE = ["How it works", "What you get", "Proof: reviews and results"];
const GUIDE_OUTLINE = [
  "The short answer",
  "What changes the answer",
  "Step by step",
  "Common mistakes",
];

/**
 * The briefs are generated with three outlines, and the heading of the closing section says which one a page
 * follows: "Get started" is a money page, "Talk to Matter of Place" a city landing page (its H2s carry the place), and
 * "Next step" a guide. Returns what is wrong with the page against its own outline; an unknown closing heading is a
 * problem too, so a fourth outline is added here on purpose and not by accident.
 */
function outlineProblems(page: SeoPageContent): string[] {
  const headings = page.sections.map((section) => section.heading);
  const problems: string[] = [];
  if (headings.length < 3) problems.push(`only ${String(headings.length)} H2 sections`);
  if (new Set(headings).size !== headings.length) problems.push("an H2 is repeated");
  const same = (expected: string[]) =>
    headings.length === expected.length && headings.every((heading, i) => heading === expected[i]);
  if (page.cta.heading === "Get started") {
    if (page.kind !== "collection") problems.push("a guide closes on Get started");
    if (!same(MONEY_OUTLINE)) problems.push(`money outline expected, got ${headings.join(" / ")}`);
  } else if (page.cta.heading === "Talk to Matter of Place") {
    if (page.kind !== "collection") problems.push("a guide closes on Talk to Matter of Place");
    const place = /^Why work with Matter of Place in (.+)$/.exec(headings[0] ?? "")?.[1];
    if (place === undefined) problems.push(`no place in the first H2 ${headings[0] ?? ""}`);
    else if (
      !same([
        `Why work with Matter of Place in ${place}`,
        `How we help in ${place}`,
        `${place} market and neighborhood facts`,
        "What it costs",
      ])
    )
      problems.push(`city outline for ${place} expected, got ${headings.join(" / ")}`);
  } else if (page.cta.heading === "Next step") {
    if (page.kind !== "guide") problems.push("a collection guide closes on Next step");
    if (!same(GUIDE_OUTLINE)) problems.push(`guide outline expected, got ${headings.join(" / ")}`);
  } else problems.push(`unknown closing heading ${page.cta.heading}`);
  return problems;
}

describe("the registry of search pages", () => {
  it("holds the pages of phase 1, each once, at an address with no trailing slash", () => {
    const paths = seoPages.map((page) => page.path);
    expect(paths).toEqual(
      expect.arrayContaining(["/historic-homes-for-sale", "/guides/how-to-sell-a-historic-home"]),
    );
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths)
      expect(path).toMatch(/^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/);
  });

  it("keeps a guide under /guides/ and a collection guide at the top level", () => {
    for (const page of seoPages) {
      expect([page.path, page.path.startsWith("/guides/")]).toEqual([
        page.path,
        page.kind === "guide",
      ]);
    }
  });

  it("finds a page by its address and by its guide slug, and refuses what is not there", () => {
    expect(seoPageAt("/historic-homes-for-sale")?.kind).toBe("collection");
    expect(seoPageAt("/historic-homes-for-sale/")).toBeUndefined();
    expect(guidePageAt("how-to-sell-a-historic-home")?.kind).toBe("guide");
    expect(guidePageAt("historic-homes-for-sale")).toBeUndefined();
    expect(() => requireSeoPage("/no-such-page")).toThrow("no page in src/content/seo serves");
  });

  it("gives every page a description of 70 to 155 characters and real content dates", () => {
    for (const page of seoPages) {
      expect([page.path, page.description.length >= 70 && page.description.length <= 155]).toEqual([
        page.path,
        true,
      ]);
      for (const day of [page.published, page.updated]) expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect([page.path, page.updated >= page.published]).toEqual([page.path, true]);
    }
  });

  it("carries every word of the query in the H1 or title, and most of them in the first paragraph", () => {
    for (const page of seoPages) {
      const query = queryWords(page.query);
      expect([page.path, query.length > 0]).toEqual([page.path, true]);
      const headline = new Set(queryWords(`${page.h1} ${page.title}`));
      expect([page.path, query.filter((word) => !headline.has(word))]).toEqual([page.path, []]);
      // A question ("how much does it cost ...") is answered in a statement, so the lede may not repeat every word.
      const lede = new Set(queryWords(page.lede));
      const shared = query.filter((word) => lede.has(word)).length / query.length;
      expect([page.path, shared >= 0.7]).toEqual([page.path, true]);
    }
  });

  it("follows the outline of its kind, then the questions, then the closing section", () => {
    for (const page of seoPages) {
      expect([page.path, outlineProblems(page)]).toEqual([page.path, []]);
      expect([page.path, page.faq.length >= 3]).toEqual([page.path, true]);
      for (const { q, a } of page.faq) {
        expect([page.path, q.trim() !== "" && a.trim() !== ""]).toEqual([page.path, true]);
      }
      expect([page.path, page.cta.text.trim() !== ""]).toEqual([page.path, true]);
    }
  });

  it("stays inside the word range its page declares", () => {
    for (const page of seoPages) {
      const [low, high] = page.words;
      // The declared range itself must be a plausible page length, or a page could declare its way past the check.
      expect([page.path, Number.isInteger(low) && Number.isInteger(high)]).toEqual([
        page.path,
        true,
      ]);
      expect([page.path, low >= 500 && low < high && high <= 3000]).toEqual([page.path, true]);
      const words = wordCount(page);
      expect([page.path, words >= low && words <= high]).toEqual([page.path, true]);
    }
  });

  it("writes only inline links and related links of the form /path with no trailing slash", () => {
    const address = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;
    for (const page of seoPages) {
      const inline = [...JSON.stringify(page).matchAll(/\[[^\]]+\]\((\/[^)]*)\)/g)].map(
        (match) => match[1] ?? "",
      );
      for (const to of [...inline, ...page.related.map((link) => link.to)]) {
        expect([page.path, to, address.test(to)]).toEqual([page.path, to, true]);
      }
    }
  });

  it("keeps the anchors the briefs name for the pages built so far", () => {
    const brief: Record<string, string[]> = {
      "/historic-homes-for-sale": [
        "matter of place",
        "historic homes for sale hudson valley",
        "mid-century modern homes",
        "frank lloyd wright homes",
        "architect designed homes for sale",
        "design focused homes for sale newsletter",
      ],
      "/guides/how-to-sell-a-historic-home": [
        "matter of place",
        "real estate marketing",
        "is a sponsored real estate feature worth it",
        "historic homes for sale",
        "historic homes for sale hudson valley",
        "how to sell an architecturally significant home",
      ],
    };
    for (const [path, anchors] of Object.entries(brief)) {
      expect(requireSeoPage(path).related.map((link) => link.anchor)).toEqual(anchors);
    }
  });
});

describe("the light lists that keep page copy out of the chunk every route loads", () => {
  it("repeats the address, kind, headline and description of every page, in the registry's order", () => {
    expect(seoPageMeta).toEqual(
      seoPages.map(({ path, kind, h1, description }) => ({ path, kind, h1, description })),
    );
    expect([...seoPagePaths]).toEqual(seoPages.map((page) => page.path));
  });

  it("loads each article guide by its slug, and only the guides", async () => {
    const slugOf = (page: SeoPageContent) => page.path.slice("/guides/".length);
    const guides = seoPages.filter((page) => page.kind === "guide");
    expect([...guideLoaders.keys()]).toEqual(guides.map(slugOf));
    for (const guide of guides) {
      const load = guideLoaders.get(slugOf(guide));
      expect([guide.path, (await load?.())?.path]).toEqual([guide.path, guide.path]);
    }
    expect(guideLoaders.get("historic-homes-for-sale")).toBeUndefined();
    expect(guideLoaders.get("constructor")).toBeUndefined();
  });

  it("imports no page copy at the top of a file every route loads", () => {
    const files = [
      "../../src/lib/seo-page.ts",
      "../../src/routes/_site.guides.index.tsx",
      "../../src/routes/_site.guides.$slug.tsx",
      ...seoPages
        .filter((page) => page.kind === "collection")
        .map((page) => `../../src/routes/_site.${page.path.slice(1)}.tsx`),
    ];
    for (const file of files) {
      const copyImports = read(file)
        .split("\n")
        .filter((line) => /^import\b(?!\s+type\b).*content\/seo/.test(line))
        .filter((line) => !line.includes('content/seo/loaders"'));
      expect([file, copyImports]).toEqual([file, []]);
    }
  });
});

describe("the copy of the search pages follows the brand rules", () => {
  const OTHER_PLACES =
    /\b(global|worldwide|international|europe|london|paris|dubai|texas|nevada)\b/i;
  const HYPERBOLE = /exclusive|stunning|unlock|dream|world-class|once in a lifetime/i;

  it("has no em dash, en dash or exclamation mark, no hyperbole and no market outside the three", () => {
    for (const page of seoPages) {
      const text = textsOf(page).join("\n");
      expect([page.path, /[–—!]/.test(text)]).toEqual([page.path, false]);
      expect([page.path, HYPERBOLE.test(text)]).toEqual([page.path, false]);
      expect([page.path, OTHER_PLACES.test(text)]).toEqual([page.path, false]);
    }
  });

  it("sells no consultation and quotes no price, rate or percentage it cannot source", () => {
    for (const page of seoPages) {
      const text = textsOf(page).join("\n");
      expect([page.path, /consultation/i.test(text)]).toEqual([page.path, false]);
      // A figure is allowed only when the Property Exposure seed holds it: a page repeats a price, it never sets one.
      const figures = text.match(/\$\s?\d+(?:,\d{3})*|\d+\s?%/g) ?? [];
      const unsourced = figures.filter(
        (figure) => !exposureSource.includes(figure.replace(/\s/g, "")),
      );
      expect([page.path, unsourced]).toEqual([page.path, []]);
    }
  });

  it("promises no leads, buyers or sales: the words appear only to refuse them", () => {
    for (const page of seoPages) {
      const promises = textsOf(page).flatMap((text) =>
        text
          .split(/(?<=[.?])\s+/)
          .filter(
            (sentence) => !sentence.endsWith("?") && /\b(guarantees?|promises?)\b/i.test(sentence),
          ),
      );
      for (const sentence of promises) expect(sentence).toMatch(/\b(no|not|nor|neither|never)\b/i);
    }
  });
});

describe("splitInline", () => {
  it("keeps a link to a page that exists and writes a link to one that does not as its anchor", () => {
    expect(
      splitInline("Read the [standard](/editorial-standard), then [the rest](/not-written-yet)."),
    ).toEqual([
      { text: "Read the " },
      { text: "standard", to: "/editorial-standard" },
      { text: ", then " },
      { text: "the rest" },
      { text: "." },
    ]);
  });

  it("returns a paragraph without a link whole", () => {
    expect(splitInline("Nothing to link.")).toEqual([{ text: "Nothing to link." }]);
  });
});

describe("served paths", () => {
  it("names only pages that are in the sitemap's static paths, plus the registry and /guides", () => {
    const sitemapPaths: readonly string[] = staticSitemapPaths;
    expect([...servedStaticPaths].filter((path) => !sitemapPaths.includes(path))).toEqual([]);
    for (const page of seoPages) expect(isServedPath(page.path)).toBe(true);
    expect(isServedPath("/guides")).toBe(true);
    expect(isServedPath("/mid-century-modern-homes")).toBe(
      seoPageAt("/mid-century-modern-homes") !== undefined,
    );
  });

  it("draws only the related links whose page exists", () => {
    for (const page of seoPages) {
      const drawn = servedRelated(page);
      expect(drawn.every((link) => isServedPath(link.to))).toBe(true);
      expect(page.related).toEqual(expect.arrayContaining(drawn));
    }
  });
});

describe("the routes", () => {
  it("has one route file for each collection guide, loading its page", () => {
    for (const page of seoPages.filter((item) => item.kind === "collection")) {
      const file = `../../src/routes/_site.${page.path.slice(1)}.tsx`;
      expect([
        page.path,
        read(file).includes(`import("../content/seo/${page.path.slice(1)}")`),
      ]).toEqual([page.path, true]);
    }
  });

  it("links the guides index from the footer, so no search page is an orphan", () => {
    expect(read("../../src/components/layout/footer.tsx")).toContain('to="/guides"');
  });
});

const headShape = z.object({
  meta: z.array(z.record(z.string(), z.unknown())),
  links: z.array(z.record(z.string(), z.unknown())),
  scripts: z.array(z.object({ type: z.string(), children: z.string() })),
});
type Head = z.infer<typeof headShape>;

/** A route's own `head()`, called as the router calls it. */
function headOf(head: unknown, loaderData?: unknown): Head {
  if (typeof head !== "function") throw new Error("the route has no head()");
  return headShape.parse(Reflect.apply(head, undefined, [{ loaderData, matches: [] }]));
}

const metaOf = (head: Head, key: string) =>
  head.meta.flatMap((tag) =>
    tag["name"] === key || tag["property"] === key ? [tag["content"]] : [],
  );
const titleOf = (head: Head) => head.meta.flatMap((tag) => ("title" in tag ? [tag["title"]] : []));
const graphOf = (head: Head) =>
  z
    .object({ "@graph": z.array(z.record(z.string(), z.unknown())) })
    .parse(JSON.parse(head.scripts[0]?.children ?? "null"))["@graph"];
const typesOf = (head: Head) => graphOf(head).map((node) => node["@type"]);

describe("the head of a collection guide", () => {
  const page = requireSeoPage("/historic-homes-for-sale");
  const head = headOf(HistoricRoute.options.head, page);

  it("writes the title once with the brand, the description, and a self canonical with no trailing slash", () => {
    expect(titleOf(head)).toEqual([`Historic Homes for Sale | ${siteConfig.name}`]);
    expect(metaOf(head, "description")).toEqual([page.description]);
    expect(head.links).toEqual([
      { rel: "canonical", href: absoluteUrl("/historic-homes-for-sale") },
    ]);
    expect(metaOf(head, "og:url")).toEqual([absoluteUrl("/historic-homes-for-sale")]);
    expect(absoluteUrl("/historic-homes-for-sale")).not.toMatch(/\/$/);
  });

  it("writes a website page with Service and FAQPage data in one graph, and no Article", () => {
    expect(metaOf(head, "og:type")).toEqual(["website"]);
    expect(metaOf(head, "article:modified_time")).toEqual([]);
    expect(typesOf(head)).toEqual(["WebPage", "BreadcrumbList", "Service", "FAQPage"]);
    const faq = graphOf(head).find((node) => node["@type"] === "FAQPage");
    expect(z.object({ mainEntity: z.array(z.unknown()) }).parse(faq).mainEntity).toHaveLength(
      page.faq.length,
    );
  });

  it("gives the Service the page's primary id and names no price", () => {
    const service = graphOf(head).find((node) => node["@type"] === "Service");
    expect(service?.["@id"]).toBe(`${absoluteUrl(page.path)}#primary`);
    expect(JSON.stringify(service)).not.toMatch(/offers|price/i);
  });
});

describe("the head of an article guide", () => {
  const page = requireSeoPage("/guides/how-to-sell-a-historic-home");
  const head = headOf(GuideRoute.options.head, page);

  it("writes the title, the canonical and the article dates from the content, not the clock", () => {
    expect(titleOf(head)).toEqual([`How to Sell a Historic Home? | ${siteConfig.name}`]);
    expect(head.links).toEqual([{ rel: "canonical", href: absoluteUrl(page.path) }]);
    expect(metaOf(head, "og:type")).toEqual(["article"]);
    expect(metaOf(head, "article:published_time")).toEqual([page.published]);
    expect(metaOf(head, "article:modified_time")).toEqual([page.updated]);
  });

  it("writes Article data, a breadcrumb under Guides, and no FAQPage or Service", () => {
    expect(typesOf(head)).toEqual(["WebPage", "BreadcrumbList", "Article"]);
    const article = graphOf(head).find((node) => node["@type"] === "Article");
    expect(article).toMatchObject({
      headline: page.h1,
      datePublished: page.published,
      dateModified: page.updated,
    });
    const crumbs = graphOf(head).find((node) => node["@type"] === "BreadcrumbList");
    expect(JSON.stringify(crumbs)).toContain(absoluteUrl("/guides"));
  });

  /** The route's loader, called as the router calls it for `slug`. */
  const loadGuide = async (slug: string): Promise<unknown> =>
    Reflect.apply(GuideRoute.options.loader ?? (() => undefined), undefined, [
      { params: { slug } },
    ]);

  it("answers an unknown slug 404 and marks its head noindex", async () => {
    const thrown = await loadGuide("no-such-guide").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isNotFound(thrown)).toBe(true);
    expect(metaOf(headOf(GuideRoute.options.head), "robots")).toEqual(["noindex, nofollow"]);
  });

  it("loads the whole guide of its slug, for the head and for the page", async () => {
    expect(await loadGuide("how-to-sell-a-historic-home")).toEqual(page);
  });
});

describe("the guides index", () => {
  const head = headOf(GuidesIndexRoute.options.head, seoPageMeta);

  it("is titled Guides, canonical at /guides, and lists every page in a collection", () => {
    expect(titleOf(head)).toEqual([`Guides | ${siteConfig.name}`]);
    expect(head.links).toEqual([{ rel: "canonical", href: absoluteUrl("/guides") }]);
    const collection = graphOf(head).find((node) => node["@type"] === "CollectionPage");
    expect(
      z.object({ mainEntity: z.object({ numberOfItems: z.number() }) }).parse(collection).mainEntity
        .numberOfItems,
    ).toBe(seoPages.length);
    const description = metaOf(head, "description")[0];
    expect(
      typeof description === "string" && description.length >= 70 && description.length <= 155,
    ).toBe(true);
  });
});

describe("seoPageJsonLd", () => {
  it("leaves a FAQPage with no id when it is the only data, so pageHead gives it the page id", () => {
    const only: SeoPageContent = {
      ...requireSeoPage("/historic-homes-for-sale"),
      schema: ["FAQPage"],
    };
    const faq = seoPageJsonLd(only).find((node) => Reflect.get(node, "@type") === "FAQPage");
    expect(faq && Reflect.get(faq, "@id")).toBeUndefined();
  });
});
