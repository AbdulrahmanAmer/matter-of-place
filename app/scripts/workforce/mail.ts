// W4 (operator, 2026-10-13): replies to the email we send, read from the Zoho mailbox (hello@ is an alias of admin@)
// every five minutes by the laptop daemon. A reply from someone we wrote to is matched by `email_reply_record` to the
// send it answers and handed to the colleague who owns that thread as a fenced system line (never a person's, so it
// never gives full power, ruling H101). W8 0h (operator, 2026-10-16: "the company and Matter should be able to see all
// emails"): every other message of every folder but Drafts, Templates, Sent, Trash and Outbox is recorded once in
// `inbound_mail` (inbound-mail.ts): a person's goes to its owner as a triage, a service's to Matter as a notice, spam
// and bulk are kept for a person. A folder that cannot be read is named in the log and in `ops_health`
// (`mail_folders`). The Zoho names are read from the workspace `.env` into this module only, never into process.env,
// so no Claude child can see them. Values, senders, subjects and bodies are never printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Db } from "../../src/server/lib/db.ts";
import { inboundRecord, recordInbound } from "./inbound-mail.ts";
import { isReportName, MAX_COMPRESSED } from "./mail-reports.ts";
import { sortMessage, type Attachment } from "./service-notice.ts";

const EVERY_MS = 5 * 60_000;
const FIRST_LOOK_MS = 3 * 86_400_000;
const PAGE = 50;
/** At most this many pages listed to reach a folder's cursor; a folder with more new mail is named and not moved. */
const MAX_PAGES = 40;
/** At most this many new messages of one folder are read a check, oldest first; the rest wait for the next check. */
export const PER_CHECK = 100;
const OWN_DOMAIN = "matterofplace.com";
/** The folders that are not mail sent to us (W8 0h); Sent is our own mail, already in `email_messages`. */
export const SKIPPED_FOLDERS = ["Drafts", "Templates", "Sent", "Trash", "Outbox"] as const;

// ---------- what a message says (pure, tested in tests/unit/workforce-mail.test.ts) ----------

/** The address inside `Name <a@b>` or a bare address, lower-cased; empty when there is none. */
export function addressOf(raw: string): string {
  const match = /<([^<>\s]+@[^<>\s]+)>/.exec(raw) ?? /([^\s<>"]+@[^\s<>"]+)/.exec(raw);
  return (match?.[1] ?? "").toLowerCase();
}

/** An automatic message (a bounce, an out-of-office, a no-reply sender, our own mail) is never a reply to keep. */
export function isAutomatic(from: string, subject: string): boolean {
  const address = addressOf(from);
  const local = address.split("@")[0] ?? "";
  if (address === "" || address.endsWith(`@${OWN_DOMAIN}`)) return true;
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?)([+.-]|$)/i.test(local))
    return true;
  return /^\s*(automatic reply|auto[- ]?reply|auto:|out of (the )?office|undeliverable|undelivered|delivery status notification|mail delivery failed)/i.test(
    subject,
  );
}

/** The text of an HTML body, line breaks kept. */
export function plainText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The new words of a reply: the quoted history under it (our own email) is cut. */
export function withoutQuoted(text: string): string {
  const cuts = [
    /(^|\n)[^\n]*On [^\n]{0,200}(\n[^\n]{0,200})?wrote:/,
    /(^|\n)-{2,} ?On .{0,200}wrote ?-{2,}/,
    /(^|\n)-{2,} ?Original Message ?-{2,}/i,
    /(^|\n)From: [^\n]+\n(Sent|Date): /,
    /(^|\n)>/,
  ];
  let end = text.length;
  for (const cut of cuts) {
    const found = cut.exec(text);
    if (found !== null && found.index < end) end = found.index;
  }
  return text.slice(0, end).trim();
}

// ---------- the mailbox ----------

interface Names {
  ZOHO_CLIENT_ID: string;
  ZOHO_CLIENT_SECRET: string;
  ZOHO_REFRESH_TOKEN: string;
}

function zohoNames(): Names | null {
  const file = resolve(import.meta.dir, "../../../.env");
  if (!existsSync(file)) return null;
  const found = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^(ZOHO_CLIENT_ID|ZOHO_CLIENT_SECRET|ZOHO_REFRESH_TOKEN)=(.*)$/.exec(line);
    if (match?.[1] !== undefined)
      found.set(match[1], (match[2] ?? "").replace(/^"(.*)"$/, "$1").trim());
  }
  const names = {
    ZOHO_CLIENT_ID: found.get("ZOHO_CLIENT_ID") ?? "",
    ZOHO_CLIENT_SECRET: found.get("ZOHO_CLIENT_SECRET") ?? "",
    ZOHO_REFRESH_TOKEN: found.get("ZOHO_REFRESH_TOKEN") ?? "",
  };
  return Object.values(names).every((value) => value !== "") ? names : null;
}

