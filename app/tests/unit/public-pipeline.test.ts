import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type * as Routes from "../../src/server/public/routes";
import type { PublicRoute, PublicService, RouteLimit } from "../../src/server/public/routes";
import { fakeDb } from "../fixtures/fake-db";
import { catalogDb, snapshotJson, stateJson } from "../fixtures/snapshot";
import { TEST_IP } from "../fixtures/worker-env";

vi.mock("../../src/server/lib/sentry", { spy: true });

const BASE = "https://matterofplace.com";

// A fresh module graph per test (the state memo and the limits live in module state), with the rows of the table
// plus the rows the test adds: the POST rows of later steps do not exist yet.
async function load() {
  vi.resetModules();
  const table: PublicRoute[] = [];
  vi.doMock("../../src/server/public/routes", async (importOriginal) => {
    const original = await importOriginal<typeof Routes>();
    table.push(...original.routes);
    return { ...original, routes: table };
  });
  const pipeline = await import("../../src/server/public/pipeline");
  const sentry = await import("../../src/server/lib/sentry");
  const added = (route: PublicRoute) => {
    table.push(route);
  };
  return { handlePublic: pipeline.handlePublic, sentry, added };
}

let ipCounter = 0;
const nextIp = () => `198.51.100.${String((ipCounter += 1) % 250)}`;
const ok = () => Promise.resolve({ ok: true });

function request(path: string, init: RequestInit & { ip?: string } = {}) {
  const { ip, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("cf-connecting-ip", ip ?? nextIp());
  return new Request(`${BASE}${path}`, { ...rest, headers });
}

function post(path: string, body: unknown, init: RequestInit & { ip?: string } = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return request(path, {
    ...init,
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const errorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    issues: z.array(z.unknown()).optional(),
  }),
});
const errorOf = async (response: Response) => errorBody.parse(await response.json()).error;

const collector = () => {
  const queued: Promise<unknown>[] = [];
  return {
    queued,
    wait: (promise: Promise<unknown>) => {
      queued.push(promise);
    },
  };
};

const echoSchema = z.object({ email: z.string(), n: z.number() });
interface Variation {
  path?: string;
  status?: number;
  form?: boolean;
  limits?: RouteLimit[];
  /** `false` for a row that takes no body schema. */
  schema?: false;
}

const echoRow = (service: PublicService, over: Variation = {}): PublicRoute => ({
  path: over.path ?? "/api/public/echo",
  method: "POST",
  ...(over.schema === false ? {} : { schema: echoSchema }),
  limits: over.limits ?? [],
  turnstile: false,
  ...(over.form === undefined ? {} : { form: over.form }),
  status: over.status ?? 201,
  service,
});

const dbCalls = (db: ReturnType<typeof fakeDb>, name: string) =>
  db.calls.filter((call) => call.name === name).length;

const lines: string[] = [];

