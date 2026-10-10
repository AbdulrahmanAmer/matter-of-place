# Search runbook

How the site is made findable and how that is checked. Written for the orchestrator, who sets up Google (decision S59),
and for the owner, who reads the results. Slice B13 step 9 writes it. A sentence marked UNPROVEN has not been run or
seen yet.

## What is already in the code

- `GET /robots.txt` answers per host (`isIndexableHost` in `src/server/seo/robots.ts`): the allow block with a
  `Sitemap:` line on `matterofplace.com` under `MOP_ENV=production`, and `Disallow: /` on every other host, every
  `workers.dev` name included.
- Every response the Worker's pipeline finishes for a host that is not indexable carries `X-Robots-Tag: noindex, nofollow`
  (`src/server/lib/pipeline.ts`), so the preview and the production Worker on its `workers.dev` name are not indexed.
  UNPROVEN: a static file served before the Worker runs may carry no such header.
- `GET /sitemap.xml` lists the pages that belong in the index. An empty market, an empty `/properties`, an archive
  below its threshold, a taken-down property and every redirect source are left out.
- `llms.txt` and `llms-full.txt` are served as plain text.
- The IndexNow key file is `public/651cd80e9c8a4d91d51f3dfa9ac46686.txt`, one line holding its own name. Locally it
  answers 200 with that line.

## Who does what

| Step                                | Who                   | State                                                             |
| ----------------------------------- | --------------------- | ----------------------------------------------------------------- |
| Search Console Domain property      | orchestrator (S59)    | NOT DONE: needs the Search Console login and the Cloudflare zone  |
| Sitemap submission                  | orchestrator or owner | waits for L1, the day the domain is attached to the Worker        |
| Bing Webmaster import               | owner                 | BLOCKED until the Bing Webmaster account exists                   |
| `INDEXNOW_KEY` secret               | orchestrator          | NOT DONE, see IndexNow below                                      |
| Rich Results Test, Schema.org check | owner                 | after L1, on a public page; the tools need a reachable public URL |

The script, the CI steps and this runbook do not wait for Bing.

## Search Console: the Domain property

1. In Search Console choose Add property, then Domain, and enter `matterofplace.com`. Google shows one TXT record that
   starts `google-site-verification=`.
2. In the Cloudflare dashboard open the zone `matterofplace.com`, DNS, and add a TXT record on the root name (`@`) with
   that value.
3. Back in Search Console press Verify. DNS can take a few minutes.

Proof, once the record exists: `dig TXT matterofplace.com +short | grep -c google-site-verification` prints `1`, and
Search Console lists the property as verified. Verification does not need the site to be live or indexable. A Domain
property covers `matterofplace.com` and its subdomains and not `holy-meadow-4327.workers.dev`, which is another domain.

## Sitemap submission (after L1)

Until L1 attaches `matterofplace.com`, nothing is submitted: the sitemap lists addresses on the apex, and the
production Worker answers on `workers.dev` with `noindex`.

After L1, in Search Console open Sitemaps and add `sitemap.xml` to the Domain property. The `Sitemap:` line of
`robots.txt` already lets crawlers find it; the submission is for the report. Check first from a terminal:

```
curl -s https://matterofplace.com/robots.txt
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://matterofplace.com/sitemap.xml
cd app && bun run scripts/check-seo.ts https://matterofplace.com --production
```

The robots body should hold `Allow: /` and `Sitemap: https://matterofplace.com/sitemap.xml`, the sitemap should answer
`200 application/xml`, and the script should print one `ok` per check. UNPROVEN until L1: none of the three has run
against the domain.

Expect Search Console to show "Excluded by noindex" for many pages at launch. The site opens with no published
property, so `/properties` and the empty market pages are `noindex` on purpose (S30). Do not index an empty page to clear
that line. The line shrinks as properties are published.

## Bing Webmaster (optional)

Recorded as `BLOCKED until the Bing Webmaster account exists` (G59). When the owner has the account, Bing Webmaster
Tools can import the verified site from Search Console, and the same `sitemap.xml` is submitted there. Bing also reads
IndexNow pings.

## IndexNow

The `purge_cache` step pings `https://api.indexnow.org/indexnow` for the property of its event, only when its parameter
`indexnow` is on (the default is off, `src/server/automation/step-specs.ts`) and only after a purge that went through.
The ping reads `INDEXNOW_KEY`. Without it the step logs `indexnow_skipped` and carries on; a failed answer logs
`indexnow_failed` and never fails the step (`src/server/jobs/steps/purge-cache.ts`).