const tokenSchema = z.object({ access_token: z.string().min(1) });
const statusSchema = z.object({ status: z.object({ code: z.number() }), data: z.unknown() });
const accountSchema = z.object({
  accountId: z.union([z.string(), z.number()]),
  primaryEmailAddress: z.string().optional(),
});
const folderSchema = z.object({
  folderId: z.union([z.string(), z.number()]),
  folderName: z.string().default(""),
  folderType: z.string().optional(),
});
// Zoho's message ids pass 2^53: the list gives them as strings (a number would come back rounded and name another
// message, measured 2026-10-16: the content call answers `messageId` as a number ending 153300 for ...153400), so a
// numeric id fails the parse and the folder is named unread rather than misread.
const messageSchema = z.object({
  messageId: z.string().regex(/^\d{1,30}$/),
  receivedTime: z.union([z.string(), z.number()]),
  fromAddress: z.string().default(""),
  sender: z.string().default(""),
  subject: z.string().default(""),
  hasAttachment: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
const contentSchema = z.object({ content: z.string().default("") });
// Measured on the real mailbox, 2026-10-16: `.../messages/<m>/header?raw=true` answers `{ headerContent }`, the raw
// header block with Zoho's own `Authentication-Results` above the message's headers; `.../attachmentinfo` answers
// `{ attachments: [{ attachmentId, attachmentName, attachmentSize }] }`; `.../attachments/<a>` answers the bytes.
const headerSchema = z.object({ headerContent: z.string().default("") });
const attachmentInfoSchema = z.object({
  attachments: z
    .array(
      z.object({
        attachmentId: z.union([z.string(), z.number()]),
        attachmentName: z.string().max(300),
        attachmentSize: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .default([]),
});

/** The network, as the pass reaches it (the tests give their own). */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function accessToken(names: Names, fetch: Fetch): Promise<string> {
  // Zoho refuses more than a few refreshes in ten minutes ("Access Denied", P-4501): one token serves a whole check.
  const answer = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: names.ZOHO_CLIENT_ID,
      client_secret: names.ZOHO_CLIENT_SECRET,
      refresh_token: names.ZOHO_REFRESH_TOKEN,
    }),
  });
  const parsed = tokenSchema.safeParse(await answer.json());
  if (!parsed.success) throw new Error("mail: the Zoho token could not be refreshed");
  return parsed.data.access_token;
}

/** One call to the Mail API: its `data`, or an error naming the path without its query. */
function zohoClient(access: string, fetch: Fetch) {
  const call = (path: string) =>
    fetch(`https://mail.zoho.com/api${path}`, {
      headers: { Authorization: `Zoho-oauthtoken ${access}` },
    });
  return {
    async json(path: string): Promise<unknown> {
      const answer = await call(path);
      const parsed = statusSchema.safeParse(await answer.json());
      if (!parsed.success || parsed.data.status.code !== 200)
        throw new Error(
          `mail: Zoho answered ${String(answer.status)} for ${path.split("?")[0] ?? ""}`,
        );
      return parsed.data.data;
    },
    /** An attachment's bytes, refused past MAX_COMPRESSED before or after reading. */
    async file(path: string): Promise<Buffer> {
      const answer = await call(path);
      const length = Number(answer.headers.get("content-length") ?? "0");
      if (!answer.ok || length > MAX_COMPRESSED) throw new Error("mail: an attachment was refused");
      const bytes = Buffer.from(await answer.arrayBuffer());
      if (bytes.length > MAX_COMPRESSED) throw new Error("mail: an attachment was refused");
      return bytes;
    },
  };
}

type Zoho = ReturnType<typeof zohoClient>;

// ---------- the pass ----------

/** When the mailbox was last checked, and per folder the time up to which every message was handled (ms). */
type Cursor = { checked: number; at: number; folders: Record<string, number> };

function readCursor(file: string, now: number): Cursor {
  try {
    const value = z
      .object({
        at: z.number(),
        checked: z.number(),
        folders: z.record(z.string(), z.number()).default({}),
      })
      .parse(JSON.parse(readFileSync(file, "utf8")));
    return value;
  } catch {
    // first run: look back three days, so a message from today is not missed; each is recorded once (provider_id).
    return { at: now - FIRST_LOOK_MS, checked: 0, folders: {} };
  }
}

/** The folders a check reads: every folder of the mailbox but those that hold no mail sent to us (W8 0h). */
export function foldersToRead<F extends { folderType?: string | undefined }>(
  folders: readonly F[],
): F[] {
  return folders.filter(
    (folder) => !(SKIPPED_FOLDERS as readonly string[]).includes(folder.folderType ?? ""),
  );
}

/** The ids of these messages either table already holds, so a message is never fetched or recorded twice. */
async function knownIds(client: Db, ids: readonly string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    const [inbound, replies] = await Promise.all([
      client.from("inbound_mail").select("provider_id").in("provider_id", chunk),
      client.from("email_replies").select("provider_id").in("provider_id", chunk),
    ]);
    if (inbound.error !== null || replies.error !== null)
      throw new Error("mail: the recorded messages could not be read");
    for (const row of [...inbound.data, ...replies.data]) known.add(row.provider_id);
  }
  return known;
}

