// Job type `render_reel` (B12): the `reel` job of render.yml runs this script; `render-job.mjs` never sees the type.
// Everything runs in the foreground (P-017): the scene of `launch/reel` is captured, mixed, encoded and gated, both
// files are named by content and uploaded to bucket `media` (a fixture job or `--out` uploads nothing), and only then
// is `result.json` overwritten, which the workflow's `post-callback.mjs` step posts. By hand:
// `bun scripts/render-reel.mjs --fixture --out <dir>` renders the fixture property and touches no network.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
 * The longest one engine script, the motion gate or `bun install` may run: the reel's capture took 836 s with the
 * laptop loaded (P-2100) and every other one takes seconds to minutes. A studio pass's watchdog is a timer, so it acts
 * only between two children: with none longer than this it acts by its 3 h and a quarter hour, which is the sweep's
 * PASS_CAP_MS (`sweep.ts`, "room for that watchdog to act first"); past that the sweep ends the pass.
 */
export const CHILD_LIMIT_MS = 15 * 60_000;

/** The longest ffprobe or ffmpeg may run on one reel of up to 25 s, or on its poster: a minute is slow already. */
export const FFMPEG_LIMIT_MS = 5 * 60_000;

/**
 * `spawnSync` with a limit (W8 item 1, round 6): past `limitMs` the child is killed and this throws why, so a hung
 * Chrome or ffmpeg is a failed step with its reason, never a pass blocked for good. A browser the killed child had
 * started is left without its parent, and the sweep ends it ("the render that started it is gone").
 * @param {string} command
 * @param {string[]} args
 * @param {import("node:child_process").SpawnSyncOptionsWithStringEncoding} options
 * @param {number} limitMs
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
export function spawnLimited(command, args, options, limitMs) {
  const run = spawnSync(command, args, { ...options, timeout: limitMs, killSignal: "SIGKILL" });
  if (run.error !== undefined && "code" in run.error && run.error.code === "ETIMEDOUT") {
    const what = basename(args[0] ?? command);
    throw new Error(`${what} timed out after ${String(limitMs / 1000)} s and was ended`);
  }
  return run;
}

/**
 * Runs one engine script with node in the foreground, its output in this log.
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env] the script's environment; the runner's own when not given
 */
function node(args, env) {
  const run = spawnLimited(
    "node",
    args,
    { cwd: APP, encoding: "utf8", stdio: "inherit", ...(env === undefined ? {} : { env }) },
    CHILD_LIMIT_MS,
  );
  if (run.status !== 0) {
    throw new Error(`${basename(args[0] ?? "node")} exited ${String(run.status)}`);
  }
}

// What a cue script needs from the environment, by name in upper case: node on the path and the system's folders.
const CUE_ENV = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
]);

/**
 * A cue script's environment: no key, no token, nothing that configures node (review of 2026-10-19). A requested
 * reel's `cues.mjs` is a file its designer wrote in the studio, and the runner's environment holds the database key.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv}
 */
export function cueEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => CUE_ENV.has(name.toUpperCase())),
  );
}

/**
 * Runs a cue script on a spec into its cue file, with `cueEnv`.
 * @param {string} cues
 * @param {string} specFile
 * @param {string} out
 */
export function runCues(cues, specFile, out) {
  node([cues, specFile, out], cueEnv());
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
  spawnLimited(
    "node",
    [
      join(LAUNCH, "tools/motion-gate.mjs"),
      mp4,
      ...["--w", String(W), "--h", String(H), "--min-s", "15", "--max-s", "25"],
      ...["--min-cuts", "3", "--max-cuts", "8", "--json", json],
    ],
    { cwd: APP, encoding: "utf8", stdio: "inherit" },
    CHILD_LIMIT_MS,
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
  const run = spawnLimited(
    "ffprobe",
    [
      ...["-v", "error", "-of", "json", "-show_entries"],
      "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration",
      mp4,
    ],
    { encoding: "utf8" },
    FFMPEG_LIMIT_MS,
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
 * The motion gate and the probe of a finished reel file; throws the first failed check.
 * @param {string} mp4
 * @param {(() => void) | undefined} [between] runs after the gate and before the probe
 */
export function gateReel(mp4, between) {
  const gate = motionGate(mp4);
  const gateFailure = gateError(gate);
  if (gateFailure !== null) throw new Error(gateFailure);
  between?.();
  const probe = probeFile(mp4);
  const probeFailure = probeError(probe);
  if (probeFailure !== null) throw new Error(probeFailure);
  return { gate, probe };
}

/**
 * One scene filmed in WORK: its cue script scores the spec, the engine captures, mixes and encodes, and the gate and
 * probe judge the file. The property reel and a requested reel (W7 E2) both go through here.
 * @param {{ scene: string, cues: string, spec: unknown }} input the scene page and its cue script, under ROOT
 */
function film({ scene, cues, spec }) {
  const specFile = join(WORK, "spec.json");
  writeFileSync(specFile, JSON.stringify(spec));
  runCues(cues, specFile, join(WORK, "cues.json"));
  const query = `spec=${SERVED}/spec.json&cues=${SERVED}/cues.json`;
  const workers = String(Math.min(4, availableParallelism()));
  node([
    ...[join(LAUNCH, "engine/capture.mjs"), scene, "--query", query, "--workers", workers],
    ...["--w", String(W), "--h", String(H), "--out", join(WORK, "frames")],
  ]);
  node([join(LAUNCH, "engine/audio.mjs"), scene, join(WORK, "audio.wav"), "--query", query]);
  node([join(LAUNCH, "engine/encode.mjs"), WORK, "--name", "reel.mp4", "--maxrate", "3500"]);
  const mp4 = join(WORK, "reel.mp4");
  return {
    mp4,
    ...gateReel(mp4, () =>
      node([join(LAUNCH, "engine/probe.mjs"), "flat", join(WORK, "audio-norm.wav")]),
    ),
  };
}

/**
 * W7 E2: a requested reel, rendered on the laptop from a scene of its own (the studio folder's `scene/`: scene.html,
 * scene.mjs, cues.mjs, ruling H108) and its photographs (`shots/`). Both are copied under WORK so the engine serves
 * them from ROOT; nothing is uploaded and no callback is posted. Answers the file, its poster and the gate's report.
 * @param {{ sceneDir: string, shotsDir: string, spec: { shots: { file: string }[] } }} input
 */
export async function renderRequested({ sceneDir, shotsDir, spec }) {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  cpSync(sceneDir, join(WORK, "scene"), { recursive: true });
  cpSync(shotsDir, join(WORK, "shots"), { recursive: true });
  const shots = spec.shots.map((shot) => ({ ...shot, src: `${SERVED}/shots/${shot.file}` }));
  const filmed = film({
    scene: join(WORK, "scene/scene.html"),
    cues: join(WORK, "scene/cues.mjs"),
    spec: { ...spec, shots },
  });
  rmSync(join(WORK, "frames"), { recursive: true, force: true });
  return { ...filmed, poster: await extractPoster(filmed.mp4) };
}

/**
 * @param {string} raw the job JSON
 * @param {string | undefined} out a folder that receives the files in place of the upload
 */
async function render(raw, out) {
  const input = reelInput(readJob(raw));
  const spec = { ...input.spec, shots: await stage(input.spec.shots, input.fixture) };
  const { mp4, gate, probe } = film({ scene: SCENE, cues: join(LAUNCH, "reel/cues.mjs"), spec });

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