To switch it on: set the secret `INDEXNOW_KEY` to `651cd80e9c8a4d91d51f3dfa9ac46686` where the job runner reads its
secrets (an Edge Function secret, per the B13 plan), then turn the parameter on in `/admin › Automation`. The key is
public by IndexNow's design. UNPROVEN: the secret is not set and no ping has been sent. Google does not read IndexNow.

## Running the checks

`scripts/check-seo.ts` crawls a base URL from its sitemap plus the static paths and prints `ok <check>` or
`fail <check>: <problem>` per check, then exits 1 when any check failed.

| Check                 | Fails when                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `sitemap`             | it lists no URL, or a URL with a query string                                                                     |
| `status`              | a crawled page does not answer 200 (a redirect counts as a failure)                                               |
| `head`                | a page lacks one title with the brand once, one description of 70 to 155 characters, the canonical or social tags |
| `unique-descriptions` | two pages share a description                                                                                     |
| `noindex-unlisted`    | a `noindex` page is in the sitemap                                                                                |
| `no-third-party`      | the initial HTML mentions `fonts.googleapis`, `googletagmanager` or `google-analytics`                            |
| `x-robots-tag`        | the header is present on an indexable host, or absent on one that is not                                          |
| `robots`              | the body does not match the host                                                                                  |
| `llms`                | `/llms.txt` is not `text/plain`                                                                                   |
| `gone`                | with `--gone-slug <slug>`, that property does not answer 410                                                      |
| `production`          | with `--production`, the sitemap lists a `/property/` URL while the published list is empty                       |

The `head` check also parses every `ld+json` block through `scripts/validate-jsonld.ts`.

Locally, from `app/`, on the live build (a build without `VITE_API_BASE_URL` renders the bundled catalog, not the
public API):

```
MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/public VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA bun run build
eval "$(node scripts/load-env.mjs --profile dev)"
env -u CLOUDFLARE_API_TOKEN node scripts/dev-vars.mjs
sed -i 's/^MOP_ENV=.*/MOP_ENV=production/' .dev.vars
cp .dev.vars .output/server/.dev.vars
bunx wrangler dev --config .output/server/wrangler.json --port 8788
```

In a second terminal: `curl -s http://127.0.0.1:8788/ | grep -a -o 'data-services="live"'` must print the marker, then
`bun run scripts/check-seo.ts http://127.0.0.1:8788`. Add `--production` to compare the sitemap with
`/api/public/properties`, and `--host pr-1.holy-meadow-4327.workers.dev` to see the answers a preview gives (Wrangler
passes the `Host` header through, observed on 2026-10-07). Run `node scripts/dev-vars.mjs` afterwards to put
`MOP_ENV=local` back, and stop Wrangler by its parent process. On 2026-10-07 under `MOP_ENV=production` against
`mop-dev` the published list was empty and the sitemap held no `/property/` URL, so `--production` passed.

In CI the steps named `seo ...` of the `e2e` job in `.github/workflows/ci.yml` do the same on the downloaded
`build-output`, with the job's own seeded stack: `seo serve`, `seo check`, `seo jsonld`, `seo llms` (it prints a note
and passes while `scripts/validate-llms.ts` does not exist), `seo preview host` and `seo log` (on failure only). They run
with the job: a pull request that is not a draft and that changes `src/`, `supabase/`, `package.json` or `bun.lock`.

## Performance targets

Lighthouse runs once per push, in the `preview` job of `.github/workflows/deploy.yml`: `bun run lhci`, then
`node scripts/perf-targets.mjs .lighthouseci`. The hard limits live in `lighthouserc.json`. The script reads the
reports and prints one `warn` line per page for each tighter target missed: LCP 2000 ms, CLS 0.02, TBT 150 ms, the
WebP `hero` variant above 180 KB, more than two font files. It exits 1 only when a report shows a request to
`googletagmanager.com` or `google-analytics.com`; the lab run never consents, so none is expected.

The SEO category cannot reach 0.95 on the preview, which sends `noindex`. It is judged on a local production-mode
build with the `lhci:local` script of B17 step 8. UNPROVEN: that script does not exist yet.

## After the domain is live

1. Open the Rich Results Test and the Schema.org validator on the home page and one story; breadcrumb, organization and
   article are the types Google shows. `RealEstateListing` and `FAQPage` are valid Schema.org and give no rich result
   in the tool.
2. Open Search Console once a week: Pages (indexed against excluded, and why), Sitemaps (read, with the count), and any
   new error. A 404 or a server error on a sitemap URL is a failure to fix; "Excluded by noindex" on an empty page is not.
