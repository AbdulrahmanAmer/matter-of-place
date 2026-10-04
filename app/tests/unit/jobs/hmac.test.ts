import { describe, expect, it } from "vitest";
import { signBody, verifyBody } from "../../../src/server/lib/hmac";

// The contract vector shared with the render job's callback script (B8 step 7). The signature was
// computed once with node:crypto `createHmac("sha256", SECRET).update(`${TIMESTAMP}.${BODY}`)`.
const SECRET = "render-callback-contract-secret";
const TIMESTAMP = "1791158400";
const BODY =
  '{"job_id":"3f2a9c1d-0000-4000-8000-000000000001","claim":"7d1e0c52-0000-4000-8000-000000000002","status":"done","result":{"files":[]},"run_url":"https://github.com/AbdulrahmanAmer/matter-of-place/actions/runs/1"}';
const SIGNATURE = "sha256=9da8a1d2c55882fea1e279f1c8ca7f5167a73f66ae756d5ad9d534bef1239289";

describe("signBody", () => {
  it("signs the contract vector", async () => {
    expect(await signBody(SECRET, TIMESTAMP, BODY)).toBe(SIGNATURE);
  });
});

describe("verifyBody", () => {
  it("accepts the contract vector", async () => {
    expect(await verifyBody(SECRET, TIMESTAMP, BODY, SIGNATURE)).toBe(true);
  });

  // Signed by this module, so each case isolates the one input it changes.
  it.each([
    ["another secret", "other-secret", TIMESTAMP, BODY, (signed: string) => signed],
    ["another timestamp", SECRET, "1791158401", BODY, (signed: string) => signed],
    [
      "a changed body",
      SECRET,
      TIMESTAMP,
      BODY.replace('"done"', '"failed"'),
      (signed: string) => signed,
    ],
    [
      "a signature without its prefix",
      SECRET,
      TIMESTAMP,
      BODY,
      (signed: string) => signed.slice(7),
    ],
    ["an empty signature", SECRET, TIMESTAMP, BODY, () => ""],
  ])("refuses %s", async (_name, secret, timestamp, body, present) => {
    const signed = await signBody(SECRET, TIMESTAMP, BODY);
    expect(await verifyBody(secret, timestamp, body, present(signed))).toBe(false);
  });
});
