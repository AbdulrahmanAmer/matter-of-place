# Tech stack — recommendation and open decisions (DRAFT for the operator)

Principle: the docs in the codebase already chose Cloudflare in front, Supabase behind, cache between (ADR 0004).
I keep that and fill the gaps the notebook page names. Each row says what I recommend and why; the decision is yours.
Everything deterministic is a script or a platform feature; AI is used only where judgment is needed, at the cheapest
model that does the job.

## A. Recommended stack

| Layer | Recommendation | Why | Decision |
|---|---|---|---|
| Site | Cloudflare Worker (current Nitro build), one zone `matterofplace.com` | build already targets it; edge cache, Image Resizing, R2, Cron, Queues, Turnstile on one bill | D1 |
| API | TanStack Start server routes under `/api/*` in the same Worker | one repo, one deploy, `contracts.ts` shared with zero plumbing; docs allow it | D2 |
| Database | Supabase Postgres, `docs/database/schema.sql` as written | already designed with the editorial gate and cache version triggers | settled by docs |
| Auth | Supabase Auth for editors only; `user_roles` table | public site never talks to Supabase | settled by docs |
| Media | originals in Cloudflare R2, served via `/cdn-cgi/image/...` resizing; submissions bucket in Supabase Storage (private, signed PUT) | zero egress cost on photography; uploads never proxied | D3 |
| Email | Resend: transactional (React Email) + Audiences/Broadcasts for Place Notes, double opt-in, custom domain with SPF/DKIM/DMARC | one provider for both; plugin installed | D4 |
| Payments | Stripe Checkout links sent after editorial acceptance; webhook flips `submissions.state` Awaiting Payment → Scheduled | brief §12: payment never precedes review | D5 |
| Analytics | GTM + GA4 via existing `dataLayer`; first-party `analytics_events`; Cloudflare Web Analytics; Search Console + Bing | typed events already exist; no PII in beacons | D6 |
| Errors | Sentry free tier on the Worker | plugin available; catches SSR 500s the wrapper already normalises | D7 |
| Admin | Phase 1: Supabase Studio + one `publish` endpoint. Phase 2: `/admin` route group behind Supabase Auth: review queue, dossier editor, publish, generated-asset approvals | the pipeline needs a button; Studio has none | D8 |
| Content pipeline | DB trigger on publish → Cloudflare Queue → generator jobs → assets to R2 → approval row → publisher | async, retryable, observable; each generator is a script | D9 |
| Social | Meta Graph API direct (Instagram Business + Facebook Page under one Meta Business account); Pinterest second; LinkedIn company page for the B2B side | fewest accounts, no third-party scheduler subscription | D10 |
| Video | ffmpeg (Ken Burns over gallery + wordmark + captions) rendered in a GitHub Action or Cloudflare Container; templates designed once by `mop-designer` | deterministic, zero AI tokens per reel | D9 |
| Static creative | HTML templates rendered by Cloudflare Browser Rendering → PNG (OG image, carousel slides 1080×1350, story 1080×1920) | one template system for site, social and email | D9 |
| AI usage | Haiku for captions/alt text/digest ordering from editor-written narrative; Sonnet for design templates; rule-based concierge at launch; no AI in the search until the catalog is large | least tokens; the editorial voice stays human | D11 |
| Audit agent | `mop-auditor` on a weekly routine (Claude Code `schedule` cloud routine, or Windows Task Scheduler running `claude -p`); PageSpeed, Search Console, GA4, Graph API, Resend APIs; reports to `workspace/audits/` and PR-ready patches | continuous SEO/AEO/GEO/perf upgrades with evidence | D12 |
| Repo + CI | GitHub (the Lovable-connected repo) → Actions: `bun run check`, build, `wrangler deploy` on main, preview Worker per PR; security-guidance + code-review plugins on PRs | Lovable keeps syncing; deploys come from git, not from Lovable | D13 |
| Security | Turnstile on all four forms, Cloudflare rate-limit rules + API sliding windows, CSP/HSTS headers, secrets via `wrangler secret`, strict RLS, signed uploads with MIME/size caps, Stripe signature check, `claude-security` scan before launch | brief demands enterprise posture | part of HARDEN |

## B. Decisions to answer (write the answer into PROJECT-STATE.md)

- **D1 Deploy target.** Cloudflare Workers (recommended) vs Netlify (Revenue Driven lives there; MCP attached) vs stay on Lovable hosting. Cloudflare wins on media, cron, queues, cache tags.
- **D2 API placement.** Same Worker via server routes (recommended) vs separate Hono Worker (`workers/api`). Separate only if the API will be shared with other Omnikom products soon.
- **D3 Photography storage.** R2 + resizing (recommended) vs Supabase Storage public bucket + resizing. R2 has no egress; Supabase free tier has 5 GB/month.
- **D4 Email provider.** Resend (recommended) vs Loops vs Mailchimp. Resend covers transactional + broadcast; Loops is nicer for marketing automation but is a second account.
- **D5 Payments.** Stripe Checkout after acceptance (recommended). Confirm the legal entity that will hold the Stripe account.
- **D6 Analytics.** GA4 + first-party (recommended); add PostHog only if session replay is wanted.
- **D7 Error monitoring.** Sentry (recommended) vs Cloudflare logs only.
- **D8 Admin.** Studio first, `/admin` second (recommended) vs build `/admin` before launch. Depends on who publishes in month one.
- **D9 Generation scope at launch.** Which assets are generated on publish: OG image, IG carousel, IG story, reel, newsletter block, standalone property email, story draft. Recommended launch set: OG image + carousel + story + newsletter block; reel and standalone email for Campaign tier; story drafts never automatic.
- **D10 Social platforms at launch.** Instagram + Facebook Page (recommended), Pinterest and LinkedIn in month two, no TikTok/YouTube until reels exist. Human approval before every post for the first 60 days.
- **D11 AI budget.** Confirm: Haiku for captions and alt text, Sonnet for templates, no AI in concierge or search at launch.
- **D12 Audit cadence and host.** Weekly, Sunday night, cloud routine (recommended) vs this machine. Patches land as PRs, never direct deploys.
- **D13 Repo.** Where is the Lovable-connected GitHub repo? We need clone access, a `main` branch protection rule, and the Cloudflare API token as a GitHub secret.

Owner inputs still missing regardless of decisions: contact email and phone, registered entity and address, Instagram
URL, domain registrar login for `matterofplace.com`, Meta Business Manager access.

## C. What this stack costs to run (order of magnitude, before paid media)
Cloudflare Workers paid plan (needed for Queues, Browser Rendering) ~$5/month; R2 storage pennies; Supabase free
tier until writes or storage force Pro ($25); Resend free to 3k emails/month then $20; Stripe per transaction; Sentry
free; GitHub Actions free minutes; Claude: weekly audit + per-publish captions, small.
