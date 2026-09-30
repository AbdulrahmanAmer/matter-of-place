# PROJECT STATE

> agent-os reads this file at session start and loads only the current stage's contract.
> Append to the log, never rewrite it. Only the operator advances the STAGE line.

STAGE: 0
enforcement: deny

## OPEN DECISIONS

Full context for each in `workspace/02-tech-stack/tech-stack.md` §B. "Recommended" is Claude's proposal, not a decision.

### D1. Deploy target: Cloudflare Workers (recommended) / Netlify / Lovable hosting — UNDECIDED
### D2. API placement: same Worker via server routes (recommended) / separate Hono Worker — UNDECIDED
### D3. Photography storage: R2 + resizing (recommended) / Supabase Storage — UNDECIDED
### D4. Email provider: Resend (recommended) / Loops / Mailchimp — UNDECIDED
### D5. Payments: Stripe Checkout after editorial acceptance (recommended); which legal entity — UNDECIDED
### D6. Analytics: GA4 + first-party events (recommended); PostHog optional — UNDECIDED
### D7. Error monitoring: Sentry (recommended) / Cloudflare logs only — UNDECIDED
### D8. Admin: Supabase Studio first then /admin (recommended) / /admin before launch — UNDECIDED
### D9. Assets generated on publish at launch: OG + carousel + story + newsletter block (recommended); reel + email for Campaign tier — UNDECIDED
### D10. Social platforms at launch: Instagram + Facebook Page (recommended); Pinterest/LinkedIn month two; human approval first 60 days — UNDECIDED
### D11. AI budget: Haiku captions/alt text, Sonnet templates, rule-based concierge and search at launch (recommended) — UNDECIDED
### D12. Audit cadence and host: weekly cloud routine, patches as PRs (recommended) — UNDECIDED
### D13. Repo — SETTLED 2026-09-30: private repo https://github.com/AbdulrahmanAmer/matter-of-place, root = this folder, branch main

Owner inputs (not decisions): contact email + phone, registered entity + address, Instagram URL, domain registrar,
Meta Business Manager access.

## SETTLED DECISIONS

| # | decision | date | why |
|---|---|---|---|
| S1 | Frontend stays as built: TanStack Start + plain CSS tokens; no redesign | 2026-09-30 | recalibration brief and ADR 0003; build verified green |
| S2 | Database is Supabase Postgres with `docs/database/schema.sql` | 2026-09-30 | ADR 0004; schema already encodes the editorial gate |
| S3 | Markets CA/NY/FL, existing residential only, four products at $295/$695/$1,495/$1,250 | 2026-09-30 | recalibration brief; already in `src/data/exposure.ts` |
| S4 | Workers are Sonnet at medium or lower, Haiku for extraction; Fable orchestrates only | 2026-09-30 | operator requirement: least tokens |
| S5 | Version control: private GitHub repo `AbdulrahmanAmer/matter-of-place`, root = workspace folder, `main` protected later | 2026-09-30 | operator asked for a private repo; one repo keeps maps, agents and code together |
| S6 | Every diagram ships as PNG + SVG in `workspace/03-diagrams/img/` via `render.mjs`, never Mermaid source alone | 2026-09-30 | operator reads pictures, not code |

## LOG - newest at the bottom, append only

- 2026-09-30 Step zero complete: workspace, plugins, agents, graph index, site index, content inventory, map of what we
  have, tech-stack draft, big diagram draft, completion map draft. Build/typecheck/lint verified green. See .claude/POSITION.md.
