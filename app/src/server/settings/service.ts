import { siteSettingsSchema, type PublicSite, type SiteSettings } from "../../domain/settings.ts";
import type { Database } from "../../db/index.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { ActorKind } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { fromZod } from "../lib/errors.ts";
import { getPublicState } from "../public/state.ts";

// `settings.site` (B16). Reads go through the public state the Worker already shares, never the table
// (architecture 13 rule 1); the one write is `settings_put_site`, whose caller checks the matrix action
// `settings.site_put` (B7's `defineAdminRoute`) or is the operator's script. The job runner loads this file.

type PutSiteArgs = Database["public"]["Functions"]["settings_put_site"]["Args"];
interface NullableArgs {
  p_actor: string | null;
  p_request_id: string | null;
}

/** Who writes `settings.site`, as the audit row records it: no person for the operator's script. */
export interface SiteWriter {
  id: string | null;
  kind: ActorKind;
  note: string;
}

/** The stored identity, every leaf present (null when unset). */
export async function getSiteSettings(db: Db): Promise<SiteSettings> {
  return siteSettingsSchema.parse((await getPublicState(db)).site);
}

/**
 * The body of `GET /api/public/site`: one state read gives both parts. `illustrativeContent` is forced false
 * when `MOP_ENV` is production (F26 c, invariant 6), as `applyVisibility` does for the catalog: the one database
 * says `development` until the launch switch, and the production Worker reads it. The environment is the route's.
 */
export async function getPublicSite(
  db: Db,
  _input: undefined,
  ctx: { env: { MOP_ENV: string } },
): Promise<PublicSite> {
  const state = await getPublicState(db);
  return {
    ...siteSettingsSchema.parse(state.site),
    illustrativeContent: state.illustrativeContent && ctx.env.MOP_ENV !== "production",
  };
}

/**
 * Replaces `settings.site` with `input` after the schema check. Throws 422 `validation` with the Zod issues,
 * or the `AppError` of the function's error. A failed call changes nothing; the same value again is harmless.
 */
export async function applySiteSettings(db: Db, input: unknown, writer: SiteWriter): Promise<void> {
  const parsed = siteSettingsSchema.safeParse(input);
  if (!parsed.success) throw fromZod(parsed.error);
  const args: Omit<PutSiteArgs, "p_actor" | "p_request_id"> & NullableArgs = {
    p_value: parsed.data,
    p_actor: writer.id,
    p_actor_kind: writer.kind,
    p_request_id: null,
    p_note: writer.note,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- generated types mark no function argument nullable; settings_put_site stores a null actor and request id as the audit row's
  const { error } = await db.rpc("settings_put_site", args as PutSiteArgs);
  if (error !== null) throw fromRpcError(error);
}
