import { emailSettingsSchema } from "../../domain/email.ts";
import {
  addContact,
  ensureAudience,
  listContacts,
  removeContact,
  updateContact,
} from "../channels/resend.ts";
import { readSettings } from "../email/context.ts";
import { allowListed } from "../jobs/steps/send-email.ts";
import { NonRetryableError } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { liveSideEffects, readVar } from "../lib/runtime-env.ts";

// Who is in which Resend audience (B11 invariants 2 and 13, G14, G15). `syncAudience` is the only code that adds or
// removes a contact: right before each broadcast and once a day in the hygiene run. Membership itself is the SQL
// function `newsletter_audience_members`, whose `case` mirrors `MARKET_AUDIENCE`.

export const MARKET_AUDIENCE = {
  california: "market-ca",
  "new-york": "market-ny",
  florida: "market-fl",
} as const;

export type AudienceKey = "place-notes" | (typeof MARKET_AUDIENCE)[keyof typeof MARKET_AUDIENCE];

const isMarket = (slug: string): slug is keyof typeof MARKET_AUDIENCE =>
  Object.hasOwn(MARKET_AUDIENCE, slug);

export interface AudienceSubscriber {
  email: string;
  source: string;
  markets: readonly string[];
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  archived_at: string | null;
}

/**
 * The audiences a subscriber row belongs to by the Inputs rule: confirmed, still subscribed, not archived, not
 * anonymised, and not an interest-only signup (an interest signup is not Place Notes consent). The suppression list is
 * not on the row, so `newsletter_audience_members` also drops suppressed addresses.
 */
export function audiencesFor(subscriber: AudienceSubscriber): AudienceKey[] {
  const { email, source, confirmed_at, unsubscribed_at, archived_at } = subscriber;
  if (confirmed_at === null || unsubscribed_at !== null || archived_at !== null) return [];
  if (email.endsWith(".invalid") || source.startsWith("interest:")) return [];
  return [
    "place-notes",
    ...subscriber.markets.filter(isMarket).map((market) => MARKET_AUDIENCE[market]),
  ];
}

interface Member {
  id: string;
  email: string;
  resend_contact_id: string | null;
}

export type SyncResult =
  { added: number; removed: number; members: number } | { dry_run: true; members: number };

async function membersOf(db: Db, key: AudienceKey): Promise<Member[]> {
  const { data, error } = await db.rpc("newsletter_audience_members", { p_audience: key });
  if (error !== null) throw new Error("newsletter_read_failed:newsletter_audience_members");
  return data;
}

/** Outside production only the addresses of `settings.email.dev_recipients` may join (INT-02). */
async function allowed(db: Db, members: Member[]): Promise<Member[]> {
  if (readVar("MOP_ENV") === "production") return members;
  const share = emailSettingsSchema.safeParse((await readSettings(db, ["email"])).get("email"));
  if (!share.success) throw new NonRetryableError("email_settings_missing");
  const patterns = share.data.dev_recipients;
  return members.filter((member) => allowListed(member.email.toLowerCase(), patterns));
}

async function setContact(db: Db, subscriberId: string, contactId: string): Promise<void> {
  const { error } = await db.rpc("newsletter_set_contact", {
    p_subscriber: subscriberId,
    p_contact_id: contactId,
  });
  if (error !== null) throw new Error("newsletter_write_failed:newsletter_set_contact");
}

async function clearContact(db: Db, contactId: string): Promise<void> {
  const { error } = await db.rpc("newsletter_clear_contact", { p_contact_id: contactId });
  if (error !== null) throw new Error("newsletter_write_failed:newsletter_clear_contact");
}

/**
 * Makes the Resend audience `key` hold exactly its members: adds each member not listed, removes each listed contact
 * that is no longer a member and clears its stored id, and stores a contact id the member row lacks. A listed contact
 * marked unsubscribed whose member row has no id is a person who unsubscribed, was removed, and confirmed again
 * (DL-06), so it is subscribed again; one whose row still holds the id is left alone, as the unsubscribe webhook may
 * not have arrived yet. Without live sends it makes no call and writes nothing. Resend errors throw as the adapter
 * typed them: `RateLimited` for the caller's `retry_at`, `Transient` for the backoff, `NonRetryableError` otherwise.
 */
export async function syncAudience(db: Db, key: AudienceKey): Promise<SyncResult> {
  const members = await allowed(db, await membersOf(db, key));
  if (!liveSideEffects("email")) return { dry_run: true, members: members.length };
  const audienceId = await ensureAudience(db, key);
  const listed = new Map(
    (await listContacts(audienceId)).map((contact) => [contact.email.toLowerCase(), contact]),
  );
  let added = 0;
  for (const member of members) {
    let contact: { id: string; unsubscribed: boolean } | undefined = listed.get(
      member.email.toLowerCase(),
    );
    if (contact === undefined) {
      contact = await addContact(audienceId, { email: member.email });
      added += 1;
    }
    if (member.resend_contact_id !== null) continue;
    if (contact.unsubscribed) await updateContact(contact.id, { unsubscribed: false });
    await setContact(db, member.id, contact.id);
  }
  const wanted = new Set(members.map((member) => member.email.toLowerCase()));
  let removed = 0;
  for (const [email, contact] of listed) {
    if (wanted.has(email)) continue;
    await removeContact(audienceId, contact.id);
    await clearContact(db, contact.id);
    removed += 1;
  }
  return { added, removed, members: members.length };
}

export interface SubscriberCounts {
  total: number;
  confirmed: number;
  pending: number;
  unsubscribed: number;
  interest_only: number;
  audiences: Record<AudienceKey, number>;
}

/** Screen 13's counts: each state, interest-only signups and each audience by `audiencesFor`; never an address. */
export async function subscriberCounts(db: Db): Promise<SubscriberCounts> {
  const { data, error } = await db
    .from("subscribers")
    .select("email, source, markets, confirmed_at, unsubscribed_at, archived_at")
    .is("archived_at", null);
  if (error !== null) throw new Error("newsletter_read_failed:subscribers");
  const rows = data.filter(({ email }) => !email.endsWith(".invalid"));
  const counts: SubscriberCounts = {
    total: rows.length,
    confirmed: 0,
    pending: 0,
    unsubscribed: 0,
    interest_only: 0,
    audiences: { "place-notes": 0, "market-ca": 0, "market-ny": 0, "market-fl": 0 },
  };
  for (const row of rows) {
    if (row.unsubscribed_at !== null) counts.unsubscribed += 1;
    else if (row.confirmed_at !== null) counts.confirmed += 1;
    else counts.pending += 1;
    if (row.source.startsWith("interest:")) counts.interest_only += 1;
    for (const key of audiencesFor(row)) counts.audiences[key] += 1;
  }
  return counts;
}

/** How many subscribers left after `from` and before `until` (no end when null): an issue's unsubscribes. */
export async function unsubscribedBetween(
  db: Db,
  from: string,
  until: string | null,
): Promise<number> {
  const { data, error } = await db
    .from("subscribers")
    .select("unsubscribed_at")
    .gt("unsubscribed_at", from);
  if (error !== null) throw new Error("newsletter_read_failed:subscribers");
  return data.filter(({ unsubscribed_at }) => until === null || (unsubscribed_at ?? "") < until)
    .length;
}
