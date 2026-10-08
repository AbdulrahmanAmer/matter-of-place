import { z } from "zod";
import { readSettings } from "../email/context.ts";
import { classifyResendError } from "../email/resend-errors.ts";
import { NonRetryableError } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { liveSideEffects, readVar } from "../lib/runtime-env.ts";

// The Resend adapter for audiences, contacts, broadcasts and domain tracking (R32): the only file that calls those
// endpoints. Names and calls as the current documentation and a probe of the mop-dev account found them on
// 2026-10-07 (docs/runbooks/newsletter.md): Audiences are now Segments, a contact is one global record that sits in
// any number of segments, and a broadcast is addressed with `segment_id`. Everything this adapter calls an
// "audience" is a Resend segment. Errors are classified through B5's `classifyResendError` over `RESEND_ERRORS`
// (INT-11). Every variable is read on each call through `readVar`, because the job runner has no `env.ts` (G39).

const ENDPOINT = "https://api.resend.com";
const USER_AGENT = "matter-of-place/1";
const TIMEOUT_MS = 20_000;
const PRODUCTION_ORIGIN = "https://matterofplace.com";

/** The domain `RESEND_FROM_BULK` sends from (ruling H29): the one domain whose click tracking Place Notes needs. */
export const BULK_DOMAIN = "notes.matterofplace.com";

/** A 429 or a locked resource: the caller returns `retry_at` at `retryAt`. */
export class RateLimited extends Error {
  readonly retryAt: Date;

  constructor(reason: string, retryAt: Date) {
    super(`resend_${reason}`);
    this.name = "RateLimited";
    this.retryAt = retryAt;
  }
}

/** A refusal no retry can fix (a 4xx without a more specific class, or a fatal name of `RESEND_ERRORS`). */
class Invalid extends NonRetryableError {}

/** 404: the object is not there. */
export class NotFound extends Invalid {}

/** 409 or `invalid_idempotent_request`: Resend already holds this request, so the caller asks what it holds. */
export class Conflict extends Error {}

/** A 5xx, an unnamed server fault or a network failure: the job runner backs off and tries again. */
export class Transient extends Error {}

const idAnswer = z.object({ id: z.string().min(1) }).passthrough();
const segmentList = z
  .object({ data: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()) })
  .passthrough();
const contact = z
  .object({ id: z.string(), email: z.string(), unsubscribed: z.boolean() })
  .passthrough();
const contactList = z.object({ data: z.array(contact) }).passthrough();
const idList = z
  .object({ data: z.array(z.object({ id: z.string() }).passthrough()) })
  .passthrough();
const broadcast = z.object({ id: z.string(), status: z.string() }).passthrough();
const tracking = z
  .object({
    id: z.string(),
    name: z.string(),
    click_tracking: z.boolean().optional(),
    open_tracking: z.boolean().optional(),
  })
  .passthrough();
const trackingList = z.object({ data: z.array(tracking) }).passthrough();
const resendSettings = z.object({ audiences: z.record(z.string(), z.string()) }).passthrough();

export interface ResendContact {
  id: string;
  email: string;
  unsubscribed: boolean;
}

export interface BroadcastInput {
  audienceId: string;
  from: string;
  replyTo: string;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  headers?: Record<string, string> | undefined;
}

export interface DomainTracking {
  click: boolean;
  open: boolean;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function refusal(status: number, body: unknown, headers: Headers): Error {
  const outcome = classifyResendError(status, body, headers, new Date());
  switch (outcome.kind) {
    case "retry_at":
      return new RateLimited(outcome.reason, outcome.at);
    case "retry":
      return new Transient(`resend_status_${String(status)}`);
    case "already_sent":
      return new Conflict("invalid_idempotent_request");
    case "fatal":
      if (status === 404) return new NotFound(outcome.code);
      if (status === 409) return new Conflict(outcome.code);
      return new Invalid(outcome.code);
  }
}

/** One call: the parsed JSON body of a 2xx answer, else the typed error of the refusal. */
async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const key = readVar("RESEND_API_KEY");
  if (key === undefined || key === "") throw new NonRetryableError("resend_not_configured");
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "user-agent": USER_AGENT,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Transient("resend_network", { cause: error });
  }
  const parsed = parseJson(await response.text());
  if (!response.ok) throw refusal(response.status, parsed, response.headers);
  return parsed;
}

function answer<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error("resend_answer_unreadable");
  return parsed.data;
}

const dryId = (): string => `dry_${crypto.randomUUID()}`;

/** A 404 is an answer, not a failure, for a lookup or a removal: `fallback` instead of a thrown `NotFound`. */
async function orElse<T>(request: Promise<T>, fallback: T): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof NotFound) return fallback;
    throw error;
  }
}

/** Resend object names of this environment: `mop-dev` and production share one account, so dev gets a prefix. */
const audienceName = (key: string): string =>
  readVar("SITE_URL")?.replace(/\/+$/, "") === PRODUCTION_ORIGIN ? key : `dev-${key}`;

/**
 * The Resend id of the audience `key` (`place-notes`, `market-ca`, ...): the id kept in `settings.resend.audiences`,
 * else the segment of that name already in the account (a crash between create and store), else a new one. The id is
 * stored through `newsletter_set_audience`. Without live sends it makes no call, writes nothing and answers a
 * `dry_` id.
 */
