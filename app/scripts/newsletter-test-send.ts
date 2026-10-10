// Place Notes test tool (B11 steps 5 and 8). From `app/`, with the dev profile loaded (`eval "$(node scripts/load-env.mjs --profile dev)"`):
//   bun run scripts/newsletter-test-send.ts --dry
//     draws a fixed sample issue into .tmp/issue.html; opens no database and needs no key.
//   bun run scripts/newsletter-test-send.ts --make-draft --i-mean-it
//     puts the newest published story into the open draft and prints `draft <issue_id>`; a draft that already has
//     blocks is left as it is and printed the same way; with no published story it prints `no published story`, exit 1.
//   bun run scripts/newsletter-test-send.ts --to <a>,<b>,<c> --actor <staff email> --i-mean-it
//     makes the addresses confirmed test subscribers (no `subscriber.created` event, no confirm mail), approves the open
//     draft as `--actor` for an immediate send and polls the issue for 5 minutes: `sent <resend_broadcast_id>`, else
//     its status, exit 1. Test commands refuse after the launch switch (ruling H35 (5)). The send itself needs the
//     function secrets of B5 step 5 and the stored legal entity and address (invariant 4).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { pgClientConfig } from "./lib/pg-connect.mjs";
import { clipWords, newsletterBlocksSchema } from "../src/domain/newsletter.ts";
import type { SiteContext } from "../src/server/email/context.ts";
import { buildPreheader, buildSubject } from "../src/server/newsletter/assemble.ts";
import { renderIssueHtml, type RenderIssue } from "../src/server/newsletter/render.ts";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";
import { runScript } from "./lib/social-script.ts";

const OUT_DIR = ".tmp";
const OUT_FILE = `${OUT_DIR}/issue.html`;
const POLL_MS = 5000;
const GIVE_UP_MS = 300_000;

const site: SiteContext = {
  siteUrl: "https://matterofplace.com",
  entity: "Sample legal entity",
  address: "Sample postal address",
  contact: { email: null },
};

const sample: RenderIssue = {
  number: 4,
  subject: "Place Notes No. 4: A house on the water",
  preheader: "A house in Pasadena and a story from the fortnight.",
  blocks: [
    {
      id: "b1",
      type: "intro",
      text: "A house and a story from the last two weeks.\nThe next issue follows in a fortnight.",
    },
    {
      id: "b2",
      type: "property",
      property_id: "3e8f2a7b-6c1d-4e5f-8a9b-0c1d2e3f4a5b",
      asset_id: "9a4b6c2d-1e3f-4a5b-8c7d-6e5f4a3b2c1d",
      slug: "alder-court",
      title: "Alder Court",
      deck: "A 1926 Spanish Revival house in Pasadena.",
      image_key: "sample/alder-court/og.jpg",
      image_url: `${site.siteUrl}/media/sample/alder-court/og.jpg`,
      link: `${site.siteUrl}/property/alder-court`,
    },
    {
      id: "b3",
      type: "story",
      story_id: "0b6a5c1e-3f4d-4b8a-9c2e-5d7f1a2b3c4d",
      slug: "a-house-on-the-water",
      title: "A house on the water",
      deck: "How a shoreline home keeps its original plan.",
      text: "This one begins at the dock.",
    },
  ],
};

interface DraftRow {
  id: string;
  number: number;
  blocks: unknown[];
}

interface IssueRow {
  status: string;
  resend_broadcast_id: string | null;
  send_error: string | null;
}

const refuse = (reason: string): number => {
  console.log(`refused: ${reason}`);
  return 1;
};

async function dry(): Promise<number> {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, await renderIssueHtml(sample, site));
  console.log(`wrote ${OUT_FILE}`);
  return 0;
}

async function makeDraft(db: pg.Client): Promise<number> {
  const open = (
    await db.query<DraftRow>("select id, number, blocks from public.newsletter_open_draft()")
  ).rows[0];
  if (open === undefined) throw new Error("newsletter_open_draft answered no row");
  if (open.blocks.length > 0) {
    console.log(`draft ${open.id}`);
    return 0;
  }
  const story = (
    await db.query<{ id: string; title: string; deck: string }>(
      `select id, title, deck from public.stories
       where editorial_state = 'published' order by published_at desc limit 1`,
    )
  ).rows[0];
  if (story === undefined) {
    console.log("no published story");
    return 1;
  }
  const blocks = newsletterBlocksSchema.parse([
    {
      id: `story:${story.id}`,
      type: "story",
      story_id: story.id,
      title: clipWords(story.title),
      deck: clipWords(story.deck),
    },
  ]);
  const saved = await db.query<{ saved: { id: string } }>(
    `select public.newsletter_save_draft($1::jsonb, $2, $3, null, null, $4) as saved`,
    [
      JSON.stringify(blocks),
      buildSubject(blocks, open.number),
      buildPreheader(blocks),
      `test-send:${randomUUID()}`,
    ],
  );
  console.log(`draft ${saved.rows[0]?.saved.id ?? open.id}`);
  return 0;
}

