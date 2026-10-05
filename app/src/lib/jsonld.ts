import type {
  Article,
  BreadcrumbList,
  CollectionPage,
  Organization,
  RealEstateListing,
  SearchAction,
  VideoObject,
  WebSite,
} from "schema-dts";
import { absoluteUrl, siteConfig } from "../config/site";
import type { Property } from "../domain/property";
import type { Story } from "../domain/story";
import { propertyDescription } from "./seo-copy";

/**
 * Pure builders of structured data. Each returns one node of a page's `@graph`, so none carries an
 * `@context` (`pageHead` adds it), and none stringifies: `serializeJsonForScript` is the only writer
 * of a script body (SEC-03). A field with no value is left out, never defaulted.
 */

const publisher: Organization = { "@type": "Organization", name: siteConfig.name };

/** An address on this site's own public media route, or an absolute `https` URL; anything else is unusable. */
function mediaAddress(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith("/media/")) return absoluteUrl(value);
  return value.startsWith("https://") ? value : undefined;
}

/** Google reads the search box from `query-input`, which schema.org does not define and schema-dts does not type. */
const searchAction: SearchAction & { "query-input": string } = {
  "@type": "SearchAction",
  target: absoluteUrl("/properties?q={search_term_string}"),
  "query-input": "required name=search_term_string",
};

export function websiteLd(): WebSite {
  return {
    "@type": "WebSite",
    "@id": absoluteUrl("/#website"),
    url: siteConfig.url,
    name: siteConfig.name,
    potentialAction: searchAction,
  };
}

export type Crumb = { name: string; path: string };

/** The trail after Home, which is always the first item (position 1). */
export function breadcrumbLd(trail: Crumb[]): BreadcrumbList {
  const items: Crumb[] = [{ name: "Home", path: "/" }, ...trail];
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

type ListedProperty = Pick<
  Property,
  | "slug"
  | "title"
  | "city"
  | "state"
  | "country"
  | "beds"
  | "baths"
  | "interiorSqFt"
  | "yearBuilt"
  | "style"
  | "status"
  | "price"
  | "currency"
  | "publishedAt"
  | "heroVariants"
  | "gallery"
>;

/**
 * The listing page of one property. City level only: no street address and no coordinates, because the
 * owner or agent shares the exact location. `offers` only while the property is `Active`.
 */
export function propertyListingLd(property: ListedProperty): RealEstateListing {
  const url = absoluteUrl(`/property/${property.slug}`);
  const images = [
    property.heroVariants?.hero?.webp,
    ...property.gallery.map((image) => image.variants?.hero?.webp),
  ].flatMap((value) => mediaAddress(value) ?? []);
  return {
    "@type": "RealEstateListing",
    "@id": `${url}#listing`,
    url,
    name: property.title,
    description: propertyDescription(property),
    datePosted: property.publishedAt,
    ...(images.length > 0 ? { image: images } : {}),
    about: {
      "@type": "Accommodation",
      numberOfBedrooms: property.beds,
      numberOfBathroomsTotal: property.baths,
      yearBuilt: property.yearBuilt,
      floorSize: { "@type": "QuantitativeValue", value: property.interiorSqFt, unitCode: "FTK" },
      address: {
        "@type": "PostalAddress",
        addressLocality: property.city,
        addressRegion: property.state,
        addressCountry: property.country,
      },
    },
    ...(property.status === "Active"
      ? {
          offers: {
            "@type": "Offer",
            price: property.price,
            priceCurrency: property.currency,
            availability: "https://schema.org/InStock",
            url,
          },
        }
      : {}),
    publisher,
  };
}

export function articleLd(
  story: Pick<Story, "slug" | "title" | "deck" | "image" | "publishedAt">,
): Article {
  const url = absoluteUrl(`/stories/${story.slug}`);
  const image = mediaAddress(story.image);
  return {
    "@type": "Article",
    "@id": `${url}#article`,
    mainEntityOfPage: url,
    headline: story.title.replace(/\.$/, ""),
    description: story.deck,
    datePublished: story.publishedAt,
    ...(image === undefined ? {} : { image }),
    author: publisher,
    publisher,
  };
}

export type CollectionKind =
  "properties" | "stories" | "markets" | "market" | "region" | "city" | "architect" | "style";

/** A page that lists things: `items` are the listed pages, in the order shown. */
export function collectionLd(
  kind: CollectionKind,
  title: string,
  path: string,
  items: Crumb[],
): CollectionPage {
  const url = absoluteUrl(path);
  return {
    "@type": "CollectionPage",
    "@id": `${url}#${kind}`,
    url,
    name: title,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        url: absoluteUrl(item.path),
      })),
    },
  };
}

/** `0:18` is `PT18S`, `1:05` is `PT1M5S`, `1:02:03` is `PT1H2M3S`; text that is not a clock reading gives no duration. */
function isoDuration(clock: string): string | undefined {
  const parts = clock.split(":").map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) return undefined;
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, ...parts];
  const text = `${hours ? `${String(hours)}H` : ""}${minutes ? `${String(minutes)}M` : ""}${seconds ? `${String(seconds)}S` : ""}`;
  return text === "" ? undefined : `PT${text}`;
}

/** The film of a property, or null when it has none or its file is not on the public media route or an `https` address. */
export function videoLd(property: Pick<Property, "video">): VideoObject | null {
  const { video } = property;
  if (video === undefined) return null;
  const contentUrl = mediaAddress(video.src);
  if (contentUrl === undefined) return null;
  const thumbnailUrl = mediaAddress(video.poster);
  const duration = isoDuration(video.duration);
  return {
    "@type": "VideoObject",
    name: video.caption,
    contentUrl,
    ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
    ...(duration === undefined ? {} : { duration }),
  };
}
