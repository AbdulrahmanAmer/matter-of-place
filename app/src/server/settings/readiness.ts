import { siteFieldSpecs } from "../../domain/settings.ts";
import type { Db } from "../lib/db.ts";
import { getSiteSettings } from "./service.ts";

/** The keys of the required identity fields still unset, in screen 24's order; empty when the site may launch. */
export async function siteReadiness(db: Db): Promise<string[]> {
  const site = await getSiteSettings(db);
  const unset = new Set(
    Object.entries(site).flatMap(([group, leaves]) =>
      Object.entries(leaves).flatMap(([field, value]) =>
        value === null ? [`${group}.${field}`] : [],
      ),
    ),
  );
  return siteFieldSpecs
    .filter((spec) => spec.required && unset.has(spec.key))
    .map((spec) => spec.key);
}