/** Each address becomes a confirmed subscriber of source `test`; the hash is used once, by `confirm_subscriber`. */
async function confirmTestSubscribers(db: pg.Client, emails: readonly string[]): Promise<void> {
  await db.query("begin");
  try {
    for (const email of emails) {
      const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
      await db.query(
        `insert into public.subscribers (email, source, confirm_token_hash) values ($1, $3, $2)
         on conflict (lower(email)) do update set source = excluded.source, pending_source = null,
           confirm_token_hash = excluded.confirm_token_hash`,
        [email, hash, "test"],
      );
      const confirmed = await db.query<{ id: string | null }>(
        "select public.confirm_subscriber($1) as id",
        [hash],
      );
      if (confirmed.rows[0]?.id == null) throw new Error(`could not confirm ${email}`);
    }
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function send(db: pg.Client, emails: readonly string[], actorEmail: string): Promise<number> {
  const actor = (
    await db.query<{ id: string }>(
      `select u.id from auth.users u
       join public.user_roles r on r.user_id = u.id and r.actor_kind = 'human' and r.disabled_at is null
       where lower(u.email) = lower($1) limit 1`,
      [actorEmail],
    )
  ).rows[0];
  if (actor === undefined) return refuse(`no human staff user ${actorEmail}`);
  const draft = (
    await db.query<DraftRow>(
      "select id, number, blocks from public.newsletter_issues where status = 'draft'",
    )
  ).rows[0];
  if (draft === undefined || draft.blocks.length === 0) {
    return refuse("no draft with blocks (run --make-draft first)");
  }
  await confirmTestSubscribers(db, emails);
  await db.query("select public.newsletter_approve_issue($1, null, $2, 'human', $3)", [
    draft.id,
    actor.id,
    `test-send:${randomUUID()}`,
  ]);
  let issue: IssueRow | undefined;
  for (let waited = 0; waited <= GIVE_UP_MS; waited += POLL_MS) {
    issue = (
      await db.query<IssueRow>(
        "select status, resend_broadcast_id, send_error from public.newsletter_issues where id = $1",
        [draft.id],
      )
    ).rows[0];
    if (issue?.status === "sent") {
      console.log(`sent ${issue.resend_broadcast_id ?? ""}`.trimEnd());
      return 0;
    }
    await sleep(POLL_MS);
  }
  console.log(`${issue?.status ?? "missing"} ${issue?.send_error ?? ""}`.trimEnd());
  return 1;
}

/** The whole command, answering the exit code. */
export async function newsletterTestSendMain(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      dry: { type: "boolean" },
      "make-draft": { type: "boolean" },
      to: { type: "string" },
      actor: { type: "string" },
      "i-mean-it": { type: "boolean" },
    },
    strict: true,
  });
  if (values.dry === true) return dry();
  const emails = (values.to ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email !== "");
  const makingDraft = values["make-draft"] === true;
  if (!makingDraft && emails.length === 0) {
    console.error(
      "usage: bun run scripts/newsletter-test-send.ts --dry | --make-draft --i-mean-it | --to <a>,<b>,<c> --actor <email> --i-mean-it",
    );
    return 64;
  }
  if (values["i-mean-it"] !== true) return refuse("--i-mean-it required");
  const actor = values.actor;
  if (!makingDraft && actor === undefined) return refuse("--actor <staff email> required");
  guardEnv();
  const dbUrl = process.env["DEV_DB_URL"];
  await assertNotProduction({ dbUrl });
  const release = await holdDevLock();
  const db = new pg.Client(pgClientConfig(dbUrl));
  try {
    await db.connect();
    return makingDraft || actor === undefined ? await makeDraft(db) : await send(db, emails, actor);
  } finally {
    await db.end();
    await release();
  }
}

if (import.meta.main) await runScript(() => newsletterTestSendMain(process.argv.slice(2)));
