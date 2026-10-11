// Read-only access to the admin mailbox (admin@matterofplace.com) through the Zoho Mail API.
//   node --env-file=.env workspace/audits/tools/zoho-mail.mjs exchange            one-time: ZOHO_GRANT_CODE → ZOHO_REFRESH_TOKEN in .env
//   node --env-file=.env workspace/audits/tools/zoho-mail.mjs list [n]            newest n messages of the inbox (default 25)
//   node --env-file=.env workspace/audits/tools/zoho-mail.mjs search "<text>" [n] messages matching the text (Zoho search syntax)
//   node --env-file=.env workspace/audits/tools/zoho-mail.mjs read <messageId>    one message's text
// Needs ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET (a Self Client in api-console.zoho.com) and, after `exchange`,
// ZOHO_REFRESH_TOKEN. Scopes: ZohoMail.messages.READ, ZohoMail.accounts.READ, ZohoMail.folders.READ.
// Never prints a secret: tokens go straight from the response into .env or into memory.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { field, recordsOf } from "./common.mjs";

const ACCOUNTS = process.env["ZOHO_ACCOUNTS_URL"] ?? "https://accounts.zoho.com";
const MAIL = process.env["ZOHO_MAIL_URL"] ?? "https://mail.zoho.com";
const ENV_FILE = resolve(process.env["ZOHO_ENV_FILE"] ?? ".env");

/** @param {unknown} value */
const str = (value) =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

/**
 * @param {string} line
 * @param {number} [code]
 * @returns {never}
 */
function fail(line, code = 1) {
  process.stderr.write(`zoho-mail: ${line}\n`);
  process.exit(code);
}

/** @param {string} name */
function need(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is not set in .env`, 2);
  return value.trim();
}

/**
 * @param {Record<string, string>} params
 * @returns {Promise<unknown>}
 */
async function oauth(params) {
  const answer = await fetch(`${ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    body: new URLSearchParams(params),
  });
  return /** @type {unknown} */ (await answer.json());
}

async function exchange() {
  const json = await oauth({
    grant_type: "authorization_code",
    client_id: need("ZOHO_CLIENT_ID"),
    client_secret: need("ZOHO_CLIENT_SECRET"),
    code: need("ZOHO_GRANT_CODE"),
  });
  const refresh = str(field(json, "refresh_token"));
  if (!refresh) {
    fail(
      `exchange failed: ${str(field(json, "error")) || "no refresh_token"} (a grant code works once, within minutes)`,
    );
  }
  let text = readFileSync(ENV_FILE, "utf8");
  text = text.replace(/^ZOHO_GRANT_CODE=.*\n?/m, "");
  const line = `ZOHO_REFRESH_TOKEN=${refresh}`;
  text = /^ZOHO_REFRESH_TOKEN=/m.test(text)
    ? text.replace(/^ZOHO_REFRESH_TOKEN=.*$/m, line)
    : `${text.replace(/\n?$/, "\n")}${line}\n`;
  writeFileSync(ENV_FILE, text);
  process.stdout.write(
    "zoho-mail: refresh token stored in .env (ZOHO_REFRESH_TOKEN); the grant code line is removed\n",
  );
}

async function accessToken() {
  const json = await oauth({
    grant_type: "refresh_token",
    client_id: need("ZOHO_CLIENT_ID"),
    client_secret: need("ZOHO_CLIENT_SECRET"),
    refresh_token: need("ZOHO_REFRESH_TOKEN"),
  });
  const access = str(field(json, "access_token"));
  if (!access) fail(`token refresh failed: ${str(field(json, "error")) || "no access_token"}`);
  return access;
}

/**
 * @param {string} access
 * @param {string} path
 * @returns {Promise<unknown>}
 */
async function api(access, path) {
  const answer = await fetch(`${MAIL}/api${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${access}` },
  });
  const json = /** @type {unknown} */ (await answer.json());
  const status = field(json, "status");
  if (field(status, "code") !== 200) {
    fail(
      `${path.split("?")[0] ?? path} answered ${str(field(status, "code")) || String(answer.status)}: ${str(field(status, "description"))}`,
    );
  }
  return field(json, "data");
}

/** @param {unknown} ms */
const when = (ms) => new Date(Number(str(ms))).toISOString().slice(0, 16).replace("T", " ");
/** @param {unknown} m */
const row = (m) =>
  `${str(field(m, "messageId"))} | ${when(field(m, "receivedTime"))} | ${str(field(m, "fromAddress"))} | ${str(field(m, "subject"))}\n`;

async function main() {
  const [command = "list", arg = "", extra = ""] = process.argv.slice(2);
  if (command === "exchange") {
    await exchange();
    return;
  }
  const access = await accessToken();
  const accounts = recordsOf(await api(access, "/accounts"));
  const account =
    accounts.find((a) => field(a, "primaryEmailAddress") === "admin@matterofplace.com") ??
    accounts[0];
  const id = str(field(account, "accountId"));
  if (command === "list") {
    const path = `/accounts/${id}/messages/view?limit=${String(Number(arg) || 25)}&sortorder=false`;
    for (const m of recordsOf(await api(access, path))) process.stdout.write(row(m));
  } else if (command === "search") {
    const key = encodeURIComponent(`entire:${arg}`);
    const path = `/accounts/${id}/messages/search?searchKey=${key}&limit=${String(Number(extra) || 25)}`;
    for (const m of recordsOf(await api(access, path))) process.stdout.write(row(m));
  } else if (command === "read") {
    const all = encodeURIComponent("entire:*");
    const list = recordsOf(
      await api(access, `/accounts/${id}/messages/search?searchKey=${all}&limit=200`),
    );
    const found = list.find((m) => field(m, "messageId") === arg);
    const inbox = found
      ? undefined
      : recordsOf(await api(access, `/accounts/${id}/folders`)).find(
          (f) => field(f, "folderType") === "Inbox",
        );
    const folder = str(field(found ?? inbox, "folderId"));
    const content = await api(access, `/accounts/${id}/folders/${folder}/messages/${arg}/content`);
    const text = str(field(content, "content"))
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    process.stdout.write(`${text.slice(0, 6000)}\n`);
  } else {
    fail(`unknown command ${command}`, 2);
  }
}

await main();
