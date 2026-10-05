// Job type `render_reel` (B12): the `reel` job of render.yml runs this script; `render-job.mjs` never sees the type.
// Everything runs in the foreground (P-017): the scene of `launch/reel` is captured, mixed, encoded and gated, both
// files are named by content and uploaded to bucket `media`, and only then is `result.json` overwritten, which the
// workflow's `post-callback.mjs` step posts. By hand: `bun scripts/render-reel.mjs --fixture --out <dir>` renders the
// fixture property and touches no network.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { mediaKey } from "./lib/media-key.mjs";
import { getObject, putIfMissing } from "./lib/media-store.mjs";
import { extractPoster } from "./reel-poster.mjs";
import { checkJob } from "./render-job.mjs";

const APP = resolve(import.meta.dirname, "..");
const LAUNCH = resolve(APP, "../launch");
const WORK = join(APP, ".tmp/reel");
// WORK as the scene sees it: `launch/engine/serve.mjs` serves the repository root.
const SERVED = "/app/.tmp/reel";
const SCENE = join(LAUNCH, "reel/scene.html");
const W = 1080;
const H = 1920;
const FPS = 30;
// The MP4 ceiling of ASSUMED H33 (8); `--maxrate 3500` keeps a reel of up to 25 s under it.
export const MAX_BYTES = 12_000_000;
// A fixture posts no callback, so its job is checked with the site's own address in place of one.
const SITE = "https://matterofplace.com/";
const CONTENT_TYPE = { video: "video/mp4", poster: "image/jpeg" };

/** The result a step timeout leaves behind: written before the render starts, overwritten when it ends. */
export const PROVISIONAL = { status: "failed", error: "reel_timeout", retryable: false };

const shotSchema = z.object({ key: z.string().min(1) }).passthrough();
const specSchema = z
  .object({ kind: z.literal("reel"), shots: z.array(shotSchema).min(4) })
  .passthrough();
const fixtureData = z.object({ fixture: z.literal(true) });
const fixtureJob = z.object({ payload: z.object({ data: fixtureData }) }).passthrough();
const jobData = z.object({
  property_id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  spec: specSchema,
});
const gateSchema = z.object({
  pass: z.boolean(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), value: z.string() })),
  coverage: z.number(),
  longest_static_s: z.number(),
  cuts: z.number(),
  avg_shot_s: z.number(),
  lufs: z.number().nullable(),
  true_peak: z.number().nullable(),
  flatness: z.number().nullable(),
});
const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      r_frame_rate: z.string(),
    }),
  ),
  format: z.object({ duration: z.string() }),
});

/**
 * @typedef {z.infer<typeof gateSchema>} GateReport
 * @typedef {{ width: number, height: number, fps: number, video: string, audio: string, duration: number,
 *   bytes: number }} Probe
 * @typedef {{ role: "video" | "poster", media_key: string, w: number, h: number, bytes: number }} ReelFile
 */

/**
 * The failure path of the Contract: a Storage outage, a failed download or a failed upload is retried with B8's
 * backoff; every other failure (gate, probe, timeout, a refused job, a crashed render) is final, so a broken render
 * does not spend five runs of Actions minutes (P-009).
 * @param {unknown} error
 * @returns {{ status: "failed", error: string, retryable: boolean }}
 */
export function resultFor(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: "failed",
    error: message,
    retryable: /^(storage_unavailable$|media-store: )/.test(message),
  };
}

/**
 * @param {GateReport} report
 * @returns {string | null} `gate_failed: <check> <value>` of the first failed check, or null when the gate passed
 */
export function gateError(report) {
  const failed = report.checks.find((check) => !check.ok);
  return failed === undefined ? null : `gate_failed: ${failed.name} ${failed.value}`;
}

/**
 * @param {Probe} probe
 * @returns {string | null} `gate_failed: probe <value>` of the first mismatch, or null when the file is a reel
 */
