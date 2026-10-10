// B7 step 15: screen 24's service. Every function checks its matrix action first (admin, people only, recent sign-in);
// the invoice write is B6's one `settings_put_invoice` call, the identity write B16's `settings_put_site`, and the
// coming-soon and notification keys go through `put_setting`. `getSettings` reads the five keys in one select.
import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/db";
import { agentScopes } from "../../src/domain/admin-team";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { ForbiddenError } from "../../src/server/lib/authz";
import { AppError } from "../../src/server/lib/errors";
import { resetPublicStateMemo } from "../../src/server/public/state";
import {
  getSettings,
  putComingSoon,
  putInvoice,
  putNotifications,
  putSite,
} from "../../src/server/settings/service";
import { fakeDb } from "../fixtures/fake-db";
import { stateJson } from "../fixtures/snapshot";
import { routeHandler, SITE, stubAuthEnv } from "../fixtures/supabase-auth";

type KeyRow = Database["public"]["Functions"]["agent_key_by_hash"]["Returns"][number];
type SettingsRow = Database["public"]["Tables"]["settings"]["Row"];

const AGENT = "00000000-0000-4000-8000-0000000000f2";
const KEY_ID = "00000000-0000-4000-8000-0000000000f3";

const admin: AdminActor = {
  userId: "00000000-0000-4000-8000-0000000000f0",
  kind: "human",
  roles: ["admin"],
  scopes: [],
  requestId: "req-settings",
};

const agent: AdminActor = {
  userId: AGENT,
  kind: "agent",
  roles: ["admin"],
  scopes: [...agentScopes, "settings"],
  requestId: "req-agent",
};

const SITE_WITHOUT_ENTITY = {
  contact: { email: "hello@example.test", phone: null, privacy_email: null },
  legal: { entity: null, address: "1 Test Street, Testville, CA 90000" },
  social: { instagram: null, x: null, linkedin: null },
};

const INVOICE = {
  prefix: "MOP",
  due_days: 14,
  terms: "Due in 14 days.",
  late_terms: "Late after 30 days.",
  tax_line: "No tax applies.",
  payment_methods: [{ id: "wire", label: "Wire", instructions: "Account 1" }],
  campaign_days: {
    "The Feature": null,
    "The Reach": null,
    "The Campaign": 30,
    "Five Features": null,
  },
  billing_email: "billing@example.test",
};

const row = (key: string, value: SettingsRow["value"]): SettingsRow => ({
  key,
  value,
  updated_at: "2026-10-09T00:00:00Z",
  updated_by: null,
});

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );

const rpcNames = (db: ReturnType<typeof fakeDb>) =>
  db.calls.filter((call) => call.kind === "rpc").map((call) => call.name);

beforeEach(() => {
  resetPublicStateMemo();
});

describe("getSettings", () => {
  it("returns the five keys and legal.entity in readiness when the stored site lacks it, each name once", async () => {
    const db = fakeDb({
      rpc: { public_state: () => stateJson(7, { site: SITE_WITHOUT_ENTITY }) },
      tables: {
        settings: [
          row("site", SITE_WITHOUT_ENTITY),
          row("invoice", INVOICE),
          row("coming_soon_global", true),
          row("notifications", { recipients: ["ops@example.test"] }),
          row("agent_daily_limits", {
            decisions_per_day: 25,
            publish_per_day: 5,
            requests_per_day: 2000,
          }),
        ],
      },
    });
    const answer = await getSettings(admin, db);
    expect({ answer, tables: db.calls.filter((call) => call.kind === "from").length }).toEqual({
      answer: {
        site: SITE_WITHOUT_ENTITY,
        invoice: INVOICE,
        coming_soon_global: true,
        notifications: { recipients: ["ops@example.test"] },
        agent_daily_limits: { decisions_per_day: 25, publish_per_day: 5, requests_per_day: 2000 },
        readiness: ["legal.entity"],
      },
      tables: 1,
    });
  });

  it("lists invoice and the unset identity fields when nothing has been saved", async () => {
    const empty = { contact: {}, legal: {}, social: {} };
    const db = fakeDb({
      rpc: { public_state: () => stateJson(7, { site: empty }) },
      tables: { settings: [] },
    });
    const answer = await getSettings(admin, db);
    expect({
      readiness: answer.readiness,
      invoice: answer.invoice,
      notifications: answer.notifications,
      comingSoon: answer.coming_soon_global,
    }).toEqual({
      readiness: ["contact.email", "legal.entity", "legal.address", "invoice"],
      invoice: null,
      notifications: { recipients: [] },
      comingSoon: false,
    });
  });
});

