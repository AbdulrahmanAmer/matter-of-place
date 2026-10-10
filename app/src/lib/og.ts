import { z } from "zod";
import { absoluteUrl, siteConfig } from "../config/site";
import type { ogStaticKeys } from "../domain/assets";
import type { Property } from "../domain/property";

/** The pages that have a static card of their own (B9's seven keys); `default` serves every other page. */
export type OgStaticKey = (typeof ogStaticKeys)[number];

/** The newer set of cards, as absolute addresses, from `getOgStaticFn`. */
export type OgStatic = Partial<Record<string, string>>;

const rootData = z.object({ ogStatic: z.record(z.string(), z.string()) });

/** The newer cards the root loader read, from the matches a route `head()` is given; none when the root has not loaded. */
export function ogStaticOf(matches: readonly { loaderData?: unknown }[]): OgStatic | undefined {
  const root = rootData.safeParse(matches[0]?.loaderData);
  return root.success ? root.data.ogStatic : undefined;
}

const WIDTH = 1200;
const HEIGHT = 630;

function isAbsoluteHttps(url: string | undefined): url is string {
  if (url === undefined) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The Open Graph image of a page, the first that applies (G5, G6): the approved cover of a property, the `og`
 * rendition of its hero photograph, then the static card for `key`, where a newer card from `settings.og_static`
 * beats the committed file. A tier counts only when its address is absolute `https`: on the laptop and in tests the
 * media base is unset, the addresses stay relative, and the committed file answers.
 */
export function ogImageFor({
  key,
  property,
  ogStatic,
}: {
  key: OgStaticKey;
  property?: Pick<Property, "title" | "ogImage" | "heroVariants">;
  ogStatic?: OgStatic | undefined;
}) {
  const cover = [property?.ogImage, property?.heroVariants?.og?.jpg].find(isAbsoluteHttps);
  const newer = ogStatic?.[key];
  const url = cover ?? (isAbsoluteHttps(newer) ? newer : absoluteUrl(`/og/static/${key}.png`));
  return {
    url,
    width: WIDTH,
    height: HEIGHT,
    alt: cover !== undefined && property !== undefined ? property.title : siteConfig.name,
  };
}
