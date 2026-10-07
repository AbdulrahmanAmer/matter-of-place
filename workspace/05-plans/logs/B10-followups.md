# B10 follow-ups: the orchestrator folds or assigns each before the slice closes

## g1 · steps 0

Reviewer's follow-ups, none blocking, recorded word for word with their evidence. The first one (GOTCHAS.md) is banked as P-2203 and corrected in P-2200.

### app/scripts/lib/oauth-consent.ts

- what: When the consent is refused (the redirect carries `error=access_denied` with the right state), waitForCode rejects correctly. The owner's browser is still shown 200 `Connected. You can close this tab.`, which tells the owner the opposite of what happened. The script prints the real error, so nothing is stored. Only the browser text is wrong.
- evidence: scratch probe: fetch 127.0.0.1:8765/callback?state=S3&error=access_denied printed `refused 200 consent refused: access_denied` (confirmed by running)
- blocking: false

### app/scripts/x-authorize.ts

- what: Owner setup B item 2 has a fallback for when X refuses a loopback callback: paste the `code` into the script's prompt. The script has no such prompt. The author says so in docs/runbooks/social.md ('add one before relying on it'), so it is not a false statement. It is a known gap for step 3a, and it only matters if X refuses 127.0.0.1, which is UNPROVEN.
- evidence: workspace/05-plans/B10.md line 92 ('paste the code ... into the script's prompt'); x-authorize.ts has only waitForCode (read)
- blocking: false

### app/src/server/channels/index.ts

- what: The plan gives `getChannel(name)`, with the registry itself returning the disabled block for a row with enabled=false. The code is `getChannel(name, enabled)`, so the caller reads the row. The log discloses this. Steps 5 and 6 must keep it in mind (every caller must pass the row's real `enabled`), or the plan line should be folded to match.
- evidence: index.ts `export function getChannel(name: SocialChannel, enabled: boolean)` vs B10.md line 117 (read)
- blocking: false

### app/scripts/x-limits-check.ts

- what: x-limits-check --i-mean-it posts a real tweet with whatever token Vault (x_oauth_token) or .env holds, and does not call assertNotProduction. Before the launch switch that is the test handle. After the switch, Vault holds the brand handle's token, so a rerun would put 'Test post <timestamp>' on the brand account. The plan names this script as a step 3a measurement only and does not ask for the guard. This is a suspicion from reading, for L1 or step 3a to decide.
- evidence: x-limits-check.ts main(): no assertNotProduction import; token = get_vault_secret('x_oauth_token') ?? X_ACCESS_TOKEN (read)
- blocking: false

### app/scripts/lib/social-script.ts

- what: The plan says the scripts read secrets 'with the E10 loader' (scripts/load-env.mjs). readSecret instead parses the root .env directly, after checking the shell first. This copies the existing pattern in scripts/resend-domain.ts, so jscpd stays quiet. The dev profile in load-env.mjs does not allow-list META_*, X_* or LINKEDIN_*. This is a deviation from the plan's wording, not a leak. No such names are set in this shell, and no value is printed.
- evidence: social-script.ts readSecret(); load-env.mjs dev profile names (read)
- blocking: false
