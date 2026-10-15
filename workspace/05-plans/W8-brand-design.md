# W8 items 1 and 2: brand visuals, the design

Built by the orchestrator in parallel with Matter (2026-10-15), in slices, each merged and observed before the next.
The goal: something real to post before the first listing, through the one path that already posts listings.

## What exists (read 2026-10-15)

- `assets.property_id`, `social_posts.property_id` and `campaigns.property_id` are `not null`; 28 files assume a visual
  belongs to a property (render steps, `approve_asset`, `upsert_asset_stub`, `schedule_social_post`,
  `post-to-channel.ts`, reconcile, retention, newsletter, reports, the Visuals screen).
- Posting (`post-to-channel.ts` `loadSubject`) reads the property's `editorial_state` and `campaign_tier` and refuses
  to post a property that is not live: a real guard.
- Live: 0 assets, 0 social posts, Instagram disabled.

## The design: a subject, not a second pipeline

1. **Schema (slice 1).** `assets` and `social_posts` gain `subject public.asset_subject not null default 'property'`
   (`property | brand`) and `brand_key text` (a short slug: `coming-soon`, `market-note-california`, ...).
   `property_id` becomes nullable on both, with a check: `subject = 'property'` exactly when `property_id is not null`,
   and `subject = 'brand'` exactly when `brand_key is not null`. The unique key gains a partial twin for brand rows:
   `(brand_key, kind, revision) where subject = 'brand'`. Every existing row and every existing query keeps working:
   they filter by `property_id`, and a brand row has none. RLS is unchanged (the policies do not read the property).
   `campaigns` is untouched (a campaign is about a property).
2. **Guard (slice 1).** A brand visual may be approved and posted only when its `brand_key` is in the brand catalog
   (`src/domain/brand-posts.ts`: key, kinds allowed, the link it points to, which market) and its caption passes the
   same caption lint as a listing's. That replaces the property's `editorial_state` check for brand rows; listing rows
   keep theirs. Posting refuses a brand row whose key left the catalog.
3. **Render (slice 2).** One step `render_brand` beside the listing render steps, on the same engine (`launch/engine`,
   the reel engine for motion), taking `{brand_key, kind, copy}`; templates live with the engine, one per catalog
   entry. The look comes from the operator's post brief; until it arrives the templates use the brand's palette and
   type as CLAUDE.md sets them, and say so in the PR.
4. **Approve and post (slice 3).** `approve_asset`, `reject_asset`, `rerender_asset`, `set_asset_caption` and
   `schedule_social_post` accept a brand row; `post-to-channel.ts` loads a brand subject (catalog entry instead of the
   property) and builds the link from the catalog. Reconcile and retention read `subject`.
5. **Screen (slice 4).** The Visuals screen lists brand visuals beside listing ones, with a filter.
6. **Item 2 (slice 5).** An approved `social_post` proposal names a `brand_key` (or a property) and its copy; the runner
   turns it into a `render_brand` job, so the decision produces a pending visual with its caption. Approving that
   visual posts it through the existing path.

## Proof per slice

Slice 1: a db test that a brand row needs a key and no property, a property row the reverse, and that the old unique
key still holds; a watched-fail entry each. Slices 2 to 5: a rendered brand visual of each catalog kind, approved and
scheduled on mop-dev (posting proven once Instagram is on, W8 item 6).
