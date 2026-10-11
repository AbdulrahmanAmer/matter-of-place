// B18 step 2 (H80): the plans' write path and dry run. Both functions start with `authorize`, so an agent key, an
// editor and a stale sign-in are refused before the body is read; the write is one `settings_put_products` call with
// the validated value, and the dry run reads the stored row and calls no function at all.
import "../fixtures/worker-env";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/db";
import { agentScopes } from "../../src/domain/admin-team";
import type { ProductPlan } from "../../src/domain/exposure";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import { seedProducts } from "../../src/server/settings/products";
import {
  getSettings,
  previewProductsSetting,
  putProductsSetting,
} from "../../src/server/settings/service";
import { fakeDb, type FakeDb } from "../fixtures/fake-db";
import { stateJson } from "../fixtures/snapshot";
import {
  CSRF_KEY,
  fakeAuth,
  rolesDb,
  routeHandler,
  SESSION_ID,
  sessionCookie,
  signer,
  SITE,
  stubAuthEnv,
} from "../fixtures/supabase-auth";

type SettingsRow = Database["public"]["Tables"]["settings"]["Row"];

const COUNT_MESSAGE = "adding or removing a plan needs a migration";
const NOW = Date.parse("2026-10-11T12:00:00Z");

const person = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-0000000000e0",
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-products",
});

const admin = person(["admin"]);

const agent: AdminActor = {
  userId: "00000000-0000-4000-8000-0000000000e2",
  kind: "agent",
  roles: ["admin"],
  scopes: [...agentScopes, "settings"],
  requestId: "req-agent",
};

const seed = seedProducts();
const planOf = (id: ProductPlan["id"]): ProductPlan => {
  const plan = seed.find((candidate) => candidate.id === id);
  if (plan === undefined) throw new Error(`no seed plan ${id}`);
  return plan;
};
const extra: ProductPlan = { ...planOf("feature"), name: "The Fifth" };
const withPlans = (plans: ProductPlan[]) => ({ plans });
const threePlans = withPlans(seed.slice(0, 3));
const fivePlans = withPlans([...seed, extra]);

const productsRow = (value: SettingsRow["value"]): SettingsRow => ({
  key: "products",
  value,
  updated_at: "2026-10-11T00:00:00Z",
  updated_by: null,
});

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );

const codeOf = (error: unknown) =>
  error instanceof AppError ? `${String(error.status)} ${error.code}` : String(error);

const messagesOf = (error: unknown) =>
  error instanceof AppError ? (error.issues ?? []).map((issue) => issue.message) : [];

const rpcNames = (db: FakeDb) =>
  db.calls.filter((call) => call.kind === "rpc").map((call) => call.name);

/** A client that records a call of any write function the dry run might make instead of throwing on it. */
const recordingWrites = (rows: SettingsRow[]) =>
  fakeDb({
    rpc: { settings_put_products: () => undefined, put_setting: () => null },
    tables: { settings: rows },
  });

