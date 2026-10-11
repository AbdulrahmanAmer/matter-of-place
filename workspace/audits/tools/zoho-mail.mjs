// Read-only access to the admin mailbox (admin@matterofplace.com) through the Zoho Mail API.
//   node --env-file=.env workspace/audits/tools/zoho-mail.mjs exchange            one-time: ZOHO_GRANT_CODE → ZOHO_REFRESH_TOKEN in .env
//   node --env-file=.env workspace/audits/tools/zoho-mail.mjs list [n]            newest n messages of the inbox (default 25)
//   node --env-file=.env workspace/audits/tools/zoho-mail.mjs search "<text>" [n] messages matching the text (Zoho search syntax)
//   node --env-file=.env workspace/audits/tools/zoho-mail.mjs read <messageId>    one message's text
// Needs ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET (a Self Client in api-console.zoho.com, made by the operator) and, after
// `exchange`, ZOHO_REFRESH_TOKEN. Scopes: ZohoMail.messages.READ, ZohoMail.accounts.READ, ZohoMail.folders.READ.
// Never prints a secret: tokens go straight from the response into .env or into memory.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ACCOUNTS = process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.com";
const MAIL = process.env.ZOHO_MAIL_URL ?? "https://mail.zoho.com";
const ENV_FILE = resolve(process.env.ZOHO_ENV_FILE ?? ".env");

const need = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`zoho-mail: ${name} is not set in .env`);
    process.exit(2);
  }
  return value.trim();
};

async function exchange() {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: need("ZOHO_CLIENT_ID"),
    client_secret: need("ZOHO_CLIENT_SECRET"),
    code: need("ZOHO_GRANT_CODE"),
  });
  const answer = await fetch(`${ACCOUNTS}/oauth/v2/token`, { method: "POST", body });
  const json = await answer.json();
  if (!json.refresh_token) {
    console.error(`zoho-mail: exchange failed: ${json.error ?? answer.status} (a grant code lives 10 minutes and works once)`);
    process.exit(1);
  }
  let text = readFileSync(ENV_FILE, "utf8");
  text = text.replace(/^ZOHO_GRANT_CODE=.*\n?/m, "");
  text = /^ZOHO_REFRESH_TOKEN=/m.test(text)
    ? text.replace(/^ZOHO_REFRESH_TOKEN=.*$/m, `ZOHO_REFRESH_TOKEN=${json.refresh_token}`)
    : `${text.replace(/\n?$/, "\n")}ZOHO_REFRESH_TOKEN=${json.refresh_token}\n`;
  writeFileSync(ENV_FILE, text);
  console.log("zoho-mail: refresh token stored in .env (ZOHO_REFRESH_TOKEN); the grant code line is removed");
}

async function accessToken() {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: need("ZOHO_CLIENT_ID"),
    client_secret: need("ZOHO_CLIENT_SECRET"),
    refresh_token: need("ZOHO_REFRESH_TOKEN"),
  });
  const json = await (await fetch(`${ACCOUNTS}/oauth/v2/token`, { method: "POST", body })).json();
  if (!json.access_token) {
    console.error(`zoho-mail: token refresh failed: ${json.error ?? "no access_token"}`);
    process.exit(1);
  }
  return json.access_token;
}

async function api(token, path) {
  const answer = await fetch(`${MAIL}/api${path}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  const json = await answer.json();
  if (json.status?.code !== 200) {
    console.error(`zoho-mail: ${path.split("?")[0]} answered ${json.status?.code ?? answer.status}: ${json.status?.description ?? ""}`);
    process.exit(1);
  }
  return json.data;
}

const when = (ms) => new Date(Number(ms)).toISOString().slice(0, 16).replace("T", " ");
const row = (m) => `${m.messageId} | ${when(m.receivedTime)} | ${m.fromAddress} | ${m.subject}`;

async function main() {
  const [command = "list", arg, extra] = process.argv.slice(2);
  if (command === "exchange") return exchange();
  const token = await accessToken();
  const accounts = await api(token, "/accounts");
  const account = accounts.find((a) => a.primaryEmailAddress === "admin@matterofplace.com") ?? accounts[0];
  const id = account.accountId;
  if (command === "list") {
    const messages = await api(token, `/accounts/${id}/messages/view?limit=${Number(arg) || 25}&sortorder=false`);
    for (const m of messages) console.log(row(m));
  } else if (command === "search") {
    const messages = await api(token, `/accounts/${id}/messages/search?searchKey=${encodeURIComponent(`entire:${arg}`)}&limit=${Number(extra) || 25}`);
    for (const m of messages) console.log(row(m));
  } else if (command === "read") {
    const list = await api(token, `/accounts/${id}/messages/search?searchKey=${encodeURIComponent("entire:*")}&limit=200`);
    const found = list.find((m) => m.messageId === arg);
    const folder = found?.folderId ?? (await api(token, `/accounts/${id}/folders`)).find((f) => f.folderType === "Inbox").folderId;
    const content = await api(token, `/accounts/${id}/folders/${folder}/messages/${arg}/content`);
    const text = String(content.content ?? "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    console.log(text.slice(0, 6000));
  } else {
    console.error(`zoho-mail: unknown command ${command}`);
    process.exit(2);
  }
}

await main();
