import { z } from "zod";
import type { Property } from "../../domain/property";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { checkPreviewSignature, verifyPreview } from "../lib/preview-token";
import { propertyRowSchema, representativeRowSchema, toProperty } from "../public/mappers";

// The one public read of a draft (B7 invariant 17 f): `GET /api/public/properties/:slug?draft_token=`. The token is
// checked before any database call, then one `preview_property` RPC; every failure is the same 404.

const previewSchema = z.object({
  preview_nonce: z.string(),
  representative: representativeRowSchema.nullable(),
  property: propertyRowSchema,
});

const notFound = () => new AppError("not_found", undefined, "There is nothing at this address.");

/** The draft as the public page will show it, when `token` is a live link to the property now at `slug`. */
export async function getDraftProperty(
  db: Db,
  slug: string,
  token: string,
  key: string | undefined,
): Promise<Property> {
  const propertyId = checkPreviewSignature(key, token, new Date());
  if (propertyId === null) throw notFound();
  const { data, error } = await db.rpc("preview_property", { p_property_id: propertyId });
  // An incomplete draft does not parse: the page shows it once its facts are filled.
  const parsed = previewSchema.safeParse(data);
  if (error !== null || !parsed.success) throw notFound();
  const { property, representative, preview_nonce: nonce } = parsed.data;
  if (property.slug !== slug || !(await verifyPreview(key, token, nonce))) throw notFound();
  return toProperty(property, representative ?? undefined);
}
