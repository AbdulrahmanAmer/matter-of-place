// How a receiver verifies a Matter of Place webhook, checked against the shared test vector.
// Run from the app folder: `node docs/verify-example.mjs` prints `signature ok`.
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * True when `signature` (the X-MOP-Signature header) is the HMAC-SHA256 of "<timestamp>.<raw body>".
 * Verify over the raw bytes as received, before any JSON parsing.
 * @param {string} secret
 * @param {string} timestamp the X-MOP-Timestamp header
 * @param {string} rawBody
 * @param {string} signature
 */
function verifySignature(secret, timestamp, rawBody, signature) {
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`,
  );
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// A live receiver also refuses an X-MOP-Timestamp more than 300 seconds old; the vector's timestamp is
// fixed, so this example checks the signature only.
const vector = JSON.parse(
  readFileSync(new URL("../tests/unit/omnikom/vector.json", import.meta.url), "utf8"),
);
if (verifySignature(vector.secret, vector.timestamp, vector.body, vector.expected)) {
  console.log("signature ok");
} else {
  console.error("signature mismatch");
  process.exitCode = 1;
}