describe("the writes", () => {
  it("putInvoice makes one settings_put_invoice call with the actor and request, and never put_setting", async () => {
    const seen: unknown[] = [];
    const db = fakeDb({
      rpc: {
        settings_put_invoice: (args) => {
          seen.push(args);
          return undefined;
        },
      },
    });
    const saved = await putInvoice(admin, db, INVOICE);
    expect({ saved, rpc: rpcNames(db), seen }).toEqual({
      saved: INVOICE,
      rpc: ["settings_put_invoice"],
      seen: [
        {
          p_value: INVOICE,
          p_actor: admin.userId,
          p_actor_kind: "human",
          p_request_id: "req-settings",
          p_note: "admin: settings",
        },
      ],
    });
  });

  it("putSite writes through settings_put_site with the request id, so screen 25 finds it by request", async () => {
    const seen: unknown[] = [];
    const db = fakeDb({
      rpc: {
        settings_put_site: (args) => {
          seen.push(args);
          return undefined;
        },
      },
    });
    await putSite(admin, db, SITE_WITHOUT_ENTITY);
    expect({ rpc: rpcNames(db), seen }).toEqual({
      rpc: ["settings_put_site"],
      seen: [
        {
          p_value: SITE_WITHOUT_ENTITY,
          p_actor: admin.userId,
          p_actor_kind: "human",
          p_request_id: "req-settings",
          p_note: "admin: settings",
        },
      ],
    });
  });

  it("putComingSoon and putNotifications call put_setting with their key and the audit triple", async () => {
    const seen: unknown[] = [];
    const db = fakeDb({
      rpc: {
        put_setting: (args) => {
          seen.push(args);
          return args.p_value;
        },
      },
    });
    const comingSoon = await putComingSoon(admin, db, { coming_soon_global: true });
    const notifications = await putNotifications(admin, db, { recipients: ["ops@example.test"] });
    const audit = { p_actor: admin.userId, p_actor_kind: "human", p_request_id: "req-settings" };
    expect({ comingSoon, notifications, seen }).toEqual({
      comingSoon: { coming_soon_global: true },
      notifications: { recipients: ["ops@example.test"] },
      seen: [
        { p_key: "coming_soon_global", p_value: true, ...audit },
        { p_key: "notifications", p_value: { recipients: ["ops@example.test"] }, ...audit },
      ],
    });
  });

  it("answers the put_setting refusal as its error code", async () => {
    const db = fakeDb({ rpc: { put_setting: () => new Error("invalid_key") } });
    const error = await failureOf(putComingSoon(admin, db, { coming_soon_global: false }));
    expect(
      error instanceof AppError ? `${String(error.status)} ${error.code}` : String(error),
    ).toBe("422 invalid_key");
  });
});

describe("person only", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("refuses an agent with human_only on every settings function before it touches the database", async () => {
    // Any call on this client throws `unexpected ...`, so only a refusal before the database is human_only.
    const db = fakeDb();
    const calls: (() => Promise<unknown>)[] = [
      () => getSettings(agent, db),
      () => putSite(agent, db, SITE_WITHOUT_ENTITY),
      () => putInvoice(agent, db, INVOICE),
      () => putComingSoon(agent, db, { coming_soon_global: true }),
      () => putNotifications(agent, db, { recipients: [] }),
    ];
    const codes = await Promise.all(
      calls.map(async (call) => {
        const error = await failureOf(call());
        return error instanceof ForbiddenError
          ? `${String(error.status)} ${error.code}`
          : String(error);
      }),
    );
    expect(codes).toEqual(calls.map(() => "403 human_only"));
  });

  it("an agent key gets 403 human_only from every settings route", async () => {
    stubAuthEnv();
    const { setDbForTests } = await import("../../src/server/lib/db");
    setDbForTests(
      fakeDb({
        rpc: {
          agent_key_by_hash: () => [
            z.custom<KeyRow>().parse({
              key_id: KEY_ID,
              user_id: AGENT,
              scopes: [...agentScopes],
              revoked_at: null,
              last_used_at: new Date().toISOString(),
              roles: ["admin"],
            }),
          ],
          rate_limit_check: () => [{ allowed: true, retry_after: 0 }],
        },
        tables: { settings: [row("agent_daily_limits", { requests_per_day: 2000 })] },
      }),
    );
    const routes = [
      ["settings.index", "GET"],
      ["settings.site", "PUT"],
      ["settings.invoice", "PUT"],
      ["settings.coming-soon", "PUT"],
      ["settings.notifications", "PUT"],
    ] as const;
    const answers: string[] = [];
    for (const [file, method] of routes) {
      const module: unknown = await import(`../../src/routes/api/admin/${file}.ts`);
      const response = await routeHandler(
        module,
        method,
      )({
        request: new Request(`${SITE}/api/admin/settings`, {
          method,
          headers: {
            authorization: "Bearer mopk_local_agent",
            "cf-connecting-ip": "203.0.113.5",
            ...(method === "GET" ? {} : { "content-type": "application/json" }),
          },
          ...(method === "GET" ? {} : { body: "{}" }),
        }),
        context: { requestId: "r1" },
        params: {},
      });
      const body = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(await response.json());
      answers.push(`${file} ${method} ${String(response.status)} ${body.data?.error.code ?? ""}`);
    }
    expect(answers).toEqual(routes.map(([file, method]) => `${file} ${method} 403 human_only`));
  });
});