beforeEach(() => {
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "15000");
  lines.length = 0;
  for (const method of ["log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a catalog read", () => {
  it("answers the list with the version, the cache label and the request id it was given", async () => {
    const { handlePublic } = await load();
    const db = catalogDb();
    const response = await handlePublic(request("/api/public/properties"), "req-12345678", db);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-12345678");
    expect(response.headers.get("x-mop-cache")).toBe("miss");
    expect(response.headers.get("x-catalog-version")).toBe("7");
    expect(response.headers.get("cache-tag")).toBe("catalog");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(z.array(z.object({ slug: z.string() })).parse(await response.json())).toHaveLength(1);
  });

  it("reads every state and snapshot call from the client it was given, never getDb()", async () => {
    const { handlePublic } = await load();
    const db = catalogDb();
    const response = await handlePublic(request("/api/public/properties"), "req-12345678", db);
    expect(response.status).toBe(200);
    expect(db.calls.map((call) => call.name)).toEqual(["public_state", "public_catalog_snapshot"]);
  });

  it("answers a detail with the row and passes the slug to the service as input", async () => {
    const { handlePublic } = await load();
    const response = await handlePublic(
      request("/api/public/properties/p1"),
      "req-12345678",
      catalogDb(),
    );
    expect(response.headers.get("cache-tag")).toBe("catalog,property:p1");
    expect(
      z.object({ slug: z.string(), title: z.string() }).parse(await response.json()),
    ).toMatchObject({
      slug: "p1",
    });
  });

  it("answers a missing slug with the cacheable 404: no request id in the body, its own short lifetime", async () => {
    const { handlePublic } = await load();
    const response = await handlePublic(
      request("/api/public/properties/nope"),
      "req-12345678",
      catalogDb(),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=60");
    expect(response.headers.get("x-request-id")).toBe("req-12345678");
    const error = await errorOf(response);
    expect(error.code).toBe("not_found");
    expect(error.requestId).toBeUndefined();
  });

  it("answers a slug longer than a slug can be with 422 and the request id", async () => {
    const { handlePublic } = await load();
    const response = await handlePublic(
      request(`/api/public/stories/${"a".repeat(121)}`),
      "req-12345678",
      catalogDb(),
    );
    expect(response.status).toBe(422);
    expect((await errorOf(response)).requestId).toBe("req-12345678");
  });

  it("answers 404 for a path no row has, with the id it was given in the body", async () => {
    const { handlePublic } = await load();
    const db = catalogDb();
    const response = await handlePublic(request("/api/public/nothing"), "req-12345678", db);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-mop-cache")).toBe("bypass");
    expect((await errorOf(response)).requestId).toBe("req-12345678");
    expect(db.calls).toEqual([]);
  });

  it("answers 405 with Allow for a method the row does not declare", async () => {
    const { handlePublic } = await load();
    const response = await handlePublic(
      post("/api/public/properties", {}),
      "req-12345678",
      catalogDb(),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect((await errorOf(response)).requestId).toBe("req-12345678");
  });

  it("answers 503 unavailable with Retry-After when nothing can be read and no copy exists", async () => {
    const { handlePublic } = await load();
    const db = fakeDb({ rpc: { public_state: () => new Error("down") } });
    const response = await handlePublic(request("/api/public/properties"), "req-12345678", db);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("x-mop-cache")).toBe("bypass");
    expect(response.headers.get("x-catalog-version")).toBeNull();
    expect((await errorOf(response)).code).toBe("unavailable");
  });

  it("queues exactly one report on the collector for a stale read, sent after the response", async () => {
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
    const { handlePublic, sentry } = await load();
    const answers = { state: stateJson(7) as ReturnType<typeof stateJson> | Error };
    const db = fakeDb({
      rpc: {
        public_state: () => answers.state,
        public_catalog_snapshot: () => snapshotJson(7),
      },
    });
    const { queued, wait } = collector();
    await handlePublic(request("/api/public/properties"), "req-12345678", db, wait);
    expect(queued).toHaveLength(0);
    answers.state = new Error("down");
    const stale = await handlePublic(request("/api/public/properties"), "req-12345679", db, wait);
    expect(stale.headers.get("x-mop-cache")).toBe("stale");
    await handlePublic(request("/api/public/properties"), "req-1234567a", db, wait);
    expect(queued).toHaveLength(1);
    await Promise.all(queued);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sentry.captureException).mock.calls[0]?.[1]).toMatchObject({
      requestId: "req-12345679",
      route: "/api/public/properties",
    });
  });
});

describe("a failure nobody planned for", () => {
  it("answers a calm 500 and reports it, without the error's own words", async () => {
    const { handlePublic, added, sentry } = await load();
    added(echoRow(() => Promise.reject(new TypeError("secret detail"))));
    const { queued, wait } = collector();
    const response = await handlePublic(
      post("/api/public/echo", { email: "a@b.co", n: 1 }),
      "req-12345678",
      catalogDb(),
      wait,
    );
    expect(response.status).toBe(500);
    const error = await errorOf(response);
    expect(error).toMatchObject({ code: "server", requestId: "req-12345678" });
    expect(JSON.stringify(error)).not.toContain("secret detail");
    expect(queued).toHaveLength(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

describe("a write", () => {
  it("answers a GET on a POST-only row with 405 and Allow: POST", async () => {
    const { handlePublic, added } = await load();
    added(echoRow(ok));
    const response = await handlePublic(request("/api/public/echo"), "req-12345678", catalogDb());
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect((await errorOf(response)).requestId).toBe("req-12345678");
  });

  it("calls the service with the client, the parsed body and the context, and answers the row's status", async () => {
    const { handlePublic, added } = await load();
    const service = vi.fn<PublicService>(ok);
    added(echoRow(service));
    const db = catalogDb();
    const response = await handlePublic(
      post("/api/public/echo", { email: "a@b.co", n: 1, extra: "dropped" }, { ip: TEST_IP }),
      "req-12345678",
      db,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-mop-cache")).toBe("bypass");
    expect(response.headers.get("x-catalog-version")).toBeNull();
    expect(service).toHaveBeenCalledTimes(1);
    const [client, input, ctx] = service.mock.calls[0] ?? [];
    expect(client).toBe(db);
    expect(input).toEqual({ email: "a@b.co", n: 1 });
    expect(ctx).toMatchObject({ requestId: "req-12345678", turnstileOk: false });
    expect(ctx?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx?.ipHash).not.toContain(TEST_IP);
  });

  it("sends no body for a 204 and returns a Response the service built as it is", async () => {
    const { handlePublic, added } = await load();
    added(echoRow(ok, { path: "/api/public/beacon", status: 204, schema: false }));
    added(
      echoRow(
        () => Promise.resolve(new Response(null, { status: 303, headers: { location: "/x" } })),
        {
          path: "/api/public/go",
          schema: false,
        },
      ),
    );
    const beacon = await handlePublic(post("/api/public/beacon", {}), "req-12345678", catalogDb());
    expect(beacon.status).toBe(204);
    expect(await beacon.text()).toBe("");
    const go = await handlePublic(post("/api/public/go", {}), "req-12345679", catalogDb());
    expect([go.status, go.headers.get("location")]).toEqual([303, "/x"]);
  });

  it("refuses a body over 64 KB, a wrong content type and a body that is not JSON, with no database call", async () => {
    const { handlePublic, added } = await load();
    added(echoRow(ok));
    const db = catalogDb();
    const declared = await handlePublic(
      post("/api/public/echo", {}, { headers: { "content-length": "70000" } }),
      "req-12345678",
      db,
    );
    const measured = await handlePublic(
      post("/api/public/echo", { email: "a@b.co", n: "x".repeat(70_000) }),
      "req-12345679",
      db,
    );
    const typed = await handlePublic(
      post("/api/public/echo", "email=a", { headers: { "content-type": "text/plain" } }),
      "req-1234567a",
      db,
    );
    const broken = await handlePublic(post("/api/public/echo", "{nope"), "req-1234567b", db);
    expect([declared, measured, typed, broken].map((response) => response.status)).toEqual([
      413, 413, 400, 400,
    ]);
    expect(db.calls).toEqual([]);
  });

  it("rejects a schema failure with 422, the issues and the request id, and touches no database", async () => {
    const { handlePublic, added } = await load();
    const service = vi.fn<PublicService>(ok);
    added(
      echoRow(service, {
        limits: [{ scope: "ip", store: "db", limit: 3, windowSeconds: 3600 }],
      }),
    );
    const db = catalogDb();
    const response = await handlePublic(post("/api/public/echo", { email: 5 }), "req-12345678", db);
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.requestId).toBe("req-12345678");
    expect(error.issues?.length).toBeGreaterThan(0);
    expect(db.calls).toEqual([]);
    expect(service).not.toHaveBeenCalled();
  });

  it("checks the first memory limit of a form before the schema: the 31st post from one IP is 429 even when invalid", async () => {
    const { handlePublic, added } = await load();
    added(echoRow(ok, { form: true }));
    const db = catalogDb();
    const ip = nextIp();
    const statuses: number[] = [];
    for (let sent = 1; sent <= 30; sent += 1) {
      statuses.push(
        (
          await handlePublic(
            post("/api/public/echo", { email: "a@b.co", n: 1 }, { ip }),
            "req-12345678",
            db,
          )
        ).status,
      );
    }
    const refused = await handlePublic(
      post("/api/public/echo", { bad: true }, { ip }),
      "req-12345679",
      db,
    );
    expect(statuses.every((status) => status === 201)).toBe(true);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(dbCalls(db, "rate_limit_check")).toBe(0);
  });

  it("applies the first limit only to a row that declares a form, so 31 beacons are all accepted", async () => {
    const { handlePublic, added } = await load();
    added(echoRow(ok, { path: "/api/public/beacon", status: 204, schema: false }));
    const ip = nextIp();
    const statuses: number[] = [];
    for (let sent = 1; sent <= 31; sent += 1) {
      statuses.push(
        (await handlePublic(post("/api/public/beacon", {}, { ip }), "req-12345678", catalogDb()))
          .status,
      );
    }
    expect(statuses.every((status) => status === 204)).toBe(true);
  });

  it("counts a row's own memory limit per IP and answers 429 when it is spent", async () => {
    const { handlePublic, added } = await load();
    added(
      echoRow(ok, {
        limits: [{ scope: "ip", store: "memory", limit: 2, windowSeconds: 60 }],
      }),
    );
    const ip = nextIp();
    const send = (id: string, address: string) =>
      handlePublic(
        post("/api/public/echo", { email: "a@b.co", n: 1 }, { ip: address }),
        id,
        catalogDb(),
      );
    const statuses = [
      (await send("req-12345671", ip)).status,
      (await send("req-12345672", ip)).status,
      (await send("req-12345673", ip)).status,
      (await send("req-12345674", nextIp())).status,
    ];
    expect(statuses).toEqual([201, 201, 429, 201]);
  });

  it("sends the database limits in one call with hashed keys, and answers 429 with Retry-After when one is spent", async () => {
    const { handlePublic, added } = await load();
    const service = vi.fn<PublicService>(ok);
    added(
      echoRow(service, {
        limits: [
          { scope: "ip", store: "db", limit: 10, windowSeconds: 3600 },
          { scope: "email", store: "db", limit: 5, windowSeconds: 86_400 },
        ],
      }),
    );
    const allowed = catalogDb();
    const first = await handlePublic(
      post("/api/public/echo", { email: "Person@Example.com", n: 1 }, { ip: TEST_IP }),
      "req-12345678",
      allowed,
    );
    expect(first.status).toBe(201);
    const sent = JSON.stringify(
      allowed.calls.find((call) => call.name === "rate_limit_check")?.args,
    );
    expect(sent).toContain("echo:ip");
    expect(sent).toContain("echo:email");
    expect(sent).toContain("86400");
    expect(sent).not.toContain(TEST_IP);
    expect(sent.toLowerCase()).not.toContain("person@example.com");
    const spent = fakeDb({
      rpc: { rate_limit_check: () => [{ allowed: false, retry_after: 42 }] },
    });
    const refused = await handlePublic(
      post("/api/public/echo", { email: "a@b.co", n: 1 }),
      "req-12345679",
      spent,
    );
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("42");
    expect(service).toHaveBeenCalledTimes(1);
  });

  it("answers 503 and does not call the service when the limit check cannot run", async () => {
    const { handlePublic, added } = await load();
    const service = vi.fn<PublicService>(ok);
    added(
      echoRow(service, { limits: [{ scope: "ip", store: "db", limit: 10, windowSeconds: 3600 }] }),
    );
    const down = fakeDb({ rpc: { rate_limit_check: () => new Error("down") } });
    const response = await handlePublic(
      post("/api/public/echo", { email: "a@b.co", n: 1 }),
      "req-12345678",
      down,
    );
    expect(response.status).toBe(503);
    expect(service).not.toHaveBeenCalled();
  });
});

describe("a raw row", () => {
  it("reaches the service with the body unread and no schema, memory or database check", async () => {
    const { handlePublic, added } = await load();
    const seen: boolean[] = [];
    added({
      path: "/api/public/signed",
      method: "POST",
      raw: true,
      limits: [{ scope: "ip", store: "memory", limit: 1, windowSeconds: 60 }],
      turnstile: false,
      form: true,
      status: 200,
      service: (incoming) => {
        seen.push(incoming.bodyUsed);
        return Promise.resolve(new Response("ok"));
      },
    });
    const db = catalogDb();
    const ip = nextIp();
    const first = await handlePublic(
      post("/api/public/signed", "not json", { ip }),
      "req-12345678",
      db,
    );
    const second = await handlePublic(
      post("/api/public/signed", "not json", { ip }),
      "req-12345679",
      db,
    );
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(seen).toEqual([false, false]);
    expect(db.calls).toEqual([]);
  });

  it("still refuses a declared body over 64 KB", async () => {
    const { handlePublic, added } = await load();
    added({
      path: "/api/public/signed",
      method: "POST",
      raw: true,
      limits: [],
      turnstile: false,
      status: 200,
      service: () => Promise.resolve(new Response("ok")),
    });
    const response = await handlePublic(
      post("/api/public/signed", "x", { headers: { "content-length": "70000" } }),
      "req-12345678",
      catalogDb(),
    );
    expect(response.status).toBe(413);
  });
});