type Listed = z.infer<typeof messageSchema> & { received: number };

/**
 * A folder's messages newer than its cursor, oldest first. The list call takes no date, and its oldest-first order
 * starts at the folder's first message, so the pass lists newest first until it meets the cursor (or the folder's
 * end); `reached` is false when MAX_PAGES did not get there, and then nothing of the folder is read (W8 0h review).
 */
async function newMessages(
  zoho: Zoho,
  account: string,
  folder: string,
  since: number,
): Promise<{ rows: Listed[]; reached: boolean }> {
  const rows: Listed[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const list = z
      .array(messageSchema)
      .parse(
        await zoho.json(
          `/accounts/${account}/messages/view?folderId=${folder}&start=${String(page * PAGE + 1)}&limit=${String(PAGE)}&sortorder=false`,
        ),
      )
      .map((row) => ({ ...row, received: Number(row.receivedTime) }));
    rows.push(...list.filter((row) => row.received > since));
    if (list.length < PAGE || list.some((row) => row.received <= since))
      return { rows: rows.sort((a, b) => a.received - b.received), reached: true };
  }
  return { rows: [], reached: false };
}

/**
 * Where a folder's cursor may stand once `rows[index]` (oldest first) was handled: at its time, or one millisecond
 * before the next message when that one shares the time, so a message is never passed over unread.
 */
function cursorAfter(rows: readonly { received: number }[], index: number): number {
  const here = rows[index]?.received ?? 0;
  const next = rows[index + 1]?.received;
  return next === undefined ? here : Math.min(here, next - 1);
}

/** A message's attachments: names always, bytes only for a report a service notice may carry. */
async function attachmentsOf(zoho: Zoho, base: string, wanted: boolean): Promise<Attachment[]> {
  const info = attachmentInfoSchema.parse(await zoho.json(`${base}/attachmentinfo`));
  const out: Attachment[] = [];
  for (const attachment of info.attachments.slice(0, 50)) {
    const name = attachment.attachmentName;
    if (!wanted || !isReportName(name)) {
      out.push({ name, file: null, refused: "not read" });
      continue;
    }
    if (Number(attachment.attachmentSize ?? 0) > MAX_COMPRESSED) {
      out.push({ name, file: null, refused: "the file is larger than the limit" });
      continue;
    }
    const file = await zoho
      .file(`${base}/attachments/${String(attachment.attachmentId)}`)
      .catch(() => null);
    out.push(file === null ? { name, file: null } : { name, file });
  }
  return out;
}

/** What a check did, for the runner's log: counts and folder names only. */
export type MailCheck = { replies: number; inbound: number; unread: string[] };

/**
 * One look at every folder, at most every five minutes. A reply to our email goes to `email_reply_record` as before;
 * every other message is recorded once through `inbound_mail_record`. A folder that cannot be listed or a message that
 * cannot be recorded stops that folder where it is (its cursor stays before it), and the folder is named in the log
 * and in the `mail_folders` beat that `ops_health` reads.
 */
