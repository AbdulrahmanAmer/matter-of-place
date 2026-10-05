import { vi } from "vitest";
import { z } from "zod";
import { definitionRow, definitions } from "../../src/templates/email/index";
import { captureException } from "../../src/server/lib/sentry";
import type { Reporter, StepContext } from "../../src/server/jobs/types";
import { fakeDb, type FakeDb, type FakeDbOptions } from "./fake-db";

// The world a send runs in for the email unit tests (B5 step 4): the message rows as `email_message_begin` and
// `email_message_finish` keep them, tables that answer their filters, a Resend that keeps Idempotency-Keys like the
// real one, a Sentry that records envelopes, and the runner's step context. No test reaches a network.

export const NOW = new Date("2026-10-05T14:30:00.000Z");
export const JOB_ID = "7a1d0c2e-0000-4000-8000-000000000001";
export const JOB_KEY = "8b2e1d3f-0000-4000-8000-000000000002:notify";
export const EVENT_ID = "9c3f2e4a-0000-4000-8000-000000000003";
export const SUBMISSION_ID = "11111111-1111-4111-8111-111111111111";
export const SUBMITTER = "jordan.lee@gmail.com";
export const CONTACT = "hello@matterofplace.com";
export const ADMIN = "admin@matterofplace.com";
export const FROM = "Matter of Place <hello@notify.matterofplace.com>";
export const FROM_BULK = "Place Notes <hello@notes.matterofplace.com>";
export const SENTRY_DSN = "https://publickey@o1.ingest.sentry.io/42";

export const PRODUCTION_SHARE = {
  daily_cap: 75,
  bulk_cap: 50,
  monthly_cap: 2600,
  dev_recipients: [],
};
export const BUILD_SHARE = {
  daily_cap: 15,
  bulk_cap: 5,
  monthly_cap: 300,
  dev_recipients: ["admin@matterofplace.com", "admin+*@matterofplace.com", "*@resend.dev"],
};

const ENV_NAMES = [
  "MOP_ENV",
  "EMAIL_LIVE",
  "EMAIL_DRY_RUN",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "RESEND_FROM_BULK",
  "SITE_URL",
  "ADMIN_NOTIFY_EMAIL",
];

/** A production runner with every sending variable set; `values` changes or (undefined) removes one. */
export function emailEnv(values: Record<string, string | undefined> = {}): void {
  const base: Record<string, string | undefined> = {
    MOP_ENV: "production",
    RESEND_API_KEY: "re_unit_test_only",
    RESEND_FROM: FROM,
    RESEND_FROM_BULK: FROM_BULK,
    SITE_URL: "https://matterofplace.com",
    ADMIN_NOTIFY_EMAIL: ADMIN,
  };
  for (const name of ENV_NAMES) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries({ ...base, ...values })) vi.stubEnv(name, value);
}

/** One `email_messages` row as the two functions write it. */
export interface MessageRow {
  id: string;
  job_id: string;
  to_email: string;
  template_key: string;
  kind: string;
  subject: string;
  entity: string | null;
  entity_id: string | null;
  content_hash: string;
  status: string;
  resend_id: string | null;
  error: string | null;
  sent_at: string | null;
}

const OUT = ["sent", "delivered", "bounced", "complained"];

type Row = Record<string, unknown>;

interface FakeQuery extends Promise<{ data: Row[]; error: null }> {
  eq: (column: string, value: unknown) => FakeQuery;
  in: (column: string, values: unknown[]) => FakeQuery;
  limit: (count: number) => FakeQuery;
}

/** Tables that answer `eq`, `in` and `limit` as Postgres would (P-905), recorded in `calls` like `fakeDb`'s. */
function filteredFrom(tables: Record<string, Row[]>, calls: FakeDb["calls"]) {
  return (name: string) => {
    calls.push({ kind: "from", name, args: [] });
    const rows = tables[name];
    if (rows === undefined) throw new Error(`unexpected table ${name}`);
    const query = (current: Row[]): FakeQuery =>
      Object.assign(Promise.resolve({ data: current, error: null }), {
        eq: (column: string, value: unknown) =>
          query(current.filter((row) => row[column] === value)),
        in: (column: string, values: unknown[]) =>
          query(current.filter((row) => values.includes(row[column]))),
        limit: (count: number) => query(current.slice(0, count)),
      });
    return { select: () => query(rows) };
  };
}

