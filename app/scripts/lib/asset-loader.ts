// Preloaded by `bun --preload` (the `seed` script): `src/data/*` imports its photographs the way Vite does, and this
// turns each such import into the absolute file path, so the seed can read the file outside Vite.
import { plugin } from "bun";

plugin({
  name: "asset-loader",
  setup(build) {
    build.onLoad({ filter: /\.(jpe?g|png|webp)$/ }, ({ path }) => ({
      exports: { default: path },
      loader: "object",
    }));
  },
});
