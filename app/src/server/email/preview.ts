import { siteConfig } from "../../config/site.ts";
import { sampleVariables, type EmailTemplateKey } from "../../domain/email.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { loadSiteContext } from "./context.ts";
import { renderTemplate, type RenderedEmail } from "./render.ts";
import { entityData, resolveVariables, type EntityKind } from "./variables.ts";

// Rendering is not an outside call, so the Worker may do it; nothing in this file imports the Resend client or sends
// mail (invariant 10), and a grep of the file for that client's name finds nothing.

/**
 * The email of the stored row `key`, as `send_email` would build it: with the variables of `entity` when one is given,
 * else with the sample variables. `variables` are applied on top of either (a decline preview that shows the reason
 * the admin has just picked). `SITE_URL` is a function secret the Worker does not hold, so links are built on the public
 * origin of `src/config/site.ts`.
 */
export async function previewTemplate(
  db: Db,
  input: {
    key: EmailTemplateKey;
    variables?: Record<string, string>;
    entity?: { kind: EntityKind; id: string };
  },
): Promise<RenderedEmail> {
  const { key, variables, entity } = input;
  const result = await db
    .from("email_templates")
    .select("key, subject, preheader, body")
    .eq("key", key)
    .limit(1);
  const row = result.data?.[0];
  if (result.error !== null || row === undefined) {
    throw new AppError("not_found", undefined, "There is no such template.");
  }
  const site = await loadSiteContext(db, siteConfig.url);
  const base =
    entity === undefined
      ? sampleVariables(key, site.siteUrl)
      : await resolveVariables(db, key, entityData(entity.kind, entity.id), undefined, site);
  return renderTemplate(row, { ...base, ...variables }, site);
}
