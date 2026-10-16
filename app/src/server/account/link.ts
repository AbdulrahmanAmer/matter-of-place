import type { Db } from "../lib/db.ts";

// W6 item 7, ruling H114 (4): the client's sign-in link, made by the `send_email` job that mails it (template
// `account_link`), so the token lives only in the email. This file is loaded by the Deno job runner: imports carry `.ts`.

/** The address the link is for is no longer a contact's (archived since it was asked for, or never one). */
export class NotAClient extends Error {
  constructor() {
    super("not_a_client");
    this.name = "NotAClient";
  }
}

/**
 * The link that signs `email` in to the client room: `<site>/account/confirm#token_hash=...`. The token rides in the
 * fragment, which the browser never sends to a server. The auth user is made once and unconfirmed (public sign-ups
 * are off), so its address is confirmed only by the first use of a link, never by the request for one.
 */
export async function accountSignInUrl(db: Db, email: string, siteUrl: string): Promise<string> {
  const known = await db.rpc("account_can_sign_in", { p_email: email });
  if (known.error !== null) throw new Error("email_read_failed:account_can_sign_in");
  if (!known.data) throw new NotAClient();
  const created = await db.auth.admin.createUser({ email, email_confirm: false });
  if (created.error !== null && created.error.code !== "email_exists") {
    throw new Error(`auth_create_failed:${String(created.error.status ?? 0)}`);
  }
  const link = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error !== null) throw new Error(`auth_link_failed:${String(link.error.status ?? 0)}`);
  const token = encodeURIComponent(link.data.properties.hashed_token);
  return `${siteUrl}/account/confirm#token_hash=${token}`;
}
