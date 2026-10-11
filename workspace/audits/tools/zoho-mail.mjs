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

const ACCOUNTS =
  process.env["ZOHO_ACCOUNTS_URL"] ?? "https://accounts.zoho.com";
const MAIL = process.env["ZOHO_MAIL_URL"] ?? "https://mail.zoho.com";
const ENV_FILE = resolve(process.env["ZOHO_ENV_FILE"] ?? ".env");

/**
 * @param {string} name
 * @returns {string}
 */
const need = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`zoho-mail: ${name} is not set in .env`);
    process.exit(2);
  }
  return value.trim();
};

/**
 * @param {URLSearchParams} body
 * @returns {Promise<any>}
 */
const token = async (body) =>
  (await fetch(`${ACCOUNTS}/oauth/v2/token`, { method: "POST", body })).json();

async function exchange() {
  const json = await token(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: need("ZOHO_CLIENT_ID"),
      client_secret: need("ZOHO_CLIENT_SECRET"),
      code: need("ZOHO_GRANT_CODE"),
    }),
  );
  if (!json.refresh_token) {
    console.error(
      `zoho-mail: exchange failed: ${String(json.error ?? "no refresh_token")} (a grant code works once, within minutes)`,
    );
    process.exit(1);
  }
  let text = readFileSync(ENV_FILE, "utf8");
  text = text.replace(/^ZOHO_GRANT_CODE=.*\n?/m, "");
  const line = `ZOHO_REFRESH_TOKEN=${String(json.refresh_token)}`;
  text = /^ZOHO_REFRESH_TOKEN=/m.test(text)
    ? text.replace(/^ZOHO_REFRESH_TOKEN=.*$/m, line)
    : `${text.replace(/\n?$/, "\n")}${line}\n`;
  writeFileSync(ENV_FILE, text);
  console.log(
    "zoho-mail: refresh token stored in .env (ZOHO_REFRESH_TOKEN); the grant code line is removed",
  );
}

/** @returns {Promise<string>} */
async function accessToken() {
  const json = await token(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: need("ZOHO_CLIENT_ID"),
      client_secret: need("ZOHO_CLIENT_SECRET"),
      refresh_token: need("ZOHO_REFRESH_TOKEN"),
    }),
  );
  if (!json.access_token) {
    console.error(
      `zoho-mail: token refresh failed: ${String(json.error ?? "no access_token")}`,
    );
    process.exit(1);
  }
  return String(json.access_token);
}

/**
 * @param {string} access
 * @param {string} path
 * @returns {Promise<any>}
 */
async function api(access, path) {
  const answer = await fetch(`${MAIL}/api${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${access}` },
  });
  /** @type {any} */
  const json = await answer.json();
  if (json.status?.code !== 200) {
    console.error(
      `zoho-mail: ${path.split("?")[0] ?? path} answered ${String(json.status?.code ?? answer.status)}: ${String(json.status?.description ?? "")}`,
    );
    process.exit(1);
  }
  return json.data;
}

/** @param {unknown} ms */
const when = (ms) =>
  new Date(Number(ms)).toISOString().slice(0, 16).replace("T", " ");
/** @param {any} m */
const row = (m) =>
  `${String(m.messageId)} | ${when(m.receivedTime)} | ${String(m.fromAddress)} | ${String(m.subject)}`;

async function main() {
  const [command = "list", arg = "", extra = ""] = process.argv.slice(2);
  if (command === "exchange") return exchange();
  const access = await accessToken();
  /** @type {any[]} */
  const accounts = await api(access, "/accounts");
  const account =
    accounts.find((a) => a.primaryEmailAddress === "admin@matterofplace.com") ??
    accounts[0];
  const id = String(account.accountId);
  if (command === "list") {
    /** @type {any[]} */
    const messages = await api(
      access,
      `/accounts/${id}/messages/view?limit=${String(Number(arg) || 25)}&sortorder=false`,
    );
    for (const m of messages) console.log(row(m));
  } else if (command === "search") {
    /** @type {any[]} */
    const messages = await api(
      access,
      `/accounts/${id}/messages/search?searchKey=${encodeURIComponent(`entire:${arg}`)}&limit=${String(Number(extra) || 25)}`,
    );
    for (const m of messages) console.log(row(m));
  } else if (command === "read") {
    /** @type {any[]} */
    const list = await api(
      access,
      `/accounts/${id}/messages/search?searchKey=${encodeURIComponent("entire:*")}&limit=200`,
    );
    const found = list.find((m) => m.messageId === arg);
    /** @type {any[]} */
    const folders = found ? [] : await api(access, `/accounts/${id}/folders`);
    const folder = String(
      found?.folderId ??
        folders.find((f) => f.folderType === "Inbox")?.folderId,
    );
    /** @type {any} */
    const content = await api(
      access,
      `/accounts/${id}/folders/${folder}/messages/${arg}/content`,
    );
    const text = String(content.content ?? "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    console.log(text.slice(0, 6000));
  } else {
    console.error(`zoho-mail: unknown command ${command}`);
    process.exit(2);
  }
}

await main();
