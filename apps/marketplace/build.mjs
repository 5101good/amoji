import { build } from "esbuild";
import { mkdir, copyFile, readFile } from "node:fs/promises";
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
const schemaPlugins = [
  {
    name: "static-schema",
    setup(b) {
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
  outfile: "dist/public/app.js",
});
await Promise.all(
  ["index.html", "style.css", "_headers"].map((f) =>
    copyFile(`web/${f}`, `dist/public/${f}`),
  ),
);