export const SUBMISSION_ROW: Row = {
  id: SUBMISSION_ID,
  submitter_name: "Jordan Lee",
  submitter_email: SUBMITTER,
  address: "412 Alder Court",
  city: "Pasadena",
  state: "California",
  package: "The Feature",
  decline_reason_id: null,
  decline_note: null,
};

export interface World {
  share?: object;
  contact?: string | null;
  notify?: string[];
  sentToday?: number;
  sentMonth?: number;
  suppressed?: string[];
  jobKey?: string;
  eventType?: string;
  /** Template rows by key, over the seeded ones; `enabled: true` unless given. */
  templates?: Record<string, Row>;
  tables?: Record<string, Row[]>;
  /** The first `email_message_finish` calls fail with this, as a crash after Resend answered would. */
  finishFails?: number;
  rpc?: FakeDbOptions["rpc"];
}

/** The database of a send: `messages` is `email_messages`, `db.calls` every call made. */
export function emailWorld(world: World = {}) {
  const messages: MessageRow[] = [];
  let finishFails = world.finishFails ?? 0;
  const db = fakeDb({
    rpc: {
      email_sent_today: () => world.sentToday ?? 0,
      email_sent_month: () => world.sentMonth ?? 0,
      email_message_begin: (args) => {
        let message = messages.find(
          (row) => row.job_id === args.p_job_id && row.to_email === args.p_to_email,
        );
        if (message === undefined) {
          message = {
            id: `message-${String(messages.length + 1)}`,
            job_id: args.p_job_id,
            to_email: args.p_to_email,
            template_key: args.p_template_key,
            kind: args.p_kind,
            subject: args.p_subject,
            entity: args.p_entity ?? null,
            entity_id: args.p_entity_id ?? null,
            content_hash: args.p_content_hash,
            status: "queued",
            resend_id: null,
            error: null,
            sent_at: null,
          };
          messages.push(message);
        }
        return [{ id: message.id, status: message.status, content_hash: message.content_hash }];
      },
      email_message_finish: (args) => {
        if (finishFails > 0) {
          finishFails -= 1;
          return new Error("connection reset");
        }
        const message = messages.find((row) => row.id === args.p_id);
        if (message !== undefined && !OUT.includes(message.status)) {
          message.status = args.p_status;
          message.resend_id = args.p_resend_id ?? null;
          message.error = args.p_error ?? null;
          if (args.p_status === "sent") message.sent_at = NOW.toISOString();
        }
        return undefined;
      },
      ...world.rpc,
    },
  });
  const contact = world.contact === undefined ? CONTACT : world.contact;
  const seeded = definitions.map(({ definition }) => ({
    ...definitionRow(definition),
    class: definition.class,
    enabled: true,
    ...world.templates?.[definition.key],
  }));
  const tables: Record<string, Row[]> = {
    settings: [
      { key: "email", value: world.share ?? PRODUCTION_SHARE },
      ...(contact === null ? [] : [{ key: "site", value: { contact: { email: contact } } }]),
      ...(world.notify === undefined
        ? []
        : [{ key: "notifications", value: { recipients: world.notify } }]),
    ],
    email_templates: seeded,
    email_suppressions: (world.suppressed ?? []).map((email) => ({ email })),
    jobs: [{ id: JOB_ID, idempotency_key: world.jobKey ?? JOB_KEY }],
    events: world.eventType === undefined ? [] : [{ id: EVENT_ID, type: world.eventType }],
    submissions: [SUBMISSION_ROW],
    ...world.tables,
  };
  return { db: Object.assign(db, { from: filteredFrom(tables, db.calls) }), messages, tables };
}

