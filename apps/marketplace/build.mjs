import sharp from "sharp";
import { unzipSync } from "fflate";
import { build, transform } from "esbuild";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Ajv2020 } = require("ajv/dist/2020.js");
const standalone = require("ajv/dist/standalone/index.js").default;
const addFormats = require("ajv-formats").default;
const ajv = new Ajv2020({ strict: false, code: { source: true, esm: true } });
addFormats(ajv);
// Amoji 0.1 (docs/specs/amoji-0.1.schema.json) is the only pack protocol.
const protocol = JSON.parse(
  await readFile("../../docs/specs/amoji-0.1.schema.json", "utf8"),
);
ajv.addSchema(protocol);
const schemas = standalone(ajv, {
  validatePackSchema: `${protocol.$id}#/$defs/pack`,
});
// Use the same trusted template for edge rendering and static detail pages.
// Embedding it removes an asset-service round trip from a cold homepage load.
const { code: css } = await transform(await readFile("web/style.css", "utf8"), {
  loader: "css",
  minify: true,
});
const styleHash = createHash("sha256").update(css).digest("base64");
const homepageTemplate = (await readFile("web/index.html", "utf8")).replace(
  '<link rel="stylesheet" href="/style.css" />',
  () => `<style data-amoji-base>${css}</style>`,
);
if (Buffer.byteLength(homepageTemplate) > 64 * 1024)
  throw Error("HOMEPAGE_TEMPLATE_TOO_LARGE");
const schemaPlugins = [
  {
    name: "static-schema",
    setup(b) {
      b.onResolve({ filter: /^amoji-homepage$/ }, () => ({
        path: "homepage",
        namespace: "homepage",
      }));
      b.onLoad({ filter: /.*/, namespace: "homepage" }, () => ({
        contents: `export default ${JSON.stringify(homepageTemplate)};`,
      }));
      b.onResolve({ filter: /^amoji-schema$/ }, () => ({
        path: "schema",
        namespace: "schema",
      }));
      b.onLoad({ filter: /.*/, namespace: "schema" }, () => ({
        contents: schemas,
        resolveDir: process.cwd(),
      }));
    },
  },
];
await copyFile("src/decoder.wasm", "dist/decoder.wasm").catch(async () => {
  await mkdir("dist", { recursive: true });
  await copyFile("src/decoder.wasm", "dist/decoder.wasm");
});
await mkdir("dist/public", { recursive: true });
await build({
  entryPoints: ["src/worker.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  define: { "process.env.NODE_ENV": '"production"' },
  conditions: ["workerd", "worker", "browser"],
  external: ["node:*", "cloudflare:*", "./decoder.wasm"],
  plugins: schemaPlugins,
  outfile: "dist/worker.js",
});
if (process.argv.includes("--worker-only")) process.exit();
await build({
  entryPoints: ["web/app.tsx"],
  plugins: schemaPlugins,
  bundle: true,
  format: "esm",
  minify: true,
  splitting: true,
  outdir: "dist/public",
  chunkNames: "chunks/[name]-[hash]",
});
await copyFile("web/style.css", "dist/public/style.css");

// Reuse the project's licensed expressions, optimized for this web surface.
const art = unzipSync(
  new Uint8Array(await readFile("../../assets/official-packs/classic.amoji")),
);
const manifest = JSON.parse(new TextDecoder().decode(art["manifest.json"]));
await mkdir("dist/public/art", { recursive: true });
for (const [file, name] of [
  ["progress", "进度如何"],
  ["thanks", "谢谢"],
  ["celebrate", "一起庆祝"],
]) {
  const expression = manifest.expressions.find((e) => e.name["zh-CN"] === name);
  const bytes = art["blobs/" + expression.visual.primary.sha256];
  await sharp(bytes)
    .resize(440, 440, { fit: "inside" })
    .webp({ quality: 82 })
    .toFile(`dist/public/art/${file}.webp`);
}
await sharp("../../assets/brand/amoji-logo.png")
  .trim({ threshold: 40 })
  .resize({ width: 400 })
  .webp({ quality: 85 })
  .toFile("dist/public/art/brand.webp");

await copyFile(
  "web/art/expression-future.webp",
  "dist/public/art/expression-future.webp",
);

// Ship the shared stylesheet with the document, removing a blocking
// network round trip before the server-rendered catalog can become visible.
await writeFile("dist/public/index.html", homepageTemplate);
await writeFile(
  "dist/public/_headers",
  (await readFile("web/_headers", "utf8")).replace(
    "style-src 'self'",
    `style-src 'self' 'sha256-${styleHash}'`,
  ),
);
