import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  readdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { inspectClaudeArchive } from "./append-claude-release.mjs";
import { buildClaudeMods } from "./build-claude-mods.mjs";
const root = resolve(import.meta.dirname, "..");

test("可安装包包含生成 hooks、锁定运行时、许可和共享素材，不内嵌依赖或个人配置", async (t) => {
  const out = await mkdtemp(join(tmpdir(), "amoji-mods-package-"));
  const data = join(out, "test-data");
  t.after(async () => {
    // Own shutdown explicitly, including when an assertion fails. Do not race
    // a short idle timer or remove files while this private service is writing.
    const { stopSharedService } = await import("../dist/src/shared-client.js");
    try {
      const identity = JSON.parse(await readFile(join(data, "service.json"), "utf8"));
      await stopSharedService(data, identity.serviceId);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await rm(out, { recursive: true, force: true });
  });
  const result = await buildClaudeMods(out);
  const contents = await inspectClaudeArchive(result.archive);
  const extracted = join(out, "extracted");
  for (const [path, bytes] of contents) {
    const file = join(extracted, path);
    await mkdir(resolve(file, ".."), { recursive: true });
    await writeFile(file, bytes);
  }
  const plugin = join(extracted, "plugin");
  const manifest = JSON.parse(
    await readFile(join(plugin, ".claude-plugin/plugin.json"), "utf8"),
  );
  const marketplace = JSON.parse(
    await readFile(join(extracted, ".claude-plugin/marketplace.json"), "utf8"),
  );
  assert.equal(manifest.name, "amoji");
  assert.equal(marketplace.plugins[0].source, "./plugin");
  for (const path of [
    "hooks/register.js",
    "hooks/picture-input.js",
    "hooks/control-input.js",
    "runtime/src/claude-mods/main.js",
    "runtime/src/service-main.js",
    "runtime/src/marketplace-publisher.js",
    "runtime/src/claude-mods/market.js",
    "runtime/src/claude-mods/guidance.js",
    "runtime/docs/specs/amoji-0.1.schema.json",
    "runtime/docs/specs/amoji-0.1.registry.json",
    "assets/official-packs/classic.amoji",
    "assets/official-packs/office.amoji",
    "LICENSE",
    "NOTICE",
    "README.md",
    "README.en.md",
  ])
    assert.ok((await stat(join(plugin, path))).isFile(), path);
  for (const path of [
    "runtime/node_modules/typescript",
    "runtime/node_modules/react",
    "runtime/node_modules/tsx",
    ".claude",
    "tests",
  ])
    await assert.rejects(stat(join(plugin, path)), { code: "ENOENT" });
  const build = JSON.parse(await readFile(join(plugin, "BUILD.json"), "utf8"));
  assert.equal(build.platform, "portable");
  assert.equal(build.runtimeDependenciesEmbedded, false);
  assert.ok(build.dependencies.length > 0);
  const runtime = join(plugin, "runtime");
  const contract = await import(pathToFileURL(join(runtime, "src/shared-contract.js")));
  assert.equal(build.serviceApi, contract.API_VERSION, "BUILD must describe the packaged service API");
  assert.equal(build.databaseVersion, contract.DATABASE_VERSION, "BUILD must describe the packaged database version");
  execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: runtime, stdio: "pipe" },
  );
  const response = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(plugin, "runtime/src/claude-mods/main.js")],
      {
        env: {
          ...process.env,
          AMOJI_DATA_DIR: data,
          AMOJI_SERVICE_IDLE_MS: "60000",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)),
    );
    child.stdin.end(
      JSON.stringify({
        command: "browse",
        context: {
          host: "claude-code",
          hostInstanceId: "mods",
          sessionId: "artifact",
        },
        args: { query: "", page: 0 },
      }),
    );
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.result.total, 40, "both built-in packs are browsable (the 40 expressions a person can send)");
  assert.ok(response.result.items[0].preview.startsWith("data:image/avif;base64,"));
  const previews = join(plugin, "assets/claude-previews");
  assert.ok((await readdir(previews)).filter(name => name.endsWith(".avif")).length >= response.result.total);
  for (const item of response.result.items) {
    const visual = item.expression.visual;
    const digest = (visual.poster ?? visual.primary).sha256;
    const pixels = await readFile(join(previews, `152-avif-v1-${digest}.avif`));
    assert.equal(item.preview, `data:image/avif;base64,${pixels.toString("base64")}`);
  }
  await assert.rejects(stat(join(data, "cache/claude-mods-previews")), { code: "ENOENT" });
  assert.ok(result.archive.endsWith(".zip"));
});

test("构建拒绝覆盖非本构建目录中的文件", async (t) => {
  const out = await mkdtemp(join(tmpdir(), "amoji-mods-protected-"));
  t.after(() => rm(out, { recursive: true, force: true }));
  await writeFile(join(out, "keep.txt"), "user content");
  await assert.rejects(buildClaudeMods(out), /not owned/);
  assert.equal(await readFile(join(out, "keep.txt"), "utf8"), "user content");
});

test("发布 ZIP 拒绝私有配置、凭据及符号链接", async (t) => {
  const { ZipFile } = await import("yazl");
  const out = await mkdtemp(join(tmpdir(), "amoji-archive-reject-"));
  t.after(() => rm(out, { recursive: true, force: true }));
  const cases = [
    ["plugin/.env", "private", 0o100644],
    ["plugin/hooks/register.js", "ghp_" + "x".repeat(36), 0o100644],
    ["plugin/link", "../../outside", 0o120777],
  ];
  for (let i = 0; i < cases.length; i++) {
    const [path, text, mode] = cases[i];
    const zip = new ZipFile();
    const chunks = [];
    const ended = new Promise((ok, no) => {
      zip.outputStream.on("data", (b) => chunks.push(b));
      zip.outputStream.on("error", no);
      zip.outputStream.on("end", ok);
    });
    zip.addBuffer(Buffer.from(text), path, { mode });
    zip.end();
    await ended;
    const archive = join(out, i + ".zip");
    await writeFile(archive, Buffer.concat(chunks));
    await assert.rejects(
      inspectClaudeArchive(archive),
      /Private|Credential|Non-file/,
    );
  }
});