const resendBody = z
  .object({
    from: z.string(),
    to: z.array(z.string()),
    subject: z.string(),
    html: z.string(),
    text: z.string(),
    reply_to: z.string().optional(),
    tags: z.array(z.object({ name: z.string(), value: z.string() })),
  })
  .passthrough();

export interface ResendRequest {
  headers: Headers;
  body: z.infer<typeof resendBody>;
}

const sentryEvent = z
  .object({ level: z.string(), fingerprint: z.array(z.string()).optional() })
  .passthrough();

/**
 * `fetch` for Resend and Sentry. Resend answers like the real one: a known Idempotency-Key with the same body gives the
 * first id again without a delivery, with another body `invalid_idempotent_request`. `answer` scripts the n-th request.
 */
export function fakeFetch(answer?: (attempt: number) => Response | undefined) {
  const requests: ResendRequest[] = [];
  const envelopes: z.infer<typeof sentryEvent>[] = [];
  const keys = new Map<string, { id: string; body: string }>();
  let deliveries = 0;
  const handle = (url: string, init: RequestInit | undefined): Response => {
    const text = typeof init?.body === "string" ? init.body : "";
    if (url.includes("/envelope/")) {
      envelopes.push(sentryEvent.parse(JSON.parse(text.split("\n")[2] ?? "null")));
      return new Response(null, { status: 200 });
    }
    if (url !== "https://api.resend.com/emails") throw new Error(`unexpected fetch ${url}`);
    const headers = new Headers(init?.headers);
    requests.push({ headers, body: resendBody.parse(JSON.parse(text)) });
    const scripted = answer?.(requests.length);
    if (scripted !== undefined) return scripted;
    const key = headers.get("idempotency-key");
    const known = key === null ? undefined : keys.get(key);
    if (known !== undefined && known.body !== text) {
      return Response.json(
        { statusCode: 409, name: "invalid_idempotent_request", message: "modified body" },
        { status: 409 },
      );
    }
    if (known !== undefined) return Response.json({ id: known.id });
    deliveries += 1;
    const id = `re_${String(deliveries)}`;
    if (key !== null) keys.set(key, { id, body: text });
    return Response.json({ id });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      try {
        return Promise.resolve(handle(String(input), init));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }),
  );
  return {
    requests,
    envelopes,
    deliveries: () => deliveries,
  };
}

/** A Resend error answer as the API sends it. */
export const resendError = (status: number, name: string, headers?: HeadersInit): Response =>
  Response.json(
    { statusCode: status, name, message: name },
    { status, ...(headers === undefined ? {} : { headers }) },
  );

/** The job runner's reporter (supabase/functions/job-runner/index.ts) on a test DSN. */
export const sentryReporter: Reporter = (error, { fingerprint, level }) =>
  captureException(error, {
    dsn: SENTRY_DSN,
    requestId: JOB_ID,
    route: "job-runner",
    env: "test",
    release: "test",
    fingerprint,
    ...(level === undefined ? {} : { level }),
  });

/** The context the runner hands a claimed job; `logs` collects what the step logs. */
export function stepCtx(
  db: StepContext["db"],
  options: { eventId?: string | null; report?: Reporter; logs?: string[]; type?: string } = {},
): StepContext {
  return {
    db,
    env: {},
    log: (level, event, fields) => {
      options.logs?.push(JSON.stringify({ level, event, ...fields }));
    },
    now: NOW,
    signal: new AbortController().signal,
    report: options.report ?? (() => Promise.resolve()),
    job: {
      id: JOB_ID,
      type: options.type ?? "send_email",
      attempts: 1,
      claim: "0d4a3f5b-0000-4000-8000-000000000004",
      result: null,
      eventId: options.eventId ?? null,
    },
  };
}

/** How a run ended when it threw: dead (`NonRetryableError`) or retried by the runner, with the message. */
export async function failure(
  pending: Promise<unknown>,
): Promise<{ dead: boolean; message: string }> {
  try {
    await pending;
  } catch (error) {
    return {
      dead: error instanceof Error && error.name === "NonRetryableError",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  throw new Error("expected the run to throw");
}