export function probeError(probe) {
  if (probe.width !== W || probe.height !== H) {
    return `gate_failed: probe format ${String(probe.width)}x${String(probe.height)}`;
  }
  if (probe.fps !== FPS) return `gate_failed: probe fps ${String(probe.fps)}`;
  if (probe.video !== "h264") return `gate_failed: probe video ${probe.video}`;
  if (probe.audio !== "aac") return `gate_failed: probe audio ${probe.audio}`;
  if (probe.duration < 15 || probe.duration > 25) {
    return `gate_failed: probe duration ${String(probe.duration)}`;
  }
  if (probe.bytes > MAX_BYTES) return `gate_failed: probe size ${String(probe.bytes)}`;
  return null;
}

/**
 * The property, revision and spec of a job: B8's `dispatchHeavy` merges the spec into `payload.data`; the fixture job
 * reads `launch/reel/fixture-spec.json` instead.
 * @param {import("./render-job.mjs").RenderJob} job
 */
export function reelInput(job) {
  if (fixtureData.safeParse(job.payload.data).success) {
    const spec = specSchema.parse(
      JSON.parse(readFileSync(join(LAUNCH, "reel/fixture-spec.json"), "utf8")),
    );
    return { fixture: true, propertyId: "fixture", revision: 0, spec };
  }
  const data = jobData.safeParse(job.payload.data);
  if (!data.success) throw new Error("job_unreadable");
  return {
    fixture: false,
    propertyId: data.data.property_id,
    revision: data.data.revision,
    spec: data.data.spec,
  };
}

/**
 * @param {{ propertyId: string, revision: number, video: Uint8Array, poster: Uint8Array }} rendered
 * @returns {ReelFile[]} the two files under their content-hashed keys (F24): a re-render is a new key
 */
export function reelFiles({ propertyId, revision, video, poster }) {
  /** @type {(name: string, bytes: Uint8Array, ext: string) => string} */
  const key = (name, bytes, ext) =>
    mediaKey({ propertyId, kind: "reel", revision, name, bytes, ext });
  return [
    { role: "video", media_key: key("reel", video, "mp4"), w: W, h: H, bytes: video.length },
    { role: "poster", media_key: key("poster", poster, "jpg"), w: W, h: H, bytes: poster.length },
  ];
}

/**
 * @param {string} raw the job JSON
 * @returns {import("./render-job.mjs").RenderJob}
 */
function readJob(raw) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("job_unreadable");
  }
  const fixture = fixtureJob.safeParse(parsed);
  return checkJob(fixture.success ? { ...fixture.data, callback_url: SITE } : parsed);
}

/**
 * Runs one engine script with node in the foreground, its output in this log.
 * @param {string[]} args
 */
function node(args) {
  const run = spawnSync("node", args, { cwd: APP, stdio: "inherit" });
  if (run.status !== 0) {
    throw new Error(`${basename(args[0] ?? "node")} exited ${String(run.status)}`);
  }
}

/**
 * Each shot gains `src`, its served path: the repository file for the fixture, else the stripped copy read from
 * bucket `media` into `shots/`, once per key (the grid tiles reuse the camera shots).
 * @param {z.infer<typeof shotSchema>[]} shots
 * @param {boolean} fixture
 */
async function stage(shots, fixture) {
  mkdirSync(join(WORK, "shots"), { recursive: true });
  /** @type {Map<string, string>} */
  const local = new Map();
  const staged = [];
  for (const shot of shots) {
    let src = fixture ? `/${shot.key}` : local.get(shot.key);
    if (src === undefined) {
      const name = `${String(local.size)}${extname(shot.key)}`;
      writeFileSync(join(WORK, "shots", name), await getObject("media", shot.key));
      src = `${SERVED}/shots/${name}`;
      local.set(shot.key, src);
    }
    staged.push({ ...shot, src });
  }
  return staged;
}

/**
 * @param {string} mp4
 * @returns {GateReport}
 */
function motionGate(mp4) {
  const json = join(WORK, "gate.json");
  spawnSync(
    "node",
    [
      join(LAUNCH, "tools/motion-gate.mjs"),
      mp4,
      ...["--w", String(W), "--h", String(H), "--min-s", "15", "--max-s", "25"],
      ...["--min-cuts", "3", "--max-cuts", "8", "--json", json],
    ],
    { cwd: APP, stdio: "inherit" },
  );
  let text;
  try {
    text = readFileSync(json, "utf8");
  } catch (error) {
    throw new Error("motion-gate.mjs wrote no report", { cause: error });
  }
  return gateSchema.parse(JSON.parse(text));
}

