# The road to the finish line — Matter of Place, approved stack (2026-09-30)

Everything between today and a live, self-running publication. Three parts: what you set up (accounts and access),
what we build (slices in order, each verified when it lands), and what "finished" means per lane. Stages follow
agent-os; the STAGE line in `PROJECT-STATE.md` moves only when a gate is met.

## Part A — Setup the CEO or owner does once (nothing builds without these)

| # | Setup | Where | Needed by |
|---|---|---|---|
| A1 | DONE 2026-10-01: zone on Cloudflare (Free), nameservers switched, mail records imported; account token `mop-admin` (full write, local `.env` only) and narrow token `mop-github-actions` (exactly Workers Scripts Write, Workers R2 Storage Write and Workers KV Storage Read, ASSUMED E1; no zone, Cache Purge or Tail permission; in GitHub as `CLOUDFLARE_API_TOKEN`); workers.dev subdomain `holy-meadow-4327`. Turnstile widget "matterofplace.com forms" created (site key in GitHub variable `VITE_TURNSTILE_SITE_KEY`, secret in local `.env` as `PROD_TURNSTILE_SECRET`). R2 stays off until further notice (operator, 2026-10-01) | namecheap.com, dash.cloudflare.com | B1 |
| A2 | DONE for dev 2026-10-01: org "Matter Of Place", project `mop-dev` (us-east-1, ref hbokkmpgpqhrnemgsqra); `mop-prod` at launch | supabase.com | B2 |
| A3 | Resend account; verify sending domain (SPF, DKIM, DMARC records in Cloudflare) | resend.com | B5 |
| A11 | DONE 2026-10-01: company email on Zoho Mail (admin@matterofplace.com), MX/SPF/DKIM/DMARC live, records now served by Cloudflare | zoho.com | everything |
| A4 | Invoice template inputs: Omnikom entity, address, payment methods to list (bank, wire, card by phone), invoice numbering. Stripe account only when S32 is revisited | you | B6 |
| A5 | Launch channels are Instagram, X and LinkedIn (S48). Needed: an X developer account and app for the brand handle; a LinkedIn company page plus a developer app with posting access (approval can take days, apply early); and via the partner (access on request): Meta Business Manager; Instagram Business account linked to a Facebook Page; developer app with `instagram_content_publish`, `pages_manage_posts` | business.facebook.com, developers.facebook.com | B10 |
| A6 | DONE 2026-10-01: Sentry org `matter-of-place` (owner admin@matterofplace.com), project `javascript-tanstackstart-react`, error monitoring only; DSN in local `.env` as `SENTRY_DSN`; 14-day trial then free plan, no card | sentry.io | B1 |
| A7 | Google: GA4 property, Search Console for the domain, Tag Manager container; Bing Webmaster | | B13 |
| A8 | DONE 2026-10-01 for B1b and B2: GitHub secrets and variables as measured in ASSUMED E10 (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (UNPROVEN while R2 is off, E8), `SUPABASE_ACCESS_TOKEN`, `DEV_SUPABASE_PROJECT_REF`, `DEV_SUPABASE_DB_PASSWORD`, `PREVIEW_WORKER_SECRETS_JSON` with the service role key inside; variables `VITE_SITE_URL`, `VITE_TURNSTILE_SITE_KEY`), plus the secret `DEV_SUPABASE_SERVICE_ROLE_KEY` and the variable `VITE_API_BASE_URL` (F12). Later keys of `PREVIEW_WORKER_SECRETS_JSON` (`RESEND_WEBHOOK_SECRET` B3, `CONFIRM_TOKEN_SECRET` B5, `PREVIEW_TOKEN_SECRET` B7, `RENDER_CALLBACK_SECRET` and `JOB_RUNNER_SECRET` B8) are added by the orchestrator from `.env`, never by editing `deploy.yml` (F12); the full inventory is tech-stack section 4. Proof: `gh secret list` and `gh variable list` (names only). Branch protection is not available on the free plan for a private repo (CI rule instead, ASSUMED A12, GOTCHAS P-028) | github.com | B1 |
| A9 | DEFERRED (S47): legal entity placeholder, email only (no phone), Instagram after the partner creates it, CEO is admin + chief_editor. Business facts: contact email and phone, legal entity and address, Instagram handle, first editors' emails and roles | you | B4, B7 |
| A10 | DONE 2026-10-01: Lovable disconnected. The repo has no Lovable webhook or deploy key, `git grep -i lovable` in the app finds only the original brief, and the Lovable heart favicon is replaced by the brand emblem (`favicon.svg`, `favicon.ico`, `apple-touch-icon.png`) | lovable.dev | B1 |
| A12 | Anthropic API key (none exists yet, E9). The operator creates it and pastes it into `.env` as `ANTHROPIC_API_KEY` (P-037); the orchestrator sets it as a Supabase function secret with `bunx supabase secrets set ANTHROPIC_API_KEY=... --project-ref $DEV_SUPABASE_PROJECT_REF` (value from `.env`, never printed, never `VITE_*`). Until then `write_captions` returns `retry_at` with reason `anthropic_key_missing` and `bun run scripts/caption-golden.ts` exits 2 with `BLOCKED: no ANTHROPIC_API_KEY`. Proof: `node workspace/05-plans/ready.mjs` shows PASS on "Anthropic API key"; `bunx supabase secrets list --project-ref $DEV_SUPABASE_PROJECT_REF` lists the name | console.anthropic.com | B9 |
| A13 | Fine-grained GitHub token for render dispatch: Contents write on this repository only (the `repository_dispatch` call of B8's `dispatch.ts`). The operator mints it and pastes it into `.env` as `GITHUB_DISPATCH_TOKEN` (P-037); the orchestrator sets it as a Supabase function secret, never a Worker secret (G33). Until then every heavy step returns `retry_at` with reason `dispatch_not_configured`. Proof: `ready.mjs` shows PASS on the dispatch token line; then B8 step 7's heavy self-test (`gh workflow run render.yml` and `gh run watch`) goes green | github.com | B8 step 7, B9, B12 |
| A14 | Omnikom endpoint URL and shared secret, supplied by Omnikom (contract v1 in B15, ASSUMED A21). Stored only as Supabase function secrets `OMNIKOM_WEBHOOK_URL` and `OMNIKOM_WEBHOOK_SECRET`; while the URL is unset the `webhook_omnikom` step returns `done` with `skipped: not_configured`, and B15 proves itself against `scripts/omnikom-mock.ts`. Proof: `ready.mjs` shows PASS on "Omnikom endpoint and secret"; B15 step 7 BLOCKED until then | Omnikom | B15 step 7 |
| A15 | Monitoring access for the audit robot and the harden pass: an uptime monitor account on a free plan with a read-only API key `UPTIME_API_KEY` (ASSUMED UptimeRobot, two monitored URLs; B14 GS-04), and the optional Sentry user token `SENTRY_AUTH_TOKEN` (`org:read`, `project:read`, `event:read`; G11), both created by the operator and kept in the local `.env` (the audit routine's environment receives copies at B14 step 7). Without the Sentry token H1's `sentry-probe.ts` prints `BLOCKED SENTRY_AUTH_TOKEN`; without the uptime key the gauge reads "not measured". Proof: `ready.mjs` shows PASS on the uptime line; `node workspace/audits/tools/run-all.mjs --check-credentials` (B14) prints `ok` for both names | uptimerobot.com, sentry.io | B14, H1, L1 |
| A16 | No operator action: narrow Cloudflare tokens minted by the orchestrator with `mop-admin` (F19, P-037). `mop-cache-purge` (Cache Purge on the one zone) by `node scripts/cf-purge-token.mjs`, written to `.env` as `CF_PURGE_TOKEN` and `CF_ZONE_ID`, then set as Supabase function secrets for `purge_cache` (B8b step 4a; proof `node scripts/cf-purge-token.mjs --check` prints `active`). `CF_ANALYTICS_TOKEN` for the audit robot's Cloudflare gauge (B14 step 4) | dash.cloudflare.com (API) | B8b, B14 |

## Part B — Build slices, in order (owner agent in brackets; each ends with something observed)

### Stage 2 — SYSTEM DESIGN (this document plus the plan file)
| # | Slice | Exit |
|---|---|---|
| P1 | Turn this map into the agent-os plan file with one section per slice: contract, files, verification command | operator reads it; STAGE → 3 |

### Stage 3 — BUILD

**Foundation**
| # | Slice | Exit |
|---|---|---|
| B1 | Repo hygiene: remove Lovable preset (plain Vite + TanStack Start config), `wrangler.toml`, CI (`check`, build), deploy workflow, preview per PR, Sentry wired, security headers [builder] | preview URL renders every route; Sentry receives a test error |
| B2 | Database on the cloud project `mop-dev`, no Docker and no local stack (S50): Supabase CLI init, migrations from a corrected schema (roles, jobs, assets, campaigns, audit columns) applied with `supabase db push --linked`, generated types (`bun run gen:types` writes `src/db/types.ts`), seed script `scripts/seed.ts` from `src/data/*` (`bun run seed -- --target dev --mode full --images skip`); image variants (`scripts/variants.ts`) to R2 BLOCKED until the operator turns R2 on (E8) [builder] | `bun run db:reset` on `mop-dev` exits 0 (no Docker, S50); `bun run check` compiles the generated types; after `bun run seed` 16 properties readable from the dev database through the service role; images to R2 BLOCKED until R2 is on (E8) |
| B3 | API: catalog reads with edge cache + `catalog_version`; writes for inquiries, submissions (signed uploads), subscribers with market interest, events; search; rule-based concierge; rate limits; request logging; Turnstile verification. Flip `VITE_API_BASE_URL` on preview [builder] | every form persists a row; `services.mode === "live"` |
| B3b | Coming-soon mode (S30): empty states for home edit, properties, each market and region with the per-market interest signup; illustrative seed excluded from production; "what is real" viewer statement on any illustrative preview [designer → builder] | production shows zero listings and a signup; preview shows seed |
| B4 | Tests as the safety net: Vitest contracts + state machine, Playwright sweep of every route desktop/phone/a11y, on every PR [builder] | CI red on a broken form, green on main |

**Operate the business**
| # | Slice | Exit |
|---|---|---|
| B5 | Email: Resend domain; transactional set: submission received ("we will review and be in touch"), declined with reason, accepted with next steps, invoice, inquiry acknowledgement, market-interest confirmation, privacy-request acknowledgement (template `subject_ack`, G29); Place Notes double opt-in, every two weeks [builder + designer for the layout] | test subscriber confirms; each template renders and sends |
| B6 | Money box (S32): `payments` table, invoice template (CEO + CTO), invoice PDF from `/admin`, preferred payment method field, "mark paid" + "activate agent" actions, audit trail; Stripe adapter later behind the same table [builder + designer] | an admin issues an invoice and activates a test agent |
| B7 | Admin workspace: auth + five roles, request queue with every submitted detail and photos, decline button with reason list + free text that sends the email without writing it, accept, dossier editor (narrative, facts, sequence, representation), media manager, publish, job and asset approvals, subscriber and interest lists [builder + designer] | an editor reviews, declines one, accepts one, publishes one, all from the UI |
| B8 | Job system: `jobs` table, pgmq, pg_cron runner, GitHub Actions dispatch + signed callback, retries, dead-letter view in admin [builder] | a publish creates jobs that complete and report |
| B8b | Automation console (S34): `automation_recipes`, `email_templates`, `decline_reasons`, `channel_settings`, `schedule_settings`, revisions; `/admin › Automation` with recipe editor, template editor with preview, toggles, approval modes, dry-run; runner reads recipes at trigger time [builder + designer] | an admin switches a step off, publishes, and the dry-run and the real run both skip it |

**Turn listings into content**
| # | Slice | Exit |
|---|---|---|
| B9 | Creative system: `mop-designer` produces rendered options for carousel, story, OG cover, newsletter block, standalone email, reel storyboard; winners become React templates in `src/templates` [designer → builder] | PNGs for one property match the chosen design |
| B10 | Social publishing (S48): on asset approval the publish recipe runs the steps `post_meta` (Instagram through the Meta Graph API, `src/server/jobs/steps/post-meta.ts`), `post_x` (`post-x.ts`) and `post_linkedin` (`post-linkedin.ts`) inside each channel's posting window; Facebook and YouTube exist as disabled channel blocks; the once-a-day social part of B8's `reconcile` system job (`src/server/jobs/system/reconcile.ts`, run every 15 minutes by the `reconcile` row of `schedule_settings`; B10 appends one call to `reconcileSocial` in `src/server/channels/reconcile-social.ts`, guarded to run once a day, G10; no workflow) pulls metrics into `campaign_reports` [builder] | a test post appears on the Instagram account, and on X and LinkedIn (`bun run scripts/meta-test-post.ts` and `scripts/social-test-post.ts --channel x|linkedin`, each printing its permalink); BLOCKED until the accounts exist (A5) and R2 is on (E8) |
| B11 | Newsletter automation: digest every 14 days (S25) assembled from published properties and stories, standalone property email for Campaign tier (template `standalone`, G1) to confirmed Place Notes subscribers of that market, sent through Broadcasts on approval; interest-only signups get one `market_open` mail when their market opens (G15) [builder] | broadcast delivered to a test audience |
| B12 | Reel (S36, S37): heavy step `render_reel` (`src/server/jobs/steps/render-reel.ts`) dispatches `render.yml` in Actions, where `scripts/render-reel.mjs` captures the GSAP + Three.js scene `launch/reel/scene.html` frame by frame in headless Chrome, encodes with ffmpeg, adds synthesized sound only (no music) and runs `launch/tools/motion-gate.mjs`; poster + MP4 to R2 (BLOCKED until R2 is on, E8), attached to the dossier on approval and to the Instagram job (`post_meta`) for Campaign tier only [designer → builder] | MP4 renders with wordmark and captions: `bun scripts/render-reel.mjs --fixture --out ../.tmp/reel-run` prints the gate line today; the end-to-end run on `mop-dev` BLOCKED until R2 is on (E8) |

**Be found**
| # | Slice | Exit |
|---|---|---|
| B13 | SEO/AEO/GEO: JSON-LD per type, sitemap from DB, `llms.txt`, OG images from templates, archive pages (city, architect, style) generated only when the catalog justifies them, keep the title rule green (G-003, enforced by `tests/unit/seo.test.ts`) [builder] | rich-result test passes; llms.txt served; one brand in every title |
| B14 | Audit robot: `mop-auditor` on a Saturday-morning cloud schedule with API credentials, first report, first patch PR [auditor] | report in `workspace/audits/`; PR opened |
| B16 | Legal identity (S33): `siteConfig.legal` = Omnikom entity; footer line, legal, terms and privacy rewritten as "a product of Omnikom"; contact details rendered [builder] | legal page shows the entity; no null contact lines |
| B15 | Omnikom handoff: signed webhook for inquiries and attribution [builder] | payload received by the Omnikom endpoint |
| B17 | Website essentials (wave 3): self-hosted fonts (Jost, Cormorant Garamond, Urbanist, Epilogue; S51) replacing the Google Fonts link (G-014), consent notice, CSP by hashes, icons and manifest, `.well-known` files, contrast check `scripts/contrast.mjs` (G-013), accessibility basics [builder, designer for icons, error pages and the consent notice] | `curl -s <preview>/ \| grep -c fonts.googleapis` prints 0; `node scripts/contrast.mjs` exits 0 (every pair passes); the `essentials` suite passes on the preview |

### Stage 4 — HARDEN
Turnstile everywhere; CSP and HSTS; rate-limit rule live; secrets audit with `claude-security`; RLS reviewed per table;
empty, loading, 404 and 500 states; real legal pages with the entity; illustrative content absent from production (S30;
`illustrative_content` is true only when `settings.environment` is `development` or `preview`, F26 c), labelled on preview only;
Lighthouse ≥ 95 mobile on the six key pages; rollback documented (`wrangler rollback`); backups verified (Supabase PITR
is paid, so B1b's `backup.yml` takes a nightly `pg_dump` through the session pooler, encrypted with `openssl enc` and
`BACKUP_PASSPHRASE` (ASSUMED A20): a workflow artifact today, to the R2 bucket `mop-backups` once the operator turns R2 on (E8);
proof `gh workflow run backup.yml -f target=dev`, then decrypt and `pg_restore --list` the artifact).

### Stage 5 — LAUNCH AND ITERATE
DNS cut-over, production deploy, verify against production, watch Sentry, GA4 and Search Console for a week, first
real property through the whole path (submit → review → accept → pay → publish → post → newsletter), then the weekly
audit loop drives the next slices.

## Part C — What "finished" means, per lane

| Lane | Finished when |
|---|---|
| Website | every route live-mode, cached at the edge, Lighthouse ≥ 95 mobile, no illustrative label on a real property |
| Backend | migrations are the only way the schema changes; types generated; every write validated, rate-limited, logged |
| Admin | an editor can run a week of the business without a developer, and can change what the automations do without a deploy |
| Automations | publish → assets → approval → post and mail, with failures visible and retryable |
| Money | acceptance before invoice enforced in the database; every invoice numbered, every payment marked by a named admin; Stripe can be added without touching the flow |
| Launch honesty | production never shows an illustrative property; every empty collection converts to a market-interest signup |
| Growth | the audit robot has run four weeks in a row and its PRs have shipped |
| Security | claude-security scan clean of highs; secrets only in Cloudflare Worker secrets, Supabase function secrets and GitHub secrets (plus the owner's git-ignored `.env`), as listed in tech-stack section 4 (Meta, X and LinkedIn secrets are Supabase function secrets only, G21); forms bot-proof |

## Not in v1
Developments, international markets, memberships, language switcher, AI-written editorial, client dashboard (an emailed
report first), TikTok and YouTube, real-time anything.