export async function checkMail(
  client: Db,
  home: string,
  now = Date.now(),
  deps: { names: () => Names | null; fetch: Fetch } = { names: zohoNames, fetch },
): Promise<MailCheck> {
  const file = join(home, "mail.json");
  const cursor = readCursor(file, now);
  const done: MailCheck = { replies: 0, inbound: 0, unread: [] };
  if (now - cursor.checked < EVERY_MS) return done;
  const names = deps.names();
  if (names === null) return done;
  writeFileSync(file, JSON.stringify({ ...cursor, checked: now }));
  const beat = async (unread: string[]) => {
    const { error } = await client.rpc("beat", {
      p_name: "mail_folders",
      p_detail: { ok: unread.length === 0, unread },
    });
    if (error !== null) console.log("mail: the mailbox heartbeat was not recorded");
  };
  let zoho: Zoho;
  let id: string;
  let folders: z.infer<typeof folderSchema>[];
  try {
    zoho = zohoClient(await accessToken(names, deps.fetch), deps.fetch);
    const accounts = z.array(accountSchema).parse(await zoho.json("/accounts"));
    const account =
      accounts.find((row) => row.primaryEmailAddress === `admin@${OWN_DOMAIN}`) ?? accounts[0];
    if (account === undefined) throw new Error("mail: the mailbox has no account");
    id = String(account.accountId);
    folders = z.array(folderSchema).parse(await zoho.json(`/accounts/${id}/folders`));
  } catch (failure: unknown) {
    await beat(["the mailbox"]);
    throw failure;
  }
  const next: Cursor = { checked: now, at: cursor.at, folders: { ...cursor.folders } };
  for (const folder of foldersToRead(folders)) {
    const folderId = String(folder.folderId);
    const name = folder.folderName === "" ? (folder.folderType ?? folderId) : folder.folderName;
    // An old cursor knew only the Inbox: it keeps its place; any other folder looks back three days once.
    const since =
      cursor.folders[folderId] ??
      (folder.folderType === "Inbox" && name === "Inbox" ? cursor.at : now - FIRST_LOOK_MS);
    try {
      const { rows, reached } = await newMessages(zoho, id, folderId, since);
      if (!reached) done.unread.push(`${name} (more new mail than one check can list)`);
      // Oldest first, PER_CHECK at most; the cursor moves only over what was handled, so the rest is read next check.
      const batch = rows.slice(0, PER_CHECK);
      const known = await knownIds(
        client,
        batch.map((row) => row.messageId),
      );
      for (const [index, row] of batch.entries()) {
        if (!known.has(row.messageId)) {
          const kind = await oneMessage(client, zoho, id, folderId, folder, name, row);
          if (kind === "reply") done.replies += 1;
          if (kind === "inbound") done.inbound += 1;
        }
        next.folders[folderId] = Math.max(since, cursorAfter(rows, index));
      }
    } catch (failure: unknown) {
      console.log(
        `${new Date().toISOString()} mail: the folder ${name} could not be read (${failure instanceof Error ? failure.message : "unknown"})`,
      );
      done.unread.push(name);
    }
    writeFileSync(file, JSON.stringify(next));
  }
  await beat(done.unread);
  return done;
}

/** One new message: a reply to our email stays on the W4 path; anything else is recorded as inbound mail. */
async function oneMessage(
  client: Db,
  zoho: Zoho,
  account: string,
  folderId: string,
  folder: z.infer<typeof folderSchema>,
  name: string,
  row: Listed,
): Promise<"reply" | "inbound" | "known"> {
  const base = `/accounts/${account}/folders/${folderId}/messages/${row.messageId}`;
  const from = addressOf(row.fromAddress);
  const automatic = isAutomatic(row.fromAddress, row.subject);
  let content: string | null = null;
  const readContent = async () =>
    (content ??= contentSchema.parse(await zoho.json(`${base}/content`)).content);
  if (!automatic && folder.folderType !== "Spam") {
    const { count } = await client
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .eq("to_email", from);
    if ((count ?? 0) > 0) {
      const { data, error } = await client.rpc("email_reply_record", {
        p_provider_id: row.messageId,
        p_from: from,
        p_name: row.sender,
        p_subject: row.subject,
        p_body: withoutQuoted(plainText(await readContent())).slice(0, 6000),
        p_received_at: new Date(row.received).toISOString(),
      });
      if (error !== null) throw new Error("mail: a reply could not be recorded");
      // The function returns null for a reply already recorded or one with no send to answer; the generated type
      // cannot say so. With no send it is not a reply, and it is recorded below as inbound mail.
      if ((data as string | null) !== null) return "reply";
    }
  }
  const header = headerSchema.parse(await zoho.json(`${base}/header?raw=true`)).headerContent;
  const has = row.hasAttachment !== undefined && !["0", 0, false].includes(row.hasAttachment);
  const recorded = inboundRecord({
    providerId: row.messageId,
    folder: { name, type: folder.folderType ?? "" },
    from,
    fromName: row.sender,
    subject: row.subject,
    receivedAt: row.received,
    header,
    content: await readContent(),
    // Report bytes are fetched for every authenticated service's notice, whatever its folder (sortMessage reads the
    // header first); nobody else's attachment is ever opened.
    attachments: has
      ? await attachmentsOf(
          zoho,
          base,
          sortMessage({
            folderType: folder.folderType ?? "",
            folderName: name,
            from,
            subject: row.subject,
            header,
            automatic,
          }).source === "service_notice",
        )
      : [],
    automatic,
  });
  const fresh = await recordInbound(client, recorded);
  if (fresh)
    console.log(
      `${new Date().toISOString()} mail: ${recorded.args.p_source} ${recorded.state} in ${name}`,
    );
  return fresh ? "inbound" : "known";
}
