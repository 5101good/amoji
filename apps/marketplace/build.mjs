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
const legacy = JSON.parse(
  await readFile("../../docs/specs/amoji-v0.1.schema.json", "utf8"),
);
const scenario = JSON.parse(
  await readFile("../../docs/specs/amoji-v0.2.schema.json", "utf8"),
);
ajv.addSchema({ $id: "legacy", $defs: legacy.$defs, $ref: "#/$defs/pack" });
ajv.addSchema({ ...scenario, $id: "scenario" });
const schemas = standalone(ajv, {
  validate01: "legacy",
  validate02: "scenario",
});
// Use the same trusted template for edge rendering and static detail pages.
// Embedding it removes an asset-service round trip from a cold homepage load.
const { code: css } = await transform(await readFile('web/style.css', 'utf8'), { loader: 'css', minify: true });
const styleHash = createHash('sha256').update(css).digest('base64');
const homepageTemplate = (await readFile('web/index.html', 'utf8')).replace('<link rel="stylesheet" href="/style.css" />', () => `<style data-amoji-base>${css}</style>`);
if (Buffer.byteLength(homepageTemplate) > 64 * 1024) throw Error('HOMEPAGE_TEMPLATE_TOO_LARGE');
const schemaPlugins = [
  {
    name: "static-schema",
    setup(b) {
      b.onResolve({ filter: /^amoji-homepage$/ }, () => ({ path: 'homepage', namespace: 'homepage' }));
      b.onLoad({ filter: /.*/, namespace: 'homepage' }, () => ({ contents: `export default ${JSON.stringify(homepageTemplate)};` }));
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
await Promise.all(
  ["style.css"].map((f) =>
    copyFile(`web/${f}`, `dist/public/${f}`),
  ),
);
// Ship the small shared stylesheet with the document, removing a blocking
// network round trip before the server-rendered catalog can become visible.
await writeFile('dist/public/index.html', homepageTemplate);
await writeFile('dist/public/_headers', (await readFile('web/_headers', 'utf8')).replace("style-src 'self'", `style-src 'self' 'sha256-${styleHash}'`));
