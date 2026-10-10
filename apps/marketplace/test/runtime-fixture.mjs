import { convertV4MiniflareOptions as convert } from "miniflare";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../dist/", import.meta.url));
export function convertV4MiniflareOptions(options) {
  return convert({
    ...options,
    workers: options.workers.map((worker) => {
      if (!worker.script?.includes("./decoder.wasm")) return worker;
      const { script, modules, ...rest } = worker;
      return {
        ...rest,
        modulesRoot: root,
        modules: [
          { type: "ESModule", path: root + "worker.js", contents: script },
          {
            type: "CompiledWasm",
            path: root + "decoder.wasm",
            contents: readFileSync(root + "decoder.wasm"),
          },
        ],
        durableObjects: {
          FREE_RUNTIME: { className: "FreeRuntime", useSQLite: true },
        },
        bindings: {
          ...rest.bindings,
          UPLOAD_ENABLED: "true",
          R2_ACCOUNT_ID: "a".repeat(32),
          R2_BUCKET: "local-test",
          R2_ACCESS_KEY_ID: "synthetic-access",
          R2_SECRET_ACCESS_KEY: "synthetic-only",
        },
      };
    }),
  });
}
export async function migrateUploads(db) {
  const sql = readFileSync(
    new URL("../migrations/0003-direct-uploads.sql", import.meta.url),
    "utf8",
  );
  for (const statement of sql.split(/;\n(?=CREATE|--)/).filter((s) => s.trim()))
    await db.prepare(statement).run();
  await db
    .prepare(
      readFileSync(
        new URL("../migrations/0004-upload-row-version.sql", import.meta.url),
        "utf8",
      ),
    )
    .run();
}
