// W8 item 10 (rulings H116, H134): a colleague's `social_post` proposal that carries a structured `post` is filed as a
// proposed post, never as a generic approval. Its pictures and reel are files in the studio or the Google Drive folder
// on this laptop, or keys already in storage. The database cannot read this disk, so the runner checks each path lies
// in one of those folders, measures it, uploads it to the public `media` bucket under `proposed/<batch>/` (as the reel
// pass does under `requested/`) and then calls `create_proposed_post`, which checks every key is stored. A post the
// channel rules refuse uploads nothing; the refusal is said in the colleague's thread.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  channelPostSchema,
  channelProblems,
  postFileSchema,
  type ChannelPost,
  type PostFile,
} from "../../src/domain/proposed-posts.ts";
import type { Db } from "../../src/server/lib/db.ts";
import { STUDIO } from "./reel.ts";

/** The social media folder of the company's Google Drive on this laptop: no other Drive file can be proposed. */
export const DRIVE = "G:/My Drive/Matter of Place/Social Media";

const fileRefSchema = z
  .object({
    path: z.string().min(1).max(500).optional(),
    key: postFileSchema.shape.key.optional(),
    alt: z.string().trim().min(1).max(1000),
  })
  .refine(
    (ref) => (ref.path === undefined) !== (ref.key === undefined),
    "A file is a path or a storage key.",
  );
type FileRef = z.infer<typeof fileRefSchema>;

const channelPlanSchema = z.object({
  channel: channelPostSchema.shape.channel,
  format: channelPostSchema.shape.format,
  caption: z.string().trim().min(1).max(5000),
  images: z.array(fileRefSchema).max(20).default([]),
  reel: z
    .object({ video: fileRefSchema, poster: fileRefSchema.nullable().default(null) })
    .nullable()
    .default(null),
});

/** The `post` of a `social_post` proposal: each channel names its files by path or storage key, with alt text. */
export const postPlanSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  property_id: z.string().uuid().optional(),
  submission_id: z.string().uuid().optional(),
  test: z.boolean().default(false),
  channels: z.array(channelPlanSchema).min(1).max(3),
});

/** The line a colleague with `draft_post` reads in its brief: how a post carries its pictures, and what happens next. */
export const POST_TOOL_LINE =
  'A social post you propose carries its pictures: add "post" to its content: {"title": "a short name", "property_id": "the id when it is about a property", "test": true for a rehearsal, "channels": [{"channel": "instagram|x|linkedin", "format": "carousel|single|reel", "caption": "the caption for that channel", "images": [{"path": "the file in the studio or the Google Drive folder", "alt": "what the picture shows"}], "reel": {"video": {"path": "...", "alt": "..."}, "poster": {"path": "...", "alt": "..."}}}]}. Captions: X up to 280 characters, Instagram 2,200, LinkedIn 3,000; a reel on LinkedIn needs its poster; Facebook and YouTube are off. It waits in Proposed posts and nothing posts until a person approves it.';

/** A proposal filed as a proposed post: a social post that carries its `post`. Any other stays a generic approval. */
export function isStructuredPost(proposal: {
  action: string;
  content: { post?: unknown };
}): boolean {
  return proposal.action === "social_post" && proposal.content.post !== undefined;
}

const TYPES: Readonly<Record<string, { type: string; video: boolean }>> = {
  ".jpg": { type: "image/jpeg", video: false },
  ".jpeg": { type: "image/jpeg", video: false },
  ".png": { type: "image/png", video: false },
  ".webp": { type: "image/webp", video: false },
  ".mp4": { type: "video/mp4", video: true },
};

/** What filing reads and writes outside itself; a test passes its own. */
export interface PostDeps {
  /** The studio and the Drive folder: a path outside them is refused. */
  roots: { studio: string; drive: string };
  /** The disk probe: a path that is not in a root by its letters never reaches it. */
  realPath: (path: string) => string | null;
  download: (key: string) => Promise<Uint8Array | null>;
  upload: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  remove: (keys: string[]) => Promise<void>;
  measure: (body: Uint8Array, video: boolean) => Promise<{ w: number; h: number } | null>;
  create: (args: CreateArgs) => Promise<{ id: string } | { refused: string }>;
}

