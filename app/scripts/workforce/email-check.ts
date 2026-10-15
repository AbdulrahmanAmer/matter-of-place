// W9 item 1 (operator, 2026-10-15: "use SMTP for the agents as a small tool call that will check if the emails actually
// exist before we send"): the full address check, run on the laptop runner. The rule is `src/lib/email-check.ts`
// (syntax, typo domain, mail records), here over the system resolver, plus an SMTP probe of the first mail host
// (EHLO, MAIL FROM, RCPT TO, QUIT; never DATA, so nothing is ever delivered). Many internet providers block port 25,
// this laptop's among them (measured 2026-10-15: Google, Outlook, Yahoo and Zoho all time out), so the probe first
// needs the port to open within a few seconds; when it does not, the answer is `unknown` and the free checks stand.
//   bun scripts/workforce/email-check.ts <address> [<address> ...]   one JSON line per address
// The daemon calls `checkNewAddresses` each pass (a refused address is suppressed, so it is never mailed, and the team
// is told) and `refusedAddress` before it makes an approved admin call that names an address.
import { resolve4, resolve6, resolveMx } from "node:dns/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import { checkEmail, type EmailCheck } from "../../src/lib/email-check.ts";
import type { Db } from "../../src/server/lib/db.ts";

const PORT = 25;
const CONNECT_MS = 4000;
const REPLY_MS = 8000;
const HELO = "notify.matterofplace.com";
// Port 25 is tried at most once an hour when it was found closed, so a blocked laptop pays a few seconds an hour.
const CLOSED_FOR_MS = 60 * 60_000;
// An address is checked once; the record keeps the last thousand.
const KEEP = 1000;

// ---------- the SMTP conversation (pure over a session, tested in tests/unit/workforce-email-check.test.ts) ----------

/** A connected SMTP session: one reply at a time (a multi-line reply joined), one command at a time. */
export interface SmtpSession {
  reply(): Promise<{ code: number; text: string }>;
  send(line: string): void;
  close(): void;
}

/** Asks the mail host whether it takes mail for `address`, and leaves before any message could be sent. */
export async function probeMailbox(
  session: SmtpSession,
  address: string,
): Promise<"accepted" | "refused" | "unknown"> {
  try {
    if ((await session.reply()).code !== 220) return "unknown";
    session.send(`EHLO ${HELO}`);
    if ((await session.reply()).code !== 250) {
      session.send(`HELO ${HELO}`);
      if ((await session.reply()).code !== 250) return "unknown";
    }
    // The null sender, as a delivery report uses: nothing can come back to it.
    session.send("MAIL FROM:<>");
    if ((await session.reply()).code !== 250) return "unknown";
    session.send(`RCPT TO:<${address}>`);
    const { code } = await session.reply();
    session.send("QUIT");
    if (code === 250 || code === 251) return "accepted";
    // 550 no such mailbox, 551 not local, 553 mailbox name not allowed. A 4xx (greylisting, busy) proves nothing.
    if (code === 550 || code === 551 || code === 553) return "refused";
    return "unknown";
  } catch {
    return "unknown";
  } finally {
    session.close();
  }
}

/** Reads SMTP replies off a stream of text: a reply ends at a line whose code is followed by a space. */
export function replyReader(): {
  push(chunk: string): void;
  next(): { code: number; text: string } | null;
} {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk;
    },
    next() {
      const lines = buffer.split("\r\n");
      for (const [index, line] of lines.slice(0, -1).entries()) {
        const match = /^(\d{3}) /.exec(line);
        if (match === null) continue;
        const text = lines.slice(0, index + 1).join("\n");
        buffer = lines.slice(index + 1).join("\r\n");
        return { code: Number(match[1]), text };
      }
      return null;
    },
  };
}

let closedUntil = 0;

/** A session with `host` on port 25, or null when the port does not open in time (then not tried again for an hour). */
function openSession(host: string): Promise<SmtpSession | null> {
  if (Date.now() < closedUntil) return Promise.resolve(null);
  return new Promise((settle) => {
    const socket = connect({ host, port: PORT });
    socket.setEncoding("utf8");
    const reader = replyReader();
    const waiting: Array<(reply: { code: number; text: string } | Error) => void> = [];
    const drain = () => {
      for (let reply = reader.next(); reply !== null && waiting.length > 0; reply = reader.next())
        waiting.shift()?.(reply);
    };
    const timer = setTimeout(() => {
      closedUntil = Date.now() + CLOSED_FOR_MS;
      socket.destroy();
      settle(null);
    }, CONNECT_MS);
    socket.on("data", (chunk: string) => {
      reader.push(chunk);
      drain();
    });
    socket.on("error", () => {
      clearTimeout(timer);
      for (const wake of waiting.splice(0)) wake(new Error("smtp: connection lost"));
      settle(null);
    });
    socket.on("connect", () => {
      clearTimeout(timer);
      settle({
        reply: () =>
          new Promise((done, fail) => {
            const late = setTimeout(() => {
              fail(new Error("smtp: no reply"));
            }, REPLY_MS);
            waiting.push((reply) => {
              clearTimeout(late);
              if (reply instanceof Error) fail(reply);
              else done(reply);
            });
            drain();
          }),
        send: (line) => {
          socket.write(`${line}\r\n`);
        },
        close: () => {
          socket.end();
          socket.destroy();
        },
      });
    });
  });
}

