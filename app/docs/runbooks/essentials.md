# Essentials runbook

What each security header does, how to change the Content-Security-Policy safely, how to switch it from report-only to enforcing, how to read the evidence, and how to add a cookie. Slice B17 writes this page. Rulings cited are in `workspace/05-plans/ASSUMED.md` section H. The code is `src/server/lib/headers.ts` (the policy and the header table) and `src/server/lib/pipeline.ts` (where they are applied).

Facts here were read from the files named beside them. A line marked UNPROVEN has not been observed yet and says what would settle it.

## Headers

`securityHeaders` sets these on the responses the pipeline finishes (`src/server/lib/pipeline.ts`); `public/_headers` gives the same rows, without the policy, to static files.

| Header                                                             | What it does                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` or `Content-Security-Policy-Report-Only` | lists where scripts, styles, images, fonts, frames and connections may come from; the name depends on `csp_enforce` |
| `Reporting-Endpoints: csp="/api/public/csp-report"`                | names the endpoint that the policy's `report-to csp` points at                                                      |
| `Strict-Transport-Security: max-age=31536000; includeSubDomains`   | tells a browser to use https for a year, subdomains included                                                        |
| `X-Content-Type-Options: nosniff`                                  | stops a browser guessing a content type                                                                             |
| `X-Frame-Options: DENY`                                            | refuses framing; `SAMEORIGIN` on a preview-token page, so the editor can show it                                    |
| `Referrer-Policy: strict-origin-when-cross-origin`                 | sends the full address within our own origin and only the origin to other sites                                     |
| `Permissions-Policy`                                               | turns off camera, microphone, geolocation, payment, usb and interest-cohort                                         |
| `Cross-Origin-Opener-Policy: same-origin`                          | keeps the page out of other sites' window groups                                                                    |
| `Cross-Origin-Resource-Policy: same-site`                          | refuses a load of our responses from another site that has not asked for it                                         |
| `X-DNS-Prefetch-Control: off`                                      | stops speculative DNS lookups                                                                                       |

`Cache-Control` is not in this table. The pipeline, the cache module and `public/_headers` set it.

## The policy

One row per directive in the `POLICY` table of `headers.ts`, each source commented with the slice that needs it. Three rules hold:

- Inline code is allowed by hash and never by nonce, because HTML is cached and identical for every visitor. `inlineHashes` computes the SHA-256 of every inline style and of each inline script that carries TanStack's `class="$tsr"` marker or whose exact text is in `CSP_INLINE_ALLOWLIST` (`src/server/lib/csp-allowlist.ts`). It runs when a page is rendered, which for a cached page is a cache miss, and the cache stores the finished header with the page.
- `script-src` names the single path `https://www.googletagmanager.com/gtag/js`, never a wildcard host.
- `upgrade-insecure-requests` is sent only in the enforcing policy, because a browser ignores it in a report-only policy and logs a console error.

An executable inline script that is neither marked nor allow-listed is left out of the policy, which an enforcing policy blocks. Each render that finds one sends `csp_unexpected_inline_script` to Sentry once.

## Change the policy safely

1. Edit the `POLICY` table, never a header string elsewhere. Add the slice's name in the comment on the row.
2. Run `bunx vitest run tests/unit/essentials.test.ts -t "headers|csp"`. The cases fail on a nonce, a wildcard `script-src`, a media host in `img-src`, a Google Fonts host, an inline script left out of the hashes and a stored page whose policy differs from the one its miss built.
3. Against a local build under `wrangler dev` with a fresh `--persist-to` folder, run `node scripts/csp-proof.mjs http://127.0.0.1:<port>`. It checks that a page carries the hash of every inline script and style it contains.
4. While `csp_enforce` is on, a changed policy is enforced from its first render. To see a new source in reports first, turn the flag off, ship the change, read a week of reports, then turn the flag on.

## Evidence

Reports reach `POST /api/public/csp-report` and become `analytics_events` rows with `event = 'csp_report'` and `data` keys `directive`, `blocked_uri` and `disposition`. The query:

```
bun run db:psql -- -c "select data->>'directive', data->>'blocked_uri', count(*) from analytics_events where event = 'csp_report' and occurred_at > now() - interval '7 days' group by 1, 2"
```