describe("refused before the body is read", () => {
  it("refuses an agent key with 403 human_only on a body of three plans, with no database call", async () => {
    const db = fakeDb();
    const codes = [
      codeOf(await failureOf(putProductsSetting(agent, db, threePlans))),
      codeOf(await failureOf(previewProductsSetting(agent, db, threePlans))),
    ];
    expect({ codes, calls: db.calls }).toEqual({
      codes: ["403 human_only", "403 human_only"],
      calls: [],
    });
  });

  it("refuses an editor with 403 forbidden on a body of five plans, with no database call", async () => {
    const db = fakeDb();
    const editor = person(["managing_editor"]);
    const codes = [
      codeOf(await failureOf(putProductsSetting(editor, db, fivePlans))),
      codeOf(await failureOf(previewProductsSetting(editor, db, fivePlans))),
    ];
    expect({ codes, calls: db.calls }).toEqual({
      codes: ["403 forbidden", "403 forbidden"],
      calls: [],
    });
  });

  describe("a person's session", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.resetModules();
    });

    it("gets 401 reauth_required from both routes 20 minutes after sign-in, before the body is read", async () => {
      const key = await signer("kid-products");
      stubAuthEnv();
      fakeAuth([key.jwk]);
      vi.resetModules();
      const { setDbForTests } = await import("../../src/server/lib/db");
      const db = rolesDb([{ role: "admin", disabled: false }]);
      setDbForTests(db);
      const token = await key.token({ now: NOW, signedInAt: NOW - 20 * 60_000 });
      const answers: string[] = [];
      for (const [file, method] of [
        ["settings.products", "PUT"],
        ["settings.products.preview", "POST"],
      ] as const) {
        const module: unknown = await import(`../../src/routes/api/admin/${file}.ts`);
        const response = await routeHandler(
          module,
          method,
        )({
          request: new Request(`${SITE}/api/admin/settings/products`, {
            method,
            headers: {
              cookie: sessionCookie(token, NOW),
              "content-type": "application/json",
              "x-mop-csrf": createHmac("sha256", CSRF_KEY).update(SESSION_ID).digest("base64url"),
            },
            body: JSON.stringify(threePlans),
          }),
          context: { requestId: "r1" },
          params: {},
        });
        const body = z
          .object({ error: z.object({ code: z.string() }) })
          .safeParse(await response.json());
        answers.push(`${file} ${String(response.status)} ${body.data?.error.code ?? ""}`);
      }
      expect({ answers, rpc: rpcNames(db) }).toEqual({
        answers: [
          "settings.products 401 reauth_required",
          "settings.products.preview 401 reauth_required",
        ],
        rpc: [],
      });
    });
  });
});

describe("putProductsSetting", () => {
  it("calls settings_put_products once with the validated value and the actor, and never put_setting", async () => {
    const seen: unknown[] = [];
    const db = fakeDb({
      rpc: {
        settings_put_products: (args) => {
          seen.push(args);
          return undefined;
        },
      },
    });
    const typed = seed.map((plan, index) =>
      index === 0
        ? { ...plan, name: "  The Feature  ", note: "  ", items: ["", " One ", ""] }
        : plan,
    );
    const expected = seed.map((plan, index) =>
      index === 0 ? { ...plan, note: null, items: ["One"] } : plan,
    );
    const saved = await putProductsSetting(admin, db, withPlans(typed));
    expect({ saved, rpc: rpcNames(db), seen }).toEqual({
      saved: { plans: expected },
      rpc: ["settings_put_products"],
      seen: [
        {
          p_value: { plans: expected },
          p_actor: admin.userId,
          p_actor_kind: "human",
          p_request_id: "req-products",
          p_note: "admin: settings",
        },
      ],
    });
  });

  it.each([
    ["three", threePlans],
    ["five", fivePlans],
  ])(
    "refuses a body with %s plans: 422, 'adding or removing a plan needs a migration', no rpc call",
    async (_, body) => {
      const db = fakeDb();
      const error = await failureOf(putProductsSetting(admin, db, body));
      expect({ code: codeOf(error), messages: messagesOf(error), calls: db.calls }).toEqual({
        code: "422 validation",
        messages: [COUNT_MESSAGE],
        calls: [],
      });
    },
  );

  it("answers the function's refusal as 422 validation with its detail, and an outage as 503", async () => {
    const refusal = Object.assign(new Error("validation"), {
      code: "22023",
      details: COUNT_MESSAGE,
    });
    const refused = await failureOf(
      putProductsSetting(admin, fakeDb({ rpc: { settings_put_products: () => refusal } }), {
        plans: seed,
      }),
    );
    const down = await failureOf(
      putProductsSetting(
        admin,
        fakeDb({ rpc: { settings_put_products: () => new TypeError("fetch failed") } }),
        { plans: seed },
      ),
    );
    expect({
      refused: `${codeOf(refused)} ${refused instanceof Error ? refused.message : ""}`,
      down: codeOf(down),
    }).toEqual({ refused: `422 validation ${COUNT_MESSAGE}`, down: "503 unavailable" });
  });
});

