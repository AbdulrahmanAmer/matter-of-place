import { z } from "zod";
import { formatNumber } from "../../lib/format";

/** The reel's own measurements, written by `render-reel` into `assets.meta` (B12 step 6). */
const reelMetaSchema = z.object({
  duration_s: z.number(),
  fps: z.number(),
  gate: z.object({
    coverage: z.number(),
    longest_static_s: z.number(),
    cuts: z.number(),
    avg_shot_s: z.number(),
    lufs: z.number(),
    true_peak: z.number(),
    flatness: z.number(),
  }),
});

/** The part of the asset DTO the player reads: `files[].url` is computed on the server (B9 `listAssets`, `getAsset`). */
type ReelAsset = {
  files: { role: string; url: string }[];
  meta: unknown;
};

const gateRows = (gate: z.infer<typeof reelMetaSchema>["gate"]): [string, string][] => [
  ["Motion coverage", `${formatNumber(gate.coverage)} %`],
  ["Longest static run", `${formatNumber(gate.longest_static_s)} s`],
  ["Cuts", formatNumber(gate.cuts)],
  ["Average shot", `${formatNumber(gate.avg_shot_s)} s`],
  ["Loudness", `${formatNumber(gate.lufs)} LUFS`],
  ["True peak", `${formatNumber(gate.true_peak)} dBTP`],
  ["Flatness", formatNumber(gate.flatness)],
];

/** The reel on screen 10: poster first, the film loads only when played, the gate numbers below. */
export function ReelPlayer({ asset }: { asset: ReelAsset }) {
  const video = asset.files.find((file) => file.role === "video");
  const poster = asset.files.find((file) => file.role === "poster");
  const meta = reelMetaSchema.safeParse(asset.meta);

  return (
    <figure>
      {video ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- the reel has no speech, so it has no captions track (G30)
        <video
          src={video.url}
          {...(poster ? { poster: poster.url } : {})}
          controls
          playsInline
          preload="none"
        />
      ) : (
        <p>No film rendered yet.</p>
      )}
      {meta.success && (
        <details>
          <summary>
            Gate numbers, {formatNumber(meta.data.duration_s)} s at {formatNumber(meta.data.fps)}{" "}
            frames per second
          </summary>
          <dl>
            {gateRows(meta.data.gate).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </figure>
  );
}
