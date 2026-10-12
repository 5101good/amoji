import assert from "node:assert/strict";
import { readFile, writeFile, copyFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import yauzl from "yauzl";
import { fileURLToPath } from "node:url";
import { validatePublicFile } from "./release-artifacts.mjs";
const root = resolve(import.meta.dirname, "..");
const project = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const name = `amoji-claude-mods-${project.version}.zip`;
const source = resolve(root, ".cache/claude-mods", name);
export async function inspectClaudeArchive(source) {
  const archive = await new Promise((ok, no) =>
    yauzl.open(source, { lazyEntries: true, autoClose: true }, (error, zip) =>
      error ? no(error) : ok(zip),
    ),
  );
  const files = new Map();
  let total = 0;
  try {
    for await (const entry of archive.eachEntry()) {
      const path = entry.fileName;
      assert.ok(
        /^(?:plugin\/|\.claude-plugin\/marketplace\.json$)/.test(path),
        `Unexpected path: ${path}`,
      );
      assert.ok(
        !path.includes("\\") && !path.split("/").includes(".."),
        `Unsafe path: ${path}`,
      );
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      assert.ok(mode === 0 || mode === 0o100000, `Non-file entry: ${path}`);
      total += entry.uncompressedSize;
      assert.ok(
        entry.uncompressedSize <= 32 * 1024 * 1024 &&
          total <= 100 * 1024 * 1024 &&
          files.size < 2000,
        "Archive budget exceeded",
      );
      assert.ok(!files.has(path), `Duplicate entry: ${path}`);
      const stream = await new Promise((ok, no) =>
        archive.openReadStream(entry, (error, stream) =>
          error ? no(error) : ok(stream),
        ),
      );
      const chunks = [];
      for await (const bytes of stream) chunks.push(bytes);
      const bytes = Buffer.concat(chunks);
      const publicPath =
        path === ".claude-plugin/marketplace.json"
          ? "marketplace.json"
          : path === "plugin/.claude-plugin/plugin.json"
            ? "plugin-manifest.json"
            : path;
      validatePublicFile(publicPath, bytes);
      files.set(path, bytes);
    }
  } finally {
    archive.close();
  }
  for (const path of [
    ".claude-plugin/marketplace.json",
    "plugin/.claude-plugin/plugin.json",
    "plugin/hooks/register.js",
    "plugin/hooks/picture-input.js",
    "plugin/hooks/control-input.js",
    "plugin/runtime/src/claude-mods/main.js",
    "plugin/runtime/package-lock.json",
    "plugin/assets/base-library/base.amoji",
    "plugin/LICENSE",
    "plugin/NOTICE",
    "plugin/README.md",
    "plugin/README.en.md",
  ])
    assert.ok(files.has(path), `Missing ${path}`);
  const manifest = JSON.parse(files.get("plugin/.claude-plugin/plugin.json"));
  const build = JSON.parse(files.get("plugin/BUILD.json"));
  const runtime = JSON.parse(files.get("plugin/runtime/package.json"));
  assert.equal(manifest.version, runtime.version);
  assert.equal(build.version, manifest.version);
  assert.equal(build.runtimeDependenciesEmbedded, false);
  assert.equal(
    build.dependencyLockSha256,
    createHash("sha256")
      .update(files.get("plugin/runtime/package-lock.json"))
      .digest("hex"),
  );
  return files;
}

export async function appendClaudeRelease() {
  const files = await inspectClaudeArchive(source);
  const destination = resolve(root, ".cache/release");
  await copyFile(source, resolve(destination, name));
  const provenancePath = resolve(destination, "BUILD_PROVENANCE.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  provenance.claudeMods = {
    filename: name,
    sha256: createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
    runtimeDependenciesEmbedded: false,
    minimumClaudeCode: "2.1.295",
  };
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
  const notesPath = resolve(destination, "RELEASE_NOTES.md");
  await writeFile(
    notesPath,
    (await readFile(notesPath, "utf8")) +
      "\n\n## Claude Desktop Mods\n\n附加包 / Additional package: `" +
      name +
      "`. See the included Chinese/English README for installation and supported local Code sessions. Node.js 24+ is required; install the locked runtime dependencies before adding the local marketplace.\n",
  );
  const names = (await readdir(destination))
    .filter((n) => n !== "SHA256SUMS")
    .sort();
  await writeFile(
    resolve(destination, "SHA256SUMS"),
    (
      await Promise.all(
        names.map(
          async (name) =>
            `${createHash("sha256")
              .update(await readFile(resolve(destination, name)))
              .digest("hex")}  ${name}`,
        ),
      )
    ).join("\n") + "\n",
  );
  console.log(
    `Verified ${files.size} Claude Mods package entries and extended release checksums.`,
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await appendClaudeRelease();
