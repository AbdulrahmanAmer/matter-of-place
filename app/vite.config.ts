import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Plain Vite config. It replaces the vendor preset the template shipped with; everything that
// preset did silently is written out here so nothing is lost by accident:
//   - VITE_* values from .env files are defined for every bundle (client and server)
//   - Lightning CSS as the CSS transformer (Vite 8 defaults to PostCSS; Vite ships lightningcss)
//   - the `@` alias, React and Query dedupe, dev pre-bundling of React
//   - TanStack Start with import protection: the browser bundle may never import `**/server/**`
//   - nitro with the Cloudflare module preset and a fixed worker name, build only (dev uses
//     Start's own server)
//   - dev server on port 8080, all interfaces
// Dropped on purpose: TanStack devtools injection, the vendor's editor telemetry plugins, its
// sandbox assets proxy and the 1 s file-watch debounce; none of them serve a plain project.
export default defineConfig(({ command, mode }) => {
  // The dev server is a local Worker without secrets: `src/server/lib/env.ts` needs only this much of it.
  if (command === "serve") {
    process.env["MOP_ENV"] ??= "local";
    process.env["RATE_LIMIT_SALT"] ??= "local-dev-salt";
  }
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const define = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );

  return {
    define,
    css: { transformer: "lightningcss" },
    // The client manifest lists module paths only; scripts/bundle-check.mjs reads it (FE-03).
    build: { manifest: true },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      ignoreOutdatedRequests: true,
    },
    server: { host: "::", port: 8080 },
    plugins: [
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
      }),
      ...(command === "build"
        ? [
            nitro({
              preset: "cloudflare-module",
              cloudflare: { wrangler: { name: "matter-of-place" } },
            }),
          ]
        : []),
      viteReact(),
    ],
  };
});
