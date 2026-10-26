import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetCards } from "../../src/admin/assets/AssetCards";
import { ProposedPostCard } from "../../src/admin/proposed-posts/ProposedPostCard";
import type {
  PostChannel,
  PostFileView,
} from "../../src/admin/proposed-posts/proposed-posts-labels";
import { AdminProviders } from "../../src/admin/ui/test-providers";
import type { AdminAsset } from "../../src/domain/admin-assets";
import type { AdminProposedPost } from "../../src/domain/proposed-posts";

// The screens `scripts/admin-shot.ts` draws: the real components with captions as long as a real one, a reel and a
// 3,000-character LinkedIn post, over files it makes itself under `.tmp/shots` (see that script). Each scene names the
// card that must hold its contents and the grid cell around it.

const ROOT = resolve(import.meta.dirname, "..", "..");
const url = (name: string) => pathToFileURL(join(ROOT, ".tmp", "shots", name)).href;

const LONG =
  "A quiet house on the creek, kept as it was built. Stone below, cedar above, and a porch that faces the water at the hour the light is best.\n\nShown by appointment. Fairfield, Connecticut.\n\nhttps://matterofplace.com/california/properties/a-very-long-slug-that-does-not-break-anywhere-at-all-0123456789 #matterofplace #quietlyoffered";

const ACTIONS = [
  "assets.approve",
  "assets.reject",
  "assets.re_render",
  "assets.caption",
  "channels.proposed_approve",
  "channels.proposed_reject",
  "channels.proposed_rerender",
];

function asset(
  overrides: Partial<AdminAsset> & Pick<AdminAsset, "id" | "kind" | "status">,
): AdminAsset {
  return {
    subject: "property",
    property_id: "00000000-0000-4000-8000-0000000000a1",
    market_slug: null,
    story_id: null,
    subject_label: null,
    revision: 1,
    caption: LONG,
    alt_text: "A stone house under oaks",
    meta: {},
    files: [],
    rejection_note: null,
    render_error: null,
    job_id: null,
    approved_at: null,
    created_at: "2026-10-16T09:00:00Z",
    updated_at: "2026-10-16T09:00:00Z",
    captions_waiting: false,
    ...overrides,
  };
}

const file = (
  role: AdminAsset["files"][number]["role"],
  name: string,
  w: number,
  h: number,
  index?: number,
): AdminAsset["files"][number] => ({
  role,
  media_key: `shots/${name}`,
  url: url(name),
  w,
  h,
  bytes: 90_000,
  ...(index === undefined ? {} : { index }),
});

const gate = {
  coverage: 91,
  longest_static_s: 0.4,
  cuts: 9,
  avg_shot_s: 1.2,
  lufs: -16,
  true_peak: -1.5,
  flatness: 0.2,
};

const visuals: AdminAsset[] = [
  asset({
    id: "00000000-0000-4000-8000-0000000000b1",
    kind: "cover",
    status: "pending",
    files: [file("main", "cover.jpg", 1200, 630)],
  }),
  asset({
    id: "00000000-0000-4000-8000-0000000000b2",
    kind: "carousel",
    status: "pending",
    files: [0, 1, 2].map((index) => file("slide", "slide.jpg", 1080, 1350, index)),
  }),
  asset({
    id: "00000000-0000-4000-8000-0000000000b3",
    kind: "reel",
    status: "pending",
    files: [file("video", "reel.mp4", 1080, 1920), file("poster", "poster.jpg", 1080, 1920)],
    meta: { duration_s: 12, fps: 30, gate },
  }),
  asset({
    id: "00000000-0000-4000-8000-0000000000b4",
    kind: "story",
    status: "approved",
    files: [file("main", "poster.jpg", 1080, 1920)],
  }),
  asset({
    id: "00000000-0000-4000-8000-0000000000b5",
    kind: "reel",
    status: "rejected",
    caption: "Not every home is for sale. Some are only for the right person.",
    rejection_note: "The door move lands on a hard cut, then repeats a shot. Render it again.",
    files: [file("video", "reel.mp4", 1080, 1920), file("poster", "poster.jpg", 1080, 1920)],
    meta: { duration_s: 12, fps: 30, gate },
  }),
];

/** A picture stored under `key`, drawn from the file `on` of `.tmp/shots`. */
const picture = (key: string, w: number, h: number, on = key): PostFileView => ({
  key: `shots/${key}`,
  source: "studio",
  original: null,
  alt: `A stone house under oaks (${key})`,
  w,
  h,
  bytes: 90_000,
  url: url(on),
});

const post = (
  channel: PostChannel["channel"],
  format: PostChannel["format"],
  caption: string,
  rest: Partial<Pick<PostChannel, "images" | "reel">>,
): PostChannel => ({
  channel,
  format,
  caption,
  images: [],
  reel: null,
  asset_id: null,
  social_post_id: null,
  ...rest,
});

const channels: PostChannel[] = [
  post("instagram", "carousel", LONG, {
    images: [1, 2, 3].map((n) => picture(`slide-${String(n)}.jpg`, 1080, 1350, "slide.jpg")),
  }),
  post("instagram", "reel", "Not every home is for sale.", {
    reel: { video: picture("reel.mp4", 1080, 1920), poster: picture("poster.jpg", 1080, 1920) },
  }),
  post("linkedin", "single", LONG.repeat(6), { images: [picture("cover.jpg", 1200, 630)] }),
  post("x", "single", `${LONG.slice(0, 200)} ${"a".repeat(120)}`, {
    images: [picture("missing-cover.jpg", 1200, 630)],
  }),
];

const proposed = (id: string, over: Partial<AdminProposedPost>): AdminProposedPost => ({
  id,
  title: "Fairfield, CT",
  property_id: null,
  submission_id: null,
  proposer_kind: "agent",
  proposer_agent: "social",
  proposer_user: null,
  test: true,
  status: "proposed",
  revision: 1,
  rejection_note: null,
  approved_at: null,
  channels,
  created_at: "2026-10-16T09:00:00Z",
  updated_at: "2026-10-16T09:00:00Z",
  ...over,
});

export interface Scene {
  /** The static markup of the screen. */
  body: string;
  /** The selector of a card that must hold its contents. */
  card: string;
  /** The selector of the grid cell around a card, which must not cross its neighbour. */
  cell: string;
}

/** The markup of the scene `name`: `visuals` or `proposed`. */
export function renderScene(name: string): Scene {
  if (name === "visuals") {
    return {
      body: renderToStaticMarkup(
        <AdminProviders actions={ACTIONS}>
          <AssetCards items={visuals} />
        </AdminProviders>,
      ),
      card: ".admin-asset",
      cell: ".admin-assets > li",
    };
  }
  if (name === "proposed") {
    return {
      body: renderToStaticMarkup(
        <AdminProviders actions={ACTIONS}>
          <div className="admin-proposed__list">
            <ProposedPostCard post={proposed("00000000-0000-4000-8000-0000000000c1", {})} />
            <ProposedPostCard
              post={proposed("00000000-0000-4000-8000-0000000000c2", {
                status: "rejected",
                rejection_note: "The listing was declined.",
              })}
            />
          </div>
        </AdminProviders>,
      ),
      card: ".admin-proposed__channel",
      cell: ".admin-proposed__channel",
    };
  }
  throw new Error(`scene ${name} is unknown: visuals, proposed`);
}
