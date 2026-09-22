import { build } from "esbuild";
await build({
  entryPoints: ["test/transaction-probe.ts"],
  bundle: true,
  format: "esm",
  outfile: "dist/transaction-probe.js",
});
