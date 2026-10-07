// B10 step 0: the owner's one-time consent for the LinkedIn company page. `bun run scripts/linkedin-authorize.ts
// [--target dev]` opens a one-shot listener on http://127.0.0.1:8765/callback, trades the code, stores the token set in
// Vault and adds LINKEDIN_ACCESS_TOKEN and LINKEDIN_REFRESH_TOKEN to `.env`. It prints `stored`, never a token. The
// organisation URN and the API version go in through the Account ids form on screen 12, not through this script.
// The scopes and addresses are ASSUMED until the app is approved and step 3b confirms them (docs/runbooks/social.md).
import {
  authorize,
  exchangeCode,
  randomToken,
  REDIRECT_URI,
  saveConsent,
  waitForCode,
} from "./lib/oauth-consent.ts";
import { requireSecret, runScript } from "./lib/social-script.ts";

const SCOPES = "w_organization_social r_organization_social rw_organization_admin";

async function connect(): Promise<void> {
  const clientId = requireSecret("LINKEDIN_CLIENT_ID");
  const clientSecret = requireSecret("LINKEDIN_CLIENT_SECRET");
  const state = randomToken();
  const consent = new URL("https://www.linkedin.com/oauth/v2/authorization");
  consent.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  }).toString();
  const code = await waitForCode(consent, state);
  const set = await exchangeCode(
    "https://www.linkedin.com/oauth/v2/accessToken",
    new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
    }),
  );
  await saveConsent("linkedin", set);
}

if (import.meta.main) await runScript(() => authorize("linkedin", connect));
