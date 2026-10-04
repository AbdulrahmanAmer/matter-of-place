// The Svix signature check of `hooks/resend.ts` against the vector Svix documents for manual verification, so the
// few lines over `crypto.ts` stand in for the `svix` package (CS-04).
import { describe, expect, it } from "vitest";
import { verifySvix } from "../../src/server/hooks/resend";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const BODY = '{"test": 2432232314}';
const HEADERS = {
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: "1614265330",
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};

describe("verifySvix", () => {
  it("accepts Svix's documented vector", async () => {
    expect(await verifySvix(SECRET, HEADERS, BODY)).toBe(true);
  });

  it("accepts the vector among several space-separated signatures", async () => {
    const signature = `v1,AAAA v1a,${HEADERS.signature.slice(3)} ${HEADERS.signature}`;
    expect(await verifySvix(SECRET, { ...HEADERS, signature }, BODY)).toBe(true);
  });

  it("refuses a changed body, id or timestamp", async () => {
    expect(await verifySvix(SECRET, HEADERS, '{"test": 2432232315}')).toBe(false);
    expect(await verifySvix(SECRET, { ...HEADERS, id: "msg_other" }, BODY)).toBe(false);
    expect(await verifySvix(SECRET, { ...HEADERS, timestamp: "1614265331" }, BODY)).toBe(false);
  });

  it("refuses another secret, another version and a signature that is not base64", async () => {
    expect(await verifySvix("whsec_c2Vjb25kLXNlY3JldA==", HEADERS, BODY)).toBe(false);
    const v2 = { ...HEADERS, signature: `v2,${HEADERS.signature.slice(3)}` };
    expect(await verifySvix(SECRET, v2, BODY)).toBe(false);
    expect(await verifySvix(SECRET, { ...HEADERS, signature: "v1,!!!" }, BODY)).toBe(false);
  });
});
