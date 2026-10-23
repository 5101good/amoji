import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  lstat,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve, relative, join, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ZipFile } from "yazl";
import { API_VERSION, DATABASE_VERSION } from "../dist/src/shared-contract.js";
import { CLAUDE_MODS_CAPABILITIES } from "../dist/src/claude-mods/capabilities.js";

const root = resolve(import.meta.dirname, "..");
const SEED_PACKS = ["classic.amoji", "office.amoji", "LICENSE"];
export async function buildClaudeMods(
  destination = resolve(root, ".cache/claude-mods"),
) {
  destination = resolve(destination);
  const plugin = join(destination, "plugin");
  // Refuse to replace an existing unowned directory, including symlink targets.
  const marker = join(destination, ".amoji-mods-build");
  await mkdir(destination, { recursive: true });
  const metadata = await lstat(destination);
  if (metadata.isSymbolicLink() || !metadata.isDirectory())
    throw new Error("Unsafe build destination");
  const existing = await readdir(destination);
  if (existing.length && !existing.includes(".amoji-mods-build"))
    throw new Error("Build destination is not owned by Amoji");
  if (
    existing.includes(".amoji-mods-build") &&
    (await readFile(marker, "utf8")) !== "amoji-claude-mods-build-v1\n"
  )
    throw new Error("Invalid build ownership marker");
  await writeFile(marker, "amoji-claude-mods-build-v1\n");
  await rm(plugin, { recursive: true, force: true });
  await mkdir(plugin, { recursive: true });
  const project = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  for (const name of [
    ".claude-plugin/plugin.json",
    "hooks/hooks.json",
    "hooks/register.js",
    "hooks/picture-input.js",
    "hooks/control-input.js",
    "README.md",
    "README.en.md",
  ]) {
    await mkdir(resolve(plugin, name, ".."), { recursive: true });
    await cp(join(root, "plugins/amoji-claude-mods", name), join(plugin, name));
  }
  const manifest = JSON.parse(
    await readFile(join(plugin, ".claude-plugin/plugin.json"), "utf8"),
  );
  if (manifest.version !== project.version)
    throw new Error("Claude plugin version must match root version");
  for (const name of ["LICENSE", "NOTICE"])
    await cp(join(root, name), join(plugin, name));
  await cp(join(root, "dist/src"), join(plugin, "runtime/src"), {
    recursive: true,
    filter: (path) =>
      !relative(join(root, "dist/src"), path).split(sep).includes("dsh") &&
      !path.endsWith(".map"),
  });
  await cp(join(root, "dist/docs"), join(plugin, "runtime/docs"), {
    recursive: true,
  });
  await mkdir(join(plugin, "assets/official-packs"), { recursive: true });
  for (const name of SEED_PACKS)
    await cp(join(root, "assets/official-packs", name), join(plugin, "assets/official-packs", name));
  // Ship display pixels for the built-in packs: a first gallery should read
  // files, not encode every image in the user's local bridge.
  const { withValidatedPack } = await import("../dist/src/packs.js");
  const { cachedThumbnailImage } = await import("../dist/src/claude-mods/thumbnail.js");
  const previewDirectory = join(plugin, "assets/claude-previews");
  const seen = new Set();
  for (const name of SEED_PACKS.filter(name => name.endsWith(".amoji"))) await withValidatedPack(await readFile(join(plugin, "assets/official-packs", name)), async (pack) => {
    for (const expression of pack.manifest.expressions) {
      const blob = expression.visual.poster ?? expression.visual.primary;
      if (seen.has(blob.sha256)) continue;
      seen.add(blob.sha256);
      for (const profile of ["gallery", "detail"])
        await cachedThumbnailImage(blob.sha256, () => pack.readBlob(blob), previewDirectory, profile);
    }
  });
  const runtimePackage = {
    name: project.name,
    version: project.version,
    private: true,
    type: "module",
    engines: project.engines,
    dependencies: project.dependencies,
    license: "MIT",
  };
  const lock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  );
  delete lock.packages[""].devDependencies;
  delete lock.packages[""].scripts;
  await writeFile(
    join(plugin, "runtime/package.json"),
    JSON.stringify(runtimePackage, null, 2) + "\n",
  );
  await writeFile(
    join(plugin, "runtime/package-lock.json"),
    JSON.stringify(lock, null, 2) + "\n",
  );
  const build = {
    plugin: "amoji",
    version: project.version,
    platform: "portable",
    node: project.engines.node,
    minimumClaudeCode: "2.1.295",
    runtimeDependenciesEmbedded: false,
    repository: "https://github.com/5101good/amoji",
    dependencies: Object.entries(project.dependencies).map(
      ([name, version]) => ({ name, version }),
    ),
    dependencyLockSha256: createHash("sha256")
      .update(await readFile(join(plugin, "runtime/package-lock.json")))
      .digest("hex"),
    serviceApi: API_VERSION,
    databaseVersion: DATABASE_VERSION,
    requiredCapabilities: CLAUDE_MODS_CAPABILITIES,
  };
  await writeFile(
    join(plugin, "BUILD.json"),
    JSON.stringify(build, null, 2) + "\n",
  );
  await mkdir(join(destination, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(destination, ".claude-plugin/marketplace.json"),
    JSON.stringify(
      {
        name: "amoji-desktop",
        owner: { name: "Amoji contributors" },
        plugins: [
          {
            name: "amoji",
            source: "./plugin",
            description: manifest.description,
            version: manifest.version,
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  const archive = join(destination, `amoji-claude-mods-${project.version}.zip`);
  const zip = new ZipFile();
  async function append(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await append(file);
      else if (entry.isFile())
        zip.addFile(file, relative(destination, file).split("\\").join("/"), {
          mtime: new Date("2000-01-01T00:00:00Z"),
          mode: 0o100644,
        });
      else throw new Error("Unexpected non-file in portable package");
    }
  }
  await append(join(destination, ".claude-plugin"));
  await append(plugin);
  const stream = pipeline(zip.outputStream, createWriteStream(archive));
  zip.end();
  await stream;
  const sha = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  await writeFile(
    join(destination, "SHA256SUMS"),
    `${sha}  ${relative(destination, archive)}\n`,
  );
  return { plugin, archive };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await buildClaudeMods(process.argv[2]);
  console.log(`Built portable Claude Mods package: ${result.archive}`);
}