The count is a floor. The endpoint takes 60 requests a minute from one address and drops a report whose directive and blocked address were stored in the last 60 seconds, both counted inside each Worker isolate (`recordCspReports`, `csp-report` cases in `essentials.test.ts`).

A report is unexpected when one of our own pages caused it: it names our own origin, a `script-src` or `style-src` hash, or a Turnstile or GA4 host. Fix that in the table before enforcing. A report whose blocked address is a browser extension comes from the visitor's browser (UNPROVEN: none has been read in our data yet).

### The gtag.js path

If a `script-src` report has a `blocked_uri` that is another path on `www.googletagmanager.com`, change that source to the host `https://www.googletagmanager.com` with no wildcard, and write the path that was seen here.

Path seen: none recorded. UNPROVEN until the report-only reports of a deployed site are read. B13's loader (`src/lib/ga4.ts`) is not on the branch that wrote this page, so no build of it loads gtag.js.

## Switch to enforcing

The switch is the flag `csp_enforce` in `settings.flags`. Its default is false. It is time-gated: it starts seven days after B17 step 1 was deployed, and only when the query above shows no unexpected report. H1 flips it.

1. Open Admin, Settings, Flags and turn on `csp_enforce`. That calls `PUT /api/admin/automation/flags` (permission `automation.flags_put`, human only) and leaves an `automation.flags_put` audit row. The flags editor and that route are B8b's and were not on the branch that wrote this page: UNPROVEN until B8b lands, and until then no other writer of `csp_enforce` is sanctioned.
2. The write moves `catalog_version` through the trigger on `settings`. A Worker isolate rereads the version after `CATALOG_VERSION_TTL_MS` (15 seconds by default), so the next render stores the enforcing header under a new cache key. No purge is needed.
3. Check: `curl -sI https://matterofplace.com/ | grep -i "content-security-policy:"` prints the header without `-report-only`. The same command with `-i "content-security-policy-report-only"` prints nothing.
4. Open the home page, a property page and a form in a browser and confirm the console shows no CSP error.
5. To go back, turn the flag off in the same place. The next render returns to report-only.

After the launch switch there is one database and it is production. An admin does steps 1 to 5 there after a clean report-only week; the launch's last `db:reset` returns the flag to false (ruling H35 (4)).

## Add a cookie

1. Add the row to `cookieInventory` in `src/config/cookies.ts` first. The `/cookies` page renders that list, so a cookie that is not in it is not disclosed.
2. Run `bunx vitest run tests/unit/essentials.test.ts -t consent-version`. It fails and prints `bump CONSENT_VERSION and update the hash to <hash>`.
3. In `src/lib/consent.ts`, set `COOKIE_INVENTORY_HASH` to that hash and raise `CONSENT_VERSION`. A visitor whose stored choice has an older version is asked again.
4. An analytics cookie must belong to Google Analytics: the second `consent-version` case lists exactly `_ga` and `_ga_<id>` as the analytics rows. A new analytics provider is a decision, not a row.

## Field Web Vitals

`src/lib/web-vitals.ts` sends the page's LCP, CLS and INP as `web_vitals` events with `data = { name, value, id }`. `src/routes/_site.tsx` starts it, so `/admin` sends none. The events join the browser batch of `src/lib/analytics.ts` (at most 20 events to a beacon; the queue leaves 10 seconds after its first event and when the page is hidden). Read them with:

```
bun run db:psql -- -c "select data->>'name', count(*), percentile_cont(0.75) within group (order by (data->>'value')::numeric) from analytics_events where event = 'web_vitals' group by 1"
```

A build with no `VITE_API_BASE_URL` sends no event to the API.

## Maintenance

`bun scripts/with-maintenance.ts --value true -- <command>` turns `flags.maintenance` on for the length of a command on `mop-dev`, then puts back the value it read. It is for before the launch switch only; the script's own header gives the rule (ruling H35 (5)). While the flag is on, a GET or HEAD of a public page answers 503 with `Retry-After: 300`; `/admin`, `/api/admin/*`, `/api/hooks/*` and any write pass through (`maintenanceGate` in `pipeline.ts`).
