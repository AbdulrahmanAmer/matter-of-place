// B10 step 0: the owner's one-time consent for X. `bun run scripts/x-authorize.ts [--target dev]` opens a one-shot
// listener on http://127.0.0.1:8765/callback, takes the code with PKCE, stores the token set in Vault and the user id
// and handle in `settings.x`, and adds X_ACCESS_TOKEN and X_REFRESH_TOKEN to `.env`. It prints `stored`, never a token.
// The authorize and token addresses are ASSUMED until step 3a confirms them (docs/runbooks/social.md).
import { z } from "zod";
import {
  authorize,
  exchangeCode,
  pkceChallenge,
  randomToken,
  REDIRECT_URI,
  saveConsent,
  waitForCode,
} from "./lib/oauth-consent.ts";
import { requireSecret, runScript } from "./lib/social-script.ts";

const SCOPES = "tweet.read tweet.write users.read media.write offline.access";
const me = z.object({ data: z.object({ id: z.string(), username: z.string() }) });

async function connect(): Promise<void> {
  const clientId = requireSecret("X_CLIENT_ID");
  const clientSecret = requireSecret("X_CLIENT_SECRET");
  const state = randomToken();
  const verifier = randomToken();
  const consent = new URL("https://x.com/i/oauth2/authorize");
  consent.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
  }).toString();
  const code = await waitForCode(consent, state);
  const set = await exchangeCode(
    "https://api.x.com/2/oauth2/token",
    new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
    { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
  );
  const response = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${set.access_token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`users/me answered ${String(response.status)}`);
  const { data } = me.parse(await response.json());
  await saveConsent("x", set, { user_id: data.id, handle: data.username });
}

if (import.meta.main) await runScript(() => authorize("x", connect));
