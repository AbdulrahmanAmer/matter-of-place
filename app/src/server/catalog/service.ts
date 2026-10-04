import type { Market } from "../../domain/market";
import type { Property, PropertyCard } from "../../domain/property";
import type { Story } from "../../domain/story";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { getCatalog } from "../public/state";

// Every function filters the memoised mapped snapshot in memory (invariant 15), so a list or a detail
// costs no query. The same memo serves search and concierge.

function bySlug<T extends { slug: string }>(rows: readonly T[], slug: string): T {
  const row = rows.find((candidate) => candidate.slug === slug);
  if (row === undefined)
    throw new AppError("not_found", undefined, "There is nothing at this address.");
  return row;
}

export async function listProperties(db: Db): Promise<PropertyCard[]> {
  return (await getCatalog(db)).cards;
}

export async function getProperty(db: Db, slug: string): Promise<Property> {
  return bySlug((await getCatalog(db)).properties, slug);
}

export async function listMarkets(db: Db): Promise<Market[]> {
  return (await getCatalog(db)).markets;
}

export async function getMarket(db: Db, slug: string): Promise<Market> {
  return bySlug((await getCatalog(db)).markets, slug);
}

export async function listStories(db: Db): Promise<Story[]> {
  return (await getCatalog(db)).stories;
}

export async function getStory(db: Db, slug: string): Promise<Story> {
  return bySlug((await getCatalog(db)).stories, slug);
}
