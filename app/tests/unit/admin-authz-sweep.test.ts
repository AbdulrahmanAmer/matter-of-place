import "../fixtures/worker-env";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { appRoles } from "../../src/domain/contracts";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { authorize, ForbiddenError } from "../../src/server/lib/authz";

// SEC-04: admin route files stay thin, and every service function that takes `(actor, db, ...)` refuses a roleless
// actor and a scope-less agent before it touches the database. Modules are found by glob: a later slice adds nothing.
const SERVER = fileURLToPath(new URL("../../src/server/", import.meta.url));
const ADMIN_ROUTES = fileURLToPath(new URL("../../src/routes/api/admin/", import.meta.url));

function filesUnder(folder: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = join(folder, entry.name);
    if (entry.isDirectory()) return filesUnder(full, keep);
    return keep(entry.name) ? [full] : [];
  });
}

const ALLOWED_IMPORT =
  /(?:server\/lib\/admin-route|server\/.+\/service|\/domain\/.+|@tanstack\/react-router|zod)$/;

/** What a route file does that it must not: an import outside the wrapper, services and domain, or its own RPC. */
function routeOffences(source: string): string[] {
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
  return [
    ...imports.filter((path) => !ALLOWED_IMPORT.test(path.replace(/\.ts$/, ""))),
    ...(/\bgetDb\b|src\/db\/|\.rpc\(/.test(source) ? ["getDb, src/db or .rpc("] : []),
  ];
}

const roleless: AdminActor = {
  userId: "u-roleless",
  kind: "human",
  roles: [],
  scopes: [],
  requestId: "r",
};
const scopeless: AdminActor = {
  userId: "u-agent",
  kind: "agent",
  roles: appRoles,
  scopes: [],
  requestId: "r",
};

// Any property read on the client is a database call.
const untouchable = new Proxy(
  {},
  {
    get: () => {
      throw new Error("db_touched");
    },
  },
);

type Service = (...args: never[]) => unknown;

function takesActorAndDb(fn: unknown): fn is Service {
  if (typeof fn !== "function") return false;
  const params = /^[^(]*\(([^)]*)\)/.exec(String(fn))?.[1] ?? "";
  const [first, second] = params.split(",").map((name) => name.trim());
  return first === "actor" && second === "db";
}

/** "refused" when the call rejects with `ForbiddenError`, else what it did. */
async function probe(fn: Service, actor: AdminActor): Promise<string> {
  try {
    const result: unknown = Reflect.apply(fn, undefined, [actor, untouchable, {}, {}]);
    await result;
    return "resolved";
  } catch (error) {
    if (error instanceof ForbiddenError) return "refused";
    return error instanceof Error ? error.message : String(error);
  }
}

async function serviceFunctions(): Promise<{ name: string; fn: Service }[]> {
  const found: { name: string; fn: Service }[] = [];
  for (const file of filesUnder(SERVER, (name) => name === "service.ts")) {
    const module: unknown = await import(pathToFileURL(file).href);
    for (const [name, value] of Object.entries(
      typeof module === "object" && module !== null ? module : {},
    )) {
      if (takesActorAndDb(value))
        found.push({ name: `${file.slice(SERVER.length)}#${name}`, fn: value });
    }
  }
  return found;
}

describe("admin route files", () => {
  it("import only the wrapper, services and domain, and make no database call of their own", () => {
    const offending = filesUnder(ADMIN_ROUTES, (name) => name.endsWith(".ts")).flatMap((file) =>
      routeOffences(readFileSync(file, "utf8")).map((offence) => `${file}: ${offence}`),
    );
    expect(offending).toEqual([]);
  });

  it("the check catches a route file that imports the client and calls an RPC", () => {
    const bad =
      'import { getDb } from "../../../server/lib/db";\nconst x = getDb().rpc("decline_submission");';
    expect(routeOffences(bad)).toEqual(["../../../server/lib/db", "getDb, src/db or .rpc("]);
  });
});

describe("admin services", () => {
  it("refuse a roleless actor and a scope-less agent before touching the database", async () => {
    const services = await serviceFunctions();
    const leaks: string[] = [];
    for (const { name, fn } of services) {
      for (const actor of [roleless, scopeless]) {
        const outcome = await probe(fn, actor);
        if (outcome !== "refused") leaks.push(`${name} as ${actor.kind}: ${outcome}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("the probe tells a guarded service from one that touches the database first", async () => {
    type Client = { rpc: (name: string) => Promise<unknown> };
    const guarded = (actor: AdminActor, db: Client) => {
      authorize(actor, "submissions.decline");
      return db.rpc("decline_submission");
    };
    const careless = (_actor: AdminActor, db: Client) => db.rpc("decline_submission");
    const outcomes = [
      await probe(guarded, roleless),
      await probe(guarded, scopeless),
      await probe(careless, roleless),
    ];
    expect(outcomes).toEqual(["refused", "refused", "db_touched"]);
  });
});
