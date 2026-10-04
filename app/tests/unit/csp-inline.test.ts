// SEC-03 canary (B13 invariant 14): a title or story that comes from the public submission form must never
// become executable markup, in the head or anywhere else of the server-rendered page.
// The equality of B17's `inlineHashes(html)` for the hostile and the clean render is added when B17 lands.
import "../fixtures/worker-env";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { properties } from "../../src/data/properties";
import { stories } from "../../src/data/stories";
import { propertyQuery, storyQuery } from "../../src/lib/queries";
import { getRouter } from "../../src/router";

const HOSTILE = "</script><script>window.__x=1</script>";
const structural = new Set(["slug", "market", "region", "currency", "publishedAt", "status"]);

function hostile(value: unknown, key = ""): unknown {
  if (typeof value === "string") return structural.has(key) ? value : HOSTILE;
  if (Array.isArray(value)) return value.map((item) => hostile(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hostile(v, k)]));
  }
  return value;
}

const property = properties[0];
const story = stories[0];
if (property === undefined || story === undefined) throw new Error("no bundled data");

type Router = ReturnType<typeof getRouter>;

async function render(path: string, seed: (router: Router) => void) {
  const router = getRouter();
  router.update({ ...router.options, history: createMemoryHistory({ initialEntries: [path] }) });
  seed(router);
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
}

const pages = [
  {
    name: "property",
    path: `/property/${property.slug}`,
    seed: (router: Router, data: unknown) =>
      router.options.context.queryClient.setQueryData(
        [...propertyQuery(property.slug).queryKey],
        data,
      ),
    clean: property,
  },
  {
    name: "story",
    path: `/stories/${story.slug}`,
    seed: (router: Router, data: unknown) =>
      router.options.context.queryClient.setQueryData([...storyQuery(story.slug).queryKey], data),
    clean: story,
  },
];

const scriptCount = (html: string) => html.split("<script").length - 1;

describe.each(pages)("$name page", ({ path, seed, clean }) => {
  it("renders a hostile payload as text and adds no script element", async () => {
    const dirty = await render(path, (router) => seed(router, hostile(clean)));
    const plain = await render(path, (router) => seed(router, clean));
    expect(dirty).not.toContain("Switched to client rendering");
    expect(dirty).toContain("&lt;/script&gt;");
    expect(dirty).not.toContain("<script>window.__x");
    expect(scriptCount(dirty)).toBe(scriptCount(plain));
  });
});

describe("property page structured data", () => {
  it("parses back to the hostile fixture and holds no raw angle bracket", async () => {
    const html = await render(pages[0]?.path ?? "", (router) =>
      pages[0]?.seed(router, hostile(property)),
    );
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
    expect(blocks).toHaveLength(1);
    const body = blocks[0]?.[1] ?? "";
    expect(body).not.toMatch(/[<>&]/);
    expect(JSON.parse(body)).toMatchObject({ name: HOSTILE });
  });
});
