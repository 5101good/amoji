import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist/public", { recursive: true });
await build({
  entryPoints: ["src/worker.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  conditions: ["workerd", "worker", "browser"],
  external: ["node:*", "cloudflare:*"],
  outfile: "dist/worker.js",
});
if (process.argv.includes("--worker-only")) process.exit();
await build({
  entryPoints: ["web/app.tsx"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "dist/public/app.js",
});
await Promise.all(
  ["index.html", "style.css", "_headers"].map((f) =>
    copyFile(`web/${f}`, `dist/public/${f}`),
  ),
);