/**
 * @param {string} mp4
 * @returns {Probe}
 */
function probeFile(mp4) {
  const run = spawnSync(
    "ffprobe",
    [
      ...["-v", "error", "-of", "json", "-show_entries"],
      "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration",
      mp4,
    ],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`ffprobe exited ${String(run.status)}`);
  const { streams, format } = probeSchema.parse(JSON.parse(run.stdout));
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const [frames = 0, per = 1] = (video?.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: frames / per,
    video: video?.codec_name ?? "none",
    audio: audio?.codec_name ?? "none",
    duration: Number(format.duration),
    bytes: statSync(mp4).size,
  };
}

/**
 * @param {string} raw the job JSON
 * @param {string | undefined} out a folder that receives the files in place of the upload
 */
async function render(raw, out) {
  const input = reelInput(readJob(raw));
  const spec = { ...input.spec, shots: await stage(input.spec.shots, input.fixture) };
  const specFile = join(WORK, "spec.json");
  writeFileSync(specFile, JSON.stringify(spec));
  node([join(LAUNCH, "reel/cues.mjs"), specFile, join(WORK, "cues.json")]);
  const query = `spec=${SERVED}/spec.json&cues=${SERVED}/cues.json`;
  const workers = String(Math.min(4, availableParallelism()));
  node([
    ...[join(LAUNCH, "engine/capture.mjs"), SCENE, "--query", query, "--workers", workers],
    ...["--w", String(W), "--h", String(H), "--out", join(WORK, "frames")],
  ]);
  node([join(LAUNCH, "engine/audio.mjs"), SCENE, join(WORK, "audio.wav"), "--query", query]);
  node([join(LAUNCH, "engine/encode.mjs"), WORK, "--name", "reel.mp4", "--maxrate", "3500"]);

  const mp4 = join(WORK, "reel.mp4");
  const gate = motionGate(mp4);
  const gateFailure = gateError(gate);
  if (gateFailure !== null) throw new Error(gateFailure);
  node([join(LAUNCH, "engine/probe.mjs"), "flat", join(WORK, "audio-norm.wav")]);
  const probe = probeFile(mp4);
  const probeFailure = probeError(probe);
  if (probeFailure !== null) throw new Error(probeFailure);

  const video = readFileSync(mp4);
  const poster = await extractPoster(mp4);
  const files = reelFiles({ ...input, video, poster });
  const target = resolve(out ?? join(WORK, "out"));
  mkdirSync(target, { recursive: true });
  const bodies = { video, poster };
  for (const file of files) {
    writeFileSync(join(target, basename(file.media_key)), bodies[file.role]);
  }
  rmSync(join(WORK, "frames"), { recursive: true, force: true });
  console.log("frames removed");
  if (out === undefined && !input.fixture) {
    for (const file of files) {
      await putIfMissing("media", file.media_key, bodies[file.role], CONTENT_TYPE[file.role]);
    }
  }
  console.log(`reel ${String(W)}x${String(H)} ${String(FPS)}fps ok`);
  const { coverage, longest_static_s, cuts, avg_shot_s, lufs, true_peak, flatness } = gate;
  return {
    files,
    meta: {
      duration_s: probe.duration,
      fps: probe.fps,
      gate: { coverage, longest_static_s, cuts, avg_shot_s, lufs, true_peak, flatness },
    },
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { fixture: { type: "boolean" }, out: { type: "string" } },
  });
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const resultFile = join(process.env["RUNNER_TEMP"] ?? WORK, "result.json");
  writeFileSync(resultFile, JSON.stringify(PROVISIONAL));
  /** @type {{ status: "done", result: unknown } | ReturnType<typeof resultFor>} */
  let outcome;
  try {
    const raw =
      values.fixture === true
        ? readFileSync(join(LAUNCH, "reel/fixture-job.json"), "utf8")
        : (process.env["MOP_JOB"] ?? "");
    outcome = { status: "done", result: await render(raw, values.out) };
  } catch (error) {
    outcome = resultFor(error);
    console.error(`render-reel: failed ${outcome.error}`);
    process.exitCode = 1;
  }
  writeFileSync(resultFile, JSON.stringify(outcome));
}