/** Whether this machine can open port 25 to a well-known mail host right now (cached closed for an hour). */
export async function port25Open(): Promise<boolean> {
  const session = await openSession("gmail-smtp-in.l.google.com");
  session?.close();
  return session !== null;
}

// ---------- the check ----------

const dnsCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
const ABSENT = new Set(["ENOTFOUND", "NXDOMAIN"]);
const EMPTY = new Set(["ENODATA"]);

/** The full check of one address: free checks over the system resolver, then the probe when port 25 opens. */
export function checkAddress(address: string): Promise<EmailCheck> {
  return checkEmail(address, {
    async mx(domain) {
      try {
        return await resolveMx(domain);
      } catch (error) {
        if (ABSENT.has(dnsCode(error))) return null;
        if (EMPTY.has(dnsCode(error))) return [];
        return "unknown";
      }
    },
    async hasAddress(domain) {
      for (const lookup of [resolve4, resolve6]) {
        try {
          if ((await lookup(domain)).length > 0) return true;
        } catch (error) {
          if (!ABSENT.has(dnsCode(error)) && !EMPTY.has(dnsCode(error))) return "unknown";
        }
      }
      return false;
    },
    async probe(host, target) {
      const session = await openSession(host);
      return session === null ? "unknown" : probeMailbox(session, target);
    },
  });
}

/** Whether nothing may be sent to the address: its domain takes no mail, or its mail server refused the mailbox. */
export const isRefused = (check: EmailCheck) =>
  check.verdict === "domain_has_no_mail" || check.verdict === "mailbox_refused";

// ---------- what the daemon calls ----------

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The addresses an admin call's body names (any string value that is an address), lower-cased. */
export function addressesIn(body: unknown): string[] {
  if (typeof body === "string") return ADDRESS.test(body.trim()) ? [body.trim().toLowerCase()] : [];
  if (Array.isArray(body)) return body.flatMap(addressesIn);
  if (typeof body === "object" && body !== null) return Object.values(body).flatMap(addressesIn);
  return [];
}

/** Before an approved call that names an address is made: the reason it must not be, or null when it may. */
export async function refusedAddress(body: unknown): Promise<string | null> {
  for (const address of new Set(addressesIn(body))) {
    const check = await checkAddress(address);
    if (isRefused(check)) return `${address}: ${check.reason}`;
  }
  return null;
}

/** A refusal in fixed words: the team thread never carries the address or its domain (W8 review). */
export function refusedWords(check: EmailCheck): string {
  return check.verdict === "domain_has_no_mail"
    ? "its domain does not receive email."
    : "its mail server says the mailbox does not exist.";
}

const seenFile = z.object({ at: z.string(), seen: z.array(z.string()) });

function readSeen(file: string): z.infer<typeof seenFile> {
  try {
    if (existsSync(file)) return seenFile.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    // an unreadable record starts again from now
  }
  return { at: new Date().toISOString(), seen: [] };
}

/**
 * Each pass, where port 25 opens: the address of every new submission and inquiry is probed once. A refused one is
 * suppressed (reason `refused`), so the send step never mails it, and the team thread is told which request it was.
 * With port 25 closed it returns at once: the forms already ran the free checks.
 */
export async function checkNewAddresses(client: Db, home: string): Promise<number> {
  if (!(await port25Open())) return 0;
  const file = join(home, "email-checks.json");
  const record = readSeen(file);
  const [submissions, inquiries] = await Promise.all([
    client
      .from("submissions")
      .select("id, submitter_email, received_at")
      .gt("received_at", record.at)
      .limit(50),
    client
      .from("inquiries")
      .select("id, email, received_at")
      .gt("received_at", record.at)
      .limit(50),
  ]);
  const found = [
    ...(submissions.data ?? []).map((row) => ({
      kind: "submission",
      id: row.id,
      email: row.submitter_email,
      at: row.received_at,
    })),
    ...(inquiries.data ?? []).map((row) => ({
      kind: "inquiry",
      id: row.id,
      email: row.email,
      at: row.received_at,
    })),
  ];
  let refused = 0;
  for (const item of found) {
    const address = item.email.trim().toLowerCase();
    if (record.seen.includes(address)) continue;
    record.seen.push(address);
    const check = await checkAddress(address);
    if (!isRefused(check)) continue;
    refused += 1;
    await client
      .from("email_suppressions")
      .upsert(
        { email: address, reason: "refused" },
        { onConflict: "email", ignoreDuplicates: true },
      );
    await client.from("agent_messages").insert({
      thread: "team",
      author_kind: "system",
      author_id: "system",
      author_name: "Matter of Place",
      // W8 review: no part of the address, nor the check's reason (it names the domain): both are text the person chose.
      body: `The address of ${item.kind} ${item.id} will not be mailed: ${refusedWords(check)} Ask the person for the right address.`,
    });
  }
  const latest =
    found
      .map((item) => item.at)
      .sort()
      .at(-1) ?? record.at;
  writeFileSync(file, JSON.stringify({ at: latest, seen: record.seen.slice(-KEEP) }));
  return refused;
}

async function main(): Promise<void> {
  const addresses = process.argv.slice(2);
  if (addresses.length === 0) {
    console.error("usage: bun scripts/workforce/email-check.ts <address> [<address> ...]");
    process.exitCode = 64;
    return;
  }
  for (const address of addresses) {
    const started = Date.now();
    const check = await checkAddress(address);
    console.log(JSON.stringify({ address, ...check, ms: Date.now() - started }));
  }
}

if (import.meta.main) await main();
