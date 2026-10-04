import { createSign } from "node:crypto";
import { field, getJson, parseJsonOrNull } from "./common.mjs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const LIFETIME_S = 3600;

/**
 * @param {string | Buffer} part
 * @returns {string}
 */
const base64url = (part) => Buffer.from(part).toString("base64url");

/**
 * An access token for the service account in `GOOGLE_SA_JSON_B64` (Search Console and GA4 share it).
 * Returns the reason instead of a token when the credential or the exchange fails.
 * @param {{ saJsonB64: string, scope: string, fetchImpl: import("./common.mjs").Fetch, now: Date }} request
 * @returns {Promise<{ token: string } | { reason: string }>}
 */
export async function accessToken({ saJsonB64, scope, fetchImpl, now }) {
  const account = parseJsonOrNull(Buffer.from(saJsonB64, "base64").toString("utf8"));
  const email = field(account, "client_email");
  const key = field(account, "private_key");
  if (typeof email !== "string" || typeof key !== "string") {
    return { reason: "GOOGLE_SA_JSON_B64 is not a service account key" };
  }
  const issued = Math.floor(now.getTime() / 1000);
  const unsigned = [
    base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64url(
      JSON.stringify({
        iss: email,
        scope,
        aud: TOKEN_URL,
        iat: issued,
        exp: issued + LIFETIME_S,
      }),
    ),
  ].join(".");
  let assertion;
  try {
    assertion = `${unsigned}.${base64url(createSign("RSA-SHA256").update(unsigned).sign(key))}`;
  } catch {
    return { reason: "the service account private key could not sign" };
  }
  const answer = await getJson(fetchImpl, TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: GRANT, assertion }).toString(),
  });
  const token = field(answer.json, "access_token");
  if (answer.status !== 200 || typeof token !== "string") {
    return { reason: `token exchange failed: ${answer.reason}` };
  }
  return { token };
}

/**
 * The window of an analytics query, as `YYYY-MM-DD` strings.
 * @param {Date} now
 * @param {number} days length of the window
 * @param {number} lagDays days between the window's end and today (Search Console is 2 to 3 days behind)
 * @returns {{ startDate: string, endDate: string }}
 */
export function dateWindow(now, days, lagDays) {
  const day = (/** @type {number} */ back) =>
    new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);
  return { startDate: day(lagDays + days - 1), endDate: day(lagDays) };
}