interface CreateArgs {
  p_title: string;
  p_channels: ChannelPost[];
  p_proposer_kind: "agent";
  p_proposer_agent: string;
  p_run: string;
  p_test: boolean;
  p_property?: string;
  p_submission?: string;
}

class Refused extends Error {}

const hash8 = (body: Uint8Array) => createHash("sha256").update(body).digest("hex").slice(0, 8);

/** True when `path` lies below `root`, by their letters. */
function within(path: string, root: string): boolean {
  const from = relative(root, path);
  return from !== "" && !from.startsWith("..") && !isAbsolute(from);
}

/**
 * The real path of `path` when it lies inside `root`, else null. The path must lie in the root by its letters before
 * the disk is touched, so a network or device path (`\\host`, `//host`, `\\?\`) is refused without an existence check,
 * which would reach the host; then by its real path, so a link cannot lead out.
 */
function inside(path: string, root: string, deps: PostDeps): string | null {
  if (!isAbsolute(path) || !within(resolve(path), resolve(root))) return null;
  const real = deps.realPath(path);
  const realRoot = deps.realPath(root);
  return real !== null && realRoot !== null && within(real, realRoot) ? real : null;
}

/** The real path of a file or folder on this disk, or null when there is none. */
function realPath(path: string): string | null {
  return existsSync(path) ? realpathSync(path) : null;
}

async function resolveFile(
  ref: FileRef,
  video: boolean,
  batch: { id: string; uploaded: string[] },
  deps: PostDeps,
): Promise<PostFile> {
  if (ref.key !== undefined) {
    const body = await deps.download(ref.key);
    if (body === null) throw new Refused(`${ref.key} is not in storage`);
    const size = await deps.measure(body, video);
    if (size === null) throw new Refused(`${ref.key} is not ${video ? "a video" : "an image"}`);
    return {
      key: ref.key,
      source: "storage",
      original: null,
      alt: ref.alt,
      ...size,
      bytes: body.length,
    };
  }
  const path = ref.path ?? "";
  const studio = inside(path, deps.roots.studio, deps);
  const real = studio ?? inside(path, deps.roots.drive, deps);
  if (real === null) throw new Refused(`${path} is not in the studio or the Drive folder`);
  const ext = extname(real).toLowerCase();
  const known = TYPES[ext];
  if (known === undefined || known.video !== video)
    throw new Refused(`${path} is not ${video ? "an mp4 video" : "a jpg, png or webp image"}`);
  const body = new Uint8Array(readFileSync(real));
  const size = await deps.measure(body, video);
  if (size === null)
    throw new Refused(`${path} could not be read as ${video ? "a video" : "an image"}`);
  const name =
    basename(real, extname(real))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "file";
  const key = `proposed/${batch.id}/${name}.${hash8(body)}${ext}`;
  await deps.upload(key, body, known.type);
  batch.uploaded.push(key);
  return {
    key,
    source: studio === null ? "drive" : "studio",
    original: path,
    alt: ref.alt,
    ...size,
    bytes: body.length,
  };
}

/**
 * Files one colleague's structured post: the channel rules first (nothing is uploaded for a refused post), then each
 * file found, measured and uploaded, then `create_proposed_post`. Answers the post's id or the reason it was refused.
 */
