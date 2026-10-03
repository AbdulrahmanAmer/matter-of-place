import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { jsonLdExpectations, type RouteClass } from "./routes";

const blockSchema = z
  .object({ "@context": z.unknown(), "@graph": z.array(z.record(z.unknown())).optional() })
  .passthrough();

export type JsonLdBlock = { context: unknown; nodes: Record<string, unknown>[] };

/**
 * Every `<script type="application/ld+json">` of the page, parsed. A block with an `@graph` contributes its members;
 * any other block contributes itself. A block that is not valid JSON throws, naming the page.
 */
export async function extractJsonLd(page: Page): Promise<JsonLdBlock[]> {
  const sources = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) => scripts.map((script) => script.textContent));
  return sources.map((source) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(
        `${page.url()}: ld+json block is not valid JSON (${error instanceof Error ? error.message : "parse error"})`,
        { cause: error },
      );
    }
    const block = blockSchema.parse(parsed);
    const { "@graph": graph, "@context": context, ...rest } = block;
    return { context, nodes: graph ?? [rest] };
  });
}

function typesOf(node: Record<string, unknown>): string[] {
  const type = node["@type"];
  if (typeof type === "string") return [type];
  return Array.isArray(type) ? type.filter((item): item is string => typeof item === "string") : [];
}

/** Each block declares the schema.org context, and the page carries every type its route class requires. */
export async function expectJsonLd(page: Page, routeClass: RouteClass): Promise<void> {
  const blocks = await extractJsonLd(page);
  expect(
    blocks.map((block) => block.context),
    "@context of each ld+json block",
  ).toEqual(blocks.map(() => "https://schema.org"));
  const found = blocks.flatMap((block) => block.nodes.flatMap(typesOf));
  for (const required of jsonLdExpectations[routeClass]) {
    expect(found, `ld+json types of a ${routeClass} page`).toContain(required);
  }
}
