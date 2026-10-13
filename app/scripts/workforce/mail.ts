// W4 (operator, 2026-10-13): replies to the email we send, read from the Zoho mailbox (hello@ is an alias of admin@)
// every five minutes by the laptop daemon. Only a reply from someone we wrote to is kept; `email_reply_record` matches
// it to the send it answers and hands it to the colleague who owns that thread as a fenced system line (never a
// person's, so it never gives full power, ruling H101). The Zoho names are read from the workspace `.env` into this
// module only, never into process.env, so no Claude child can see them. Values are never printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Db } from "../../src/server/lib/db.ts";

const EVERY_MS = 5 * 60_000;
const FIRST_LOOK_MS = 3 * 86_400_000;
const PAGE = 50;
const OWN_DOMAIN = "matterofplace.com";

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
  folderType: z.string().optional(),
});
const messageSchema = z.object({
  messageId: z.union([z.string(), z.number()]),
  folderId: z.union([z.string(), z.number()]).optional(),
  receivedTime: z.union([z.string(), z.number()]),
  fromAddress: z.string().default(""),
  sender: z.string().default(""),
  subject: z.string().default(""),
});
const contentSchema = z.object({ content: z.string().default("") });

async function accessToken(names: Names): Promise<string> {
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

async function zoho(access: string, path: string): Promise<unknown> {
  const answer = await fetch(`https://mail.zoho.com/api${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${access}` },
  });
  const parsed = statusSchema.safeParse(await answer.json());
  if (!parsed.success || parsed.data.status.code !== 200)
    throw new Error(`mail: Zoho answered ${String(answer.status)} for ${path.split("?")[0] ?? ""}`);
  return parsed.data.data;
}

// ---------- the pass ----------

interface Cursor {
  at: number;
  checked: number;
}

function readCursor(file: string, now: number): Cursor {
  try {
    const value = z
      .object({ at: z.number(), checked: z.number() })
      .parse(JSON.parse(readFileSync(file, "utf8")));
    return value;
  } catch {
    // first run: look back three days, so a reply from today is not missed; a reply is recorded once (provider_id).
    return { at: now - FIRST_LOOK_MS, checked: 0 };
  }
}

/** One look at the inbox, at most every five minutes. Returns how many replies were recorded. */
export async function checkMail(client: Db, home: string, now = Date.now()): Promise<number> {
  const file = join(home, "mail.json");
  const cursor = readCursor(file, now);
  if (now - cursor.checked < EVERY_MS) return 0;
  const names = zohoNames();
  if (names === null) return 0;
  writeFileSync(file, JSON.stringify({ ...cursor, checked: now }));
  const access = await accessToken(names);
  const accounts = z.array(accountSchema).parse(await zoho(access, "/accounts"));
  const account =
    accounts.find((row) => row.primaryEmailAddress === `admin@${OWN_DOMAIN}`) ?? accounts[0];
  if (account === undefined) return 0;
  const id = String(account.accountId);
  const folders = z.array(folderSchema).parse(await zoho(access, `/accounts/${id}/folders`));
  const inbox = folders.find((folder) => folder.folderType === "Inbox");
  if (inbox === undefined) return 0;
  const folder = String(inbox.folderId);
  const list = z
    .array(messageSchema)
    .parse(
      await zoho(
        access,
        `/accounts/${id}/messages/view?folderId=${folder}&limit=${String(PAGE)}&sortorder=false`,
      ),
    );
  const fresh = list
    .map((row) => ({ ...row, received: Number(row.receivedTime) }))
    .filter((row) => row.received > cursor.at)
    .sort((a, b) => a.received - b.received);
  let recorded = 0;
  let newest = cursor.at;
  for (const row of fresh) {
    newest = Math.max(newest, row.received);
    const from = addressOf(row.fromAddress);
    if (isAutomatic(row.fromAddress, row.subject)) continue;
    // Only someone we wrote to: the content of anyone else's mail is never fetched.
    const { count } = await client
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .eq("to_email", from);
    if ((count ?? 0) === 0) continue;
    const content = contentSchema.parse(
      await zoho(
        access,
        `/accounts/${id}/folders/${String(row.folderId ?? folder)}/messages/${String(row.messageId)}/content`,
      ),
    );
    const { data, error } = await client.rpc("email_reply_record", {
      p_provider_id: String(row.messageId),
      p_from: from,
      p_name: row.sender,
      p_subject: row.subject,
      p_body: withoutQuoted(plainText(content.content)).slice(0, 6000),
      p_received_at: new Date(row.received).toISOString(),
    });
    if (error !== null) throw new Error("mail: a reply could not be recorded");
    if (data !== null) recorded += 1;
  }
  writeFileSync(file, JSON.stringify({ at: newest, checked: now }));
  return recorded;
}