export async function fileProposedPost(
  deps: PostDeps,
  input: { agent: string; run: string; summary: string; post: unknown },
): Promise<{ id: string } | { refused: string }> {
  const parsed = postPlanSchema.safeParse(input.post);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      refused: `the post is not in the shape asked for (${issue?.path.join(".") ?? ""}: ${issue?.message ?? ""})`,
    };
  }
  const plan = parsed.data;
  const named = plan.channels.map((channel) => channel.channel);
  const problems = [
    ...(new Set(named).size === named.length ? [] : ["each channel is named once"]),
    ...plan.channels.flatMap((channel) => channelProblems(channel)),
  ];
  if (problems.length > 0) return { refused: problems.join(" ") };
  const batch = { id: randomUUID(), uploaded: [] as string[] };
  const { uploaded } = batch;
  const channels: ChannelPost[] = [];
  try {
    for (const channel of plan.channels) {
      const images: PostFile[] = [];
      for (const image of channel.images) images.push(await resolveFile(image, false, batch, deps));
      channels.push({
        channel: channel.channel,
        format: channel.format,
        caption: channel.caption,
        images,
        reel:
          channel.reel === null
            ? null
            : {
                video: await resolveFile(channel.reel.video, true, batch, deps),
                poster:
                  channel.reel.poster === null
                    ? null
                    : await resolveFile(channel.reel.poster, false, batch, deps),
              },
      });
    }
  } catch (error) {
    if (error instanceof Refused) return withdraw(deps, uploaded, error.message);
    throw error;
  }
  // The built channels are what every reader parses later: one the admin list could not parse is never stored.
  const built = z.array(channelPostSchema).safeParse(channels);
  if (!built.success) {
    const issue = built.error.issues[0];
    return withdraw(
      deps,
      uploaded,
      `a file is not in the shape stored (${issue?.path.join(".") ?? ""}: ${issue?.message ?? ""})`,
    );
  }
  const created = await deps.create({
    p_title: plan.title ?? input.summary.slice(0, 200),
    p_channels: built.data,
    p_proposer_kind: "agent",
    p_proposer_agent: input.agent,
    p_run: input.run,
    p_test: plan.test,
    ...(plan.property_id === undefined ? {} : { p_property: plan.property_id }),
    ...(plan.submission_id === undefined ? {} : { p_submission: plan.submission_id }),
  });
  return "id" in created ? created : withdraw(deps, uploaded, created.refused);
}

/** A refused post leaves nothing public: the files this filing uploaded are removed again (keys it was given stay). */
async function withdraw(
  deps: PostDeps,
  uploaded: readonly string[],
  reason: string,
): Promise<{ refused: string }> {
  if (uploaded.length === 0) return { refused: reason };
  try {
    await deps.remove([...uploaded]);
    return { refused: reason };
  } catch {
    return { refused: `${reason} (its ${String(uploaded.length)} uploads could not be removed)` };
  }
}

/** A video's width and height from ffprobe, through a temporary file. */
function videoSize(body: Uint8Array): { w: number; h: number } | null {
  const folder = mkdtempSync(join(tmpdir(), "mop-post-"));
  try {
    const file = join(folder, "video.mp4");
    writeFileSync(file, body);
    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        file,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const [w, h] = probe.stdout.trim().split(",").map(Number);
    return probe.status === 0 &&
      Number.isInteger(w) &&
      Number.isInteger(h) &&
      (w ?? 0) > 0 &&
      (h ?? 0) > 0
      ? { w: w ?? 0, h: h ?? 0 }
      : null;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** The runner's real dependencies: the public `media` bucket and `create_proposed_post` under the service role. */
export function postDeps(db: Db): PostDeps {
  const media = db.storage.from("media");
  return {
    roots: { studio: STUDIO, drive: DRIVE },
    realPath,
    download: async (key) => {
      const { data, error } = await media.download(key);
      return error === null ? new Uint8Array(await data.arrayBuffer()) : null;
    },
    upload: async (key, body, contentType) => {
      const { error } = await media.upload(key, body, {
        contentType,
        upsert: false,
        cacheControl: "31536000",
      });
      if (error !== null) throw new Error(`upload_failed: ${key}`);
    },
    remove: async (keys) => {
      const { error } = await media.remove(keys);
      if (error !== null) throw new Error("remove_failed");
    },
    measure: async (body, video) => {
      if (video) return videoSize(body);
      try {
        const { width, height } = await sharp(body).metadata();
        return width > 0 && height > 0 ? { w: width, h: height } : null;
      } catch {
        return null;
      }
    },
    create: async (args) => {
      const { data, error } = await db.rpc("create_proposed_post", args);
      if (error === null) return { id: data };
      return { refused: error.details || error.message };
    },
  };
}