describe("previewProductsSetting", () => {
  it("makes no rpc call, and lists a renamed bound plan and a changed price against the stored plans", async () => {
    const db = recordingWrites([productsRow({ plans: seed })]);
    const plans = seed.map((plan) =>
      plan.id === "reach"
        ? { ...plan, name: "The Reach Plus" }
        : plan.id === "feature"
          ? { ...plan, price: 325 }
          : plan,
    );
    const preview = await previewProductsSetting(admin, db, withPlans(plans));
    expect({
      rpc: rpcNames(db),
      changes: preview.changes,
      warnings: preview.warnings,
    }).toEqual({
      rpc: [],
      changes: [
        {
          id: "feature",
          name: "The Feature",
          moved: false,
          edited: ["price"],
          oldPrice: 295,
          newPrice: 325,
        },
        {
          id: "reach",
          name: "The Reach Plus",
          moved: false,
          edited: ["name"],
          oldPrice: 695,
          newPrice: 695,
        },
      ],
      warnings: [
        "Forms and request screens still say The Reach.",
        "The Feature goes from $295 to $325: new invoices will use it; issued invoices keep theirs.",
      ],
    });
  });

  it("compares with the seed when nothing is stored and draws every surface from the form", async () => {
    const db = recordingWrites([]);
    const campaignFirst = [
      planOf("campaign"),
      planOf("feature"),
      planOf("reach"),
      planOf("five-features"),
    ];
    const preview = await previewProductsSetting(admin, db, withPlans(campaignFirst));
    expect({
      moved: preview.changes.map((change) => `${change.id} ${String(change.moved)}`),
      exposure: preview.surfaces.exposure.map((card) => `${card.name} ${card.price}`),
      home: preview.surfaces.home.length,
      heading: preview.surfaces.homeHeading,
      invoice: preview.surfaces.invoice[1],
      faq: preview.surfaces.faq,
      warnings: preview.warnings,
    }).toEqual({
      moved: ["campaign true", "feature true", "reach true"],
      exposure: [
        "The Campaign $1,495",
        "The Feature $295",
        "The Reach $695",
        "Five Features $1,250",
      ],
      home: 4,
      heading: "Four ways in.",
      invoice: {
        product: "The Feature",
        description: "The Feature. Editorial presence.",
        amount: "$295.00",
      },
      faq: "The Campaign $1,495, The Feature $295, The Reach $695, or Five Features for $1,250. Programmatic media is billed separately.",
      warnings: [],
    });
  });

  it("refuses an invalid body with the same 422 and reads nothing", async () => {
    const db = recordingWrites([]);
    const error = await failureOf(previewProductsSetting(admin, db, fivePlans));
    expect({ code: codeOf(error), messages: messagesOf(error), calls: db.calls }).toEqual({
      code: "422 validation",
      messages: [COUNT_MESSAGE],
      calls: [],
    });
  });
});

describe("getSettings", () => {
  it("answers the stored plans as current and the seed as defaults, and null for a value that no longer parses", async () => {
    const renamed = seed.map((plan) => ({ ...plan, name: `${plan.name} Edited` }));
    const answerFor = async (value: SettingsRow["value"]) =>
      (
        await getSettings(
          admin,
          fakeDb({
            rpc: { public_state: () => stateJson(7, {}) },
            tables: { settings: [productsRow(value)] },
          }),
        )
      ).products;
    expect({
      stored: await answerFor({ plans: renamed }),
      broken: await answerFor({ plans: seed.slice(0, 2) }),
    }).toEqual({
      stored: { current: { plans: renamed }, defaults: { plans: seed } },
      broken: { current: null, defaults: { plans: seed } },
    });
  });
});
