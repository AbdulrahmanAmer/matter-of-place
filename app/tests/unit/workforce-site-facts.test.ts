import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  pageText,
  readSiteFacts,
  SITE_PAGES,
  siteFactsBlock,
  writeSitePages,
  type Fetch,
} from "../../scripts/workforce/site-facts";

// W5 item 13 (2026-10-15): the Concierge bracketed every price and the Editor could not read the About page; the
// daemon now hands the colleagues our own site's facts and pages as data.

const site = {
  contact: { email: "admin@matterofplace.com" },
  legal: { entity: "Omnikom LLC" },
  products: [
    {
      name: "The Feature",
      price: 295,
      line: "Editorial presence.",
      note: null,
      items: ["Dedicated Matter of Place property page"],
    },
    {
      name: "The Campaign",
      price: 1495,
      line: "A deeper, multi-channel property campaign.",
      note: "Recommended media investment: $500 to $2,500+",
      items: ["Everything in The Reach"],
    },
  ],
};
const markets = [{ name: "California", places: ["Los Angeles", "Malibu"] }];

const answer =
  (pages: Record<string, { status: number; body: string }>): Fetch =>
  (url) => {
    const hit = pages[new URL(url).pathname] ?? { status: 404, body: "" };
    return Promise.resolve({
      ok: hit.status === 200,
      status: hit.status,
      text: () => Promise.resolve(hit.body),
    });
  };

describe("the site facts a colleague is given", () => {
  it("states every product with its real price, the markets and the contact", () => {
    const block = siteFactsBlock(site, markets);
    expect([
      block.includes("- The Feature: $295. Editorial presence."),
      block.includes("- The Campaign: $1,495."),
      block.includes("Recommended media investment: $500 to $2,500+"),
      block.includes("California (Los Angeles, Malibu)"),
      block.includes("admin@matterofplace.com"),
    ]).toEqual([true, true, true, true, true]);
  });

  it("says not to guess a price when the site cannot be read", async () => {
    const block = await readSiteFacts(answer({}), "https://example.test");
    expect([block.includes("could not be read"), block.includes("$")]).toEqual([true, false]);
  });

  it("reads the facts from the public site and markets routes", async () => {
    const block = await readSiteFacts(
      answer({
        "/api/public/site": { status: 200, body: JSON.stringify(site) },
        "/api/public/markets": { status: 200, body: JSON.stringify(markets) },
      }),
      "https://example.test",
    );
    expect(block.includes("- The Feature: $295.")).toBe(true);
  });
});

describe("the public pages in a desk", () => {
  it("keeps the words of the main element and drops scripts, styles and tags", () => {
    const html =
      "<html><head><style>a{}</style></head><body><nav>Menu</nav><main><h1>About</h1><script>x()</script><p>Calm &amp; brief.</p></main></body></html>";
    expect(pageText(html)).toBe("About\n\nCalm & brief.");
  });

  it("writes every page into every desk, then not again within a day", async () => {
    const root = mkdtempSync(join(tmpdir(), "desks-"));
    const desks = [join(root, "editor"), join(root, "concierge")];
    const pages = Object.fromEntries(
      Object.values(SITE_PAGES).map((path) => [
        path,
        { status: 200, body: `<main><p>${path}</p></main>` },
      ]),
    );
    const now = Date.now();
    const first = await writeSitePages(desks, answer(pages), "https://example.test", now);
    const again = await writeSitePages(desks, answer(pages), "https://example.test", now + 60_000);
    expect([
      first,
      again,
      existsSync(join(desks[1] ?? "", "site", "about.md")),
      readFileSync(join(desks[0] ?? "", "site", "about.md"), "utf8").includes("/about"),
    ]).toEqual([Object.keys(SITE_PAGES).length, 0, true, true]);
  });
});
