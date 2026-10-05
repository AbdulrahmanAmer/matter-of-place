import { existsSync } from "node:fs";
import { bumpCatalogVersion } from "../fixtures/catalog-version";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

// B4 step 9 (E16, F25 d and j): the edge layer on the built Worker. A page is stored under a key of release and catalog
// version and answered from the store until the version moves; the query string and a cookie are not in the key. The
// Cache API does nothing in `vite dev`, so the spec refuses any other target.

if (process.env["E2E_TARGET"] !== "built") {
  throw new Error(
    "edge-cache.spec.ts needs E2E_TARGET=built: the Cache API does nothing in vite dev",
  );
}

test.describe.configure({ mode: "serial" });

const cacheState = (response: APIResponse) => response.headers()["x-mop-cache"];
const policyOf = (response: APIResponse) =>
  response.headers()["content-security-policy"] ??
  response.headers()["content-security-policy-report-only"];

/**
 * Bumps the version and requests `/properties` until the first answer is a miss. Other projects of the same run load
 * the page too, so a request of theirs can store it between the bump and this request; another bump starts again.
 */
async function firstMiss(request: APIRequestContext) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await bumpCatalogVersion();
    const response = await request.get("/properties");
    await response.body();
    if (cacheState(response) === "miss") return response;
  }
  throw new Error(
    "no miss after five version bumps: something stores /properties as fast as it is bumped",
  );
}

test("a page is a miss, then a hit, and the query string is not in the key", async ({
  request,
}) => {
  const miss = await firstMiss(request);
  const hit = await request.get("/properties");
  await hit.body();
  expect(cacheState(hit)).toBe("hit");
  const other = await request.get(`/properties?x=${String(Math.random()).slice(2)}`);
  await other.body();
  expect(cacheState(other)).toBe("hit");

  const version = miss.headers()["x-catalog-version"];
  expect(version).toBeDefined();
  expect(hit.headers()["x-catalog-version"]).toBe(version);
  expect(other.headers()["x-catalog-version"]).toBe(version);

  expect(policyOf(miss), "the policy header on the miss").toBeDefined();
  expect(policyOf(hit)).toBe(policyOf(miss));
  expect(hit.headers()["x-request-id"]).toBeDefined();
  expect(hit.headers()["x-request-id"]).not.toBe(miss.headers()["x-request-id"]);
});

test("a cookie does not change the key", async ({ request }) => {
  await firstMiss(request);
  const response = await request.get("/properties", { headers: { cookie: "visitor=e2e" } });
  await response.body();
  expect(cacheState(response)).toBe("hit");
});

test("a write answers no-store and is never a hit", async ({ request }) => {
  const response = await request.post("/api/public/inquiries", {
    headers: { "content-type": "application/json" },
    data: Buffer.from("{"),
  });
  expect(response.status()).toBe(400);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(cacheState(response)).not.toBe("hit");
});

const adminExists = existsSync("src/routes/api/admin/me.ts");
test("the admin read answers no-store and is never a hit", async ({ request }) => {
  test.skip(!adminExists, "B7 not landed");
  const response = await request.get("/api/admin/me");
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(cacheState(response)).not.toBe("hit");
});
