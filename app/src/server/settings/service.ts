import { dailyLimitsSchema } from "../../domain/admin-team.ts";
import {
  notificationsPutInput,
  type NotificationsInput,
  type SettingsAnswer,
} from "../../domain/admin-settings.ts";
import { invoiceSettingsSchema } from "../../domain/payments.ts";
import {
  emptySiteSettings,
  siteSettingsSchema,
  type PublicSite,
  type SiteSettings,
} from "../../domain/settings.ts";
import type { Database, Json } from "../../db/index.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { auditContext } from "../lib/audit.ts";
import { authorize, type ActorKind } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { fromZod } from "../lib/errors.ts";
import {
  applyInvoiceSettings,
  invoiceReadiness,
  type InvoiceSettings,
} from "../payments/invoice-settings.ts";
import { getPublicState } from "../public/state.ts";
import { siteReadiness } from "./readiness.ts";

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
  /** The request that made the change; the operator's script has none. */
  requestId?: string;
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
    p_request_id: writer.requestId ?? null,
    p_note: writer.note,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- generated types mark no function argument nullable; settings_put_site stores a null actor and request id as the audit row's
  const { error } = await db.rpc("settings_put_site", args as PutSiteArgs);
  if (error !== null) throw fromRpcError(error);
}

// Screen 24 (B7 step 15). Every function checks its matrix action first (admin, people only, a recent sign-in);
// the identity and invoice writes go through B16 and B6, the other two keys through `put_setting`, which audits.

const SCREEN_NOTE = "admin: settings";
const SETTINGS_KEYS = [
  "site",
  "invoice",
  "coming_soon_global",
  "notifications",
  "agent_daily_limits",
];

/** `GET settings`: the five keys in one select, and the readiness list of B16 and B6 with each name once. */
export async function getSettings(actor: AdminActor, db: Db): Promise<SettingsAnswer> {
  authorize(actor, "settings.get");
  const { data, error } = await db.from("settings").select("key, value").in("key", SETTINGS_KEYS);
  if (error !== null) throw fromRpcError(error);
  const valueOf = (key: string): unknown => data.find((row) => row.key === key)?.value;
  const site = siteSettingsSchema.safeParse(valueOf("site")).data ?? emptySiteSettings;
  const invoice = invoiceSettingsSchema.safeParse(valueOf("invoice")).data ?? null;
  const readiness = [...(await siteReadiness(db)), ...invoiceReadiness(site, invoice)];
  return {
    site,
    invoice,
    coming_soon_global: valueOf("coming_soon_global") === true,
    notifications: notificationsPutInput.safeParse(valueOf("notifications")).data ?? {
      recipients: [],
    },
    agent_daily_limits: dailyLimitsSchema.safeParse(valueOf("agent_daily_limits")).data ?? null,
    readiness: [...new Set(readiness)],
  };
}

/** `PUT settings/site`: B16's write, audited by `settings_put_site` as `settings.site_put`. */
export async function putSite(
  actor: AdminActor,
  db: Db,
  input: SiteSettings,
): Promise<SiteSettings> {
  authorize(actor, "settings.site_put");
  await applySiteSettings(db, input, {
    id: actor.userId,
    kind: actor.kind,
    requestId: actor.requestId,
    note: SCREEN_NOTE,
  });
  return input;
}

/** `PUT settings/invoice`: B6's write, one `settings_put_invoice` call that audits `settings.invoice_put` (G26). */
export async function putInvoice(
  actor: AdminActor,
  db: Db,
  input: unknown,
): Promise<InvoiceSettings> {
  authorize(actor, "settings.invoice_put");
  return applyInvoiceSettings(db, input, {
    id: actor.userId,
    kind: actor.kind,
    requestId: actor.requestId,
    note: SCREEN_NOTE,
  });
}

async function putSetting(actor: AdminActor, db: Db, key: string, value: Json): Promise<void> {
  const { error } = await db.rpc("put_setting", {
    p_key: key,
    p_value: value,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
}

/** `PUT settings/coming-soon`: a public key, so B2's trigger raises `catalog_version` in the same transaction. */
export async function putComingSoon(
  actor: AdminActor,
  db: Db,
  input: { coming_soon_global: boolean },
): Promise<{ coming_soon_global: boolean }> {
  authorize(actor, "settings.coming_soon_put");
  await putSetting(actor, db, "coming_soon_global", input.coming_soon_global);
  return input;
}

/** `PUT settings/notifications`: the admin alert list; an admin-only key, so the catalog stays as it is (G21). */
export async function putNotifications(
  actor: AdminActor,
  db: Db,
  input: NotificationsInput,
): Promise<NotificationsInput> {
  authorize(actor, "settings.notifications_put");
  await putSetting(actor, db, "notifications", input);
  return input;
}