export async function ensureAudience(db: Db, key: string): Promise<string> {
  const settings = await readSettings(db, ["resend"]);
  const stored = resendSettings.safeParse(settings.get("resend")).data?.audiences[key];
  if (stored !== undefined) return stored;
  if (!liveSideEffects("email")) return dryId();
  const name = audienceName(key);
  const listed = answer(segmentList, await call("GET", "/segments")).data.find(
    (segment) => segment.name === name,
  );
  const id = listed?.id ?? answer(idAnswer, await call("POST", "/segments", { name })).id;
  const { error } = await db.rpc("newsletter_set_audience", { p_key: key, p_audience_id: id });
  if (error !== null) throw new Error(`audience_store_failed:${error.code}`);
  return id;
}

/** Every contact of the audience, unsubscribed ones included. Without live sends: none. */
export async function listContacts(audienceId: string): Promise<ResendContact[]> {
  if (!liveSideEffects("email")) return [];
  return answer(contactList, await call("GET", `/segments/${audienceId}/contacts`)).data;
}

/**
 * Puts `email` into the audience and answers the contact. Resend's `POST /contacts` on an address it already holds
 * marks that contact subscribed again, even when it unsubscribed (probed 2026-10-07), so an existing contact is only
 * added to the segment and keeps its `unsubscribed` flag; `updateContact` is the one call that clears it.
 */
export async function addContact(
  audienceId: string,
  { email }: { email: string },
): Promise<{ id: string; unsubscribed: boolean }> {
  if (!liveSideEffects("email")) return { id: dryId(), unsubscribed: false };
  const existing = await orElse(
    call("GET", `/contacts/${encodeURIComponent(email)}`).then((body) => answer(contact, body)),
    null,
  );
  if (existing !== null) {
    await call("POST", `/contacts/${existing.id}/segments/${audienceId}`);
    return { id: existing.id, unsubscribed: existing.unsubscribed };
  }
  const created = answer(
    idAnswer,
    await call("POST", "/contacts", { email, unsubscribed: false, segments: [{ id: audienceId }] }),
  );
  return { id: created.id, unsubscribed: false };
}

/**
 * Takes the contact out of the audience. Contacts are global, so a contact left in no segment is deleted as well
 * (forgetting, B3 GP-01). Answers false when it was not in the audience.
 */
export async function removeContact(audienceId: string, idOrEmail: string): Promise<boolean> {
  if (!liveSideEffects("email")) return true;
  const who = encodeURIComponent(idOrEmail);
  const wasMember = await orElse(
    call("DELETE", `/contacts/${who}/segments/${audienceId}`).then(() => true),
    false,
  );
  const segments = await orElse(
    call("GET", `/contacts/${who}/segments`).then((body) => answer(idList, body).data),
    null,
  );
  if (segments?.length === 0) await deleteContact(idOrEmail);
  return wasMember;
}

/** Deletes the contact from the account. Answers false when it was already gone. */
export async function deleteContact(idOrEmail: string): Promise<boolean> {
  if (!liveSideEffects("email")) return true;
  return orElse(
    call("DELETE", `/contacts/${encodeURIComponent(idOrEmail)}`).then(() => true),
    false,
  );
}

/** Sets the contact's account-wide `unsubscribed` flag: the contact is global, so no audience is named. */
export async function updateContact(
  id: string,
  { unsubscribed }: { unsubscribed: boolean },
): Promise<void> {
  if (!liveSideEffects("email")) return;
  await call("PATCH", `/contacts/${id}`, { unsubscribed });
}

/** Creates a draft broadcast and answers its id; nothing is sent until `sendBroadcast`. */
export async function createBroadcast(input: BroadcastInput): Promise<string> {
  if (!liveSideEffects("email")) return dryId();
  const created = await call("POST", "/broadcasts", {
    segment_id: input.audienceId,
    from: input.from,
    reply_to: input.replyTo,
    subject: input.subject,
    preview_text: input.preheader,
    html: input.html,
    text: input.text,
    ...(input.headers === undefined ? {} : { headers: input.headers }),
  });
  return answer(idAnswer, created).id;
}

/** Starts the send of a draft broadcast and answers its id. */
export async function sendBroadcast(id: string): Promise<string> {
  if (!liveSideEffects("email")) return dryId();
  return answer(idAnswer, await call("POST", `/broadcasts/${id}/send`, {})).id;
}

/** The broadcast's status (`draft`, `queued`, `scheduled`, `sending`, `sent`). A dry id is always a `draft`. */
export async function getBroadcast(id: string): Promise<{ id: string; status: string }> {
  if (!liveSideEffects("email") || id.startsWith("dry_")) return { id, status: "draft" };
  const { status } = answer(broadcast, await call("GET", `/broadcasts/${id}`));
  return { id, status };
}

async function bulkDomain(): Promise<z.infer<typeof tracking>> {
  const domain = answer(trackingList, await call("GET", "/domains")).data.find(
    (entry) => entry.name === BULK_DOMAIN,
  );
  if (domain === undefined) throw new NotFound(`domain_missing:${BULK_DOMAIN}`);
  return domain;
}

/** Click and open tracking of the bulk sender's domain, as Resend holds them. Null without live sends. */
export async function getDomainTracking(): Promise<DomainTracking | null> {
  if (!liveSideEffects("email")) return null;
  const domain = await bulkDomain();
  return { click: domain.click_tracking === true, open: domain.open_tracking === true };
}

/** Sets click and open tracking of the bulk sender's domain. Null without live sends. */
export async function setDomainTracking({
  click,
  open,
}: DomainTracking): Promise<DomainTracking | null> {
  if (!liveSideEffects("email")) return null;
  const domain = await bulkDomain();
  await call("PATCH", `/domains/${domain.id}`, { click_tracking: click, open_tracking: open });
  return { click, open };
}
