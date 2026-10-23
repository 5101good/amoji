import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSharedService } from "../src/shared-service.js";
import { SharedClient } from "../src/shared-client.js";
import { ConnectedRuntime } from "../src/adapter-runtime.js";
import { ExpressionApplication } from "../src/application/expressions.js";
import { SESSION_BINDINGS_CAPABILITY } from "../src/shared-contract.js";
import {
  humanText,
  messageMarker,
  renderSegments,
} from "../src/claude-mods/messages.js";
import { thumbnailImage, cachedThumbnailImage } from "../src/claude-mods/thumbnail.js";
import { readBoundedFile, writeNewFile } from "../src/claude-mods/files.js";
import { executeBridge } from "../src/claude-mods/bridge.js";
import { HUMAN_EXPRESSION_NOTICE } from "../src/projection.js";
import { actAllows, actEntry } from "../src/protocol/index.js";
import { SEEDS } from "./helpers/store-runtime.js";
import { fields as draftFixture } from "./helpers/fixtures.js";

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "amoji-mods-"));
  const service = await startSharedService(directory, SEEDS);
  const client = await SharedClient.connect({ directory });
  t.after(async () => {
    await client.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const app = new ExpressionApplication(new ConnectedRuntime(client), client);
  /** AI send by selection token through the application use case. */
  const aiSend = async (turn: Parameters<typeof app.express>[0], token: string) => {
    const result = await app.express(turn, { selection_token: token });
    assert.ok(result.status === "sent", JSON.stringify(result));
    return result.message;
  };
  const context = {
    host: "claude-code" as const,
    hostInstanceId: "mods",
    sessionId: "session-a",
  };
  return { directory, client, app, context, aiSend };
}

test("宿主空闲时人工表情按请求幂等，AI 仍需真实回合；当前会话隔离", async (t) => {
  const { client, app, context, aiSend } = await setup(t);
  assert.ok(
    client.identity.capabilities?.includes(SESSION_BINDINGS_CAPABILITY),
  );
  const page = await app.browse({ query: "", page: 0 });
  const ref = page.items[0]!.expression;
  const a = await app.receive(context, ref, "human-1");
  assert.equal(
    (await app.receive(context, ref, "human-1")).message_id,
    a.message_id,
  );
  assert.equal((await app.history(context)).length, 1);
  assert.deepEqual(
    await app.history({ ...context, sessionId: "session-b" }),
    [],
  );
  await assert.rejects(app.search(context, "加油"), /TURN_REQUIRED/);
  const turn = { ...context, turnId: "real-turn", turnOrdinal: 1 };
  const search = await app.search(turn, "加油");
  assert.ok(search.candidates.length);
  const foreign = await app.express({ ...turn, sessionId: "session-b" }, { selection_token: search.candidates[0]!.selection_token });
  assert.equal(foreign.status === "rejected" && foreign.reason, "invalid_selection_token");
  const ai = await aiSend(turn, search.candidates[0]!.selection_token);
  assert.equal((await aiSend(turn, search.candidates[0]!.selection_token)).message_id, ai.message_id);
  assert.doesNotMatch(JSON.stringify(search), /visual|base64|sha256|image\//);
  const { version, ...prefs } = await client.getSettings();
  await client.updateSettings(version, { ...prefs, ai_expressions: { ...prefs.ai_expressions, enabled: false } });
  const paused = await app.express({ ...turn, turnId: "next", turnOrdinal: 2 }, { act: "core:celebrate" });
  assert.equal(paused.status === "rejected" && paused.reason, "ai_expressions_paused");
});

test("发送时预备的展示与冻结消息完全一致，模型文字不含媒体", async (t) => {
  const { app, client, context } = await setup(t);
  const x = (await app.browse({ query: "", page: 0 })).items[0]!.expression;
  const prepared = await executeBridge(app, client, {
    context, command: "receive",
    args: { ref: { asset_id: x.asset_id, revision_id: x.revision_id }, requestId: "ready-to-draw" },
  }) as { text: string; messageId: string; segments: unknown[] };
  const rendered = await executeBridge(app, client, {
    context, command: "render", args: { direction: "human_to_ai", text: prepared.text },
  });
  assert.deepEqual(prepared.segments, rendered);
  assert.doesNotMatch(prepared.text, /base64|sha256|visual|image\//);
  assert.equal((await app.history(context)).length, 1);
});

test("并发重绘合并读请求，失败可重试且会话缓存有界", async () => {
  const { messageSegments, rememberMessage } = await import(
    new URL("../src/claude-mods/native/message-view.js", import.meta.url).href
  );
  const s: Record<string, any> = {};
  let reads = 0;
  let release!: (value: unknown) => void;
  const gate = new Promise(resolve => { release = resolve; });
  const read = () => { reads++; return gate; };
  const first = messageSegments(s, "human:x", read);
  const second = messageSegments(s, "human:x", read);
  assert.equal(reads, 1);
  const expected = [{ kind: "expression", name: "固定语义" }];
  release(expected);
  assert.deepEqual(await first, expected);
  assert.deepEqual(await second, expected);
  assert.equal(s.messageReads.size, 0);
  let attempts = 0;
  const retry = () => { attempts++; return attempts === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(expected); };
  await assert.rejects(messageSegments(s, "ai:y", retry), /offline/);
  assert.deepEqual(await messageSegments(s, "ai:y", retry), expected);
  assert.equal(attempts, 2);
  for (let i = 0; i < 140; i++) rememberMessage(s, "human:" + i, expected);
  assert.equal(s.messageCache.size, 128);
});

test("只重绘同会话同方向的完整标记，保留普通文字、未知标记和历史固定语义", async (t) => {
  const { app, client, context, aiSend } = await setup(t);
  const ref = (await app.browse({ query: "", page: 0 })).items[0]!.expression;
  const human = await app.receive(context, ref, "human");
  const wire = humanText(human);
  assert.doesNotMatch(wire, /base64|sha256|visual|image\//);
  assert.equal(
    (await renderSegments(app, context, "human_to_ai", wire))[0]!.kind,
    "expression",
  );
  assert.equal(
    (
      await renderSegments(
        app,
        { ...context, sessionId: "other" },
        "human_to_ai",
        wire,
      )
    )[0]!.kind,
    "text",
  );
  assert.equal(
    (
      await renderSegments(app, context, "ai_to_human", messageMarker(human))
    )[0]!.kind,
    "text",
  );
  assert.equal(
    (
      await renderSegments(
        app,
        context,
        "human_to_ai",
        wire.replace(HUMAN_EXPRESSION_NOTICE, "篡改"),
      )
    )[0]!.kind,
    "text",
  );
  const turn = { ...context, turnId: "turn", turnOrdinal: 1 };
  const token = (await app.search(turn, "加油")).candidates[0]!.selection_token;
  const ai = await aiSend(turn, token);
  const rendered = await renderSegments(
    app,
    context,
    "ai_to_human",
    `前文\n${messageMarker(ai)}\n后文`,
  );
  assert.deepEqual(
    rendered.map((s) => s.kind),
    ["text", "expression", "text"],
  );
  assert.equal(rendered[0]!.kind === "text" && rendered[0]!.text, "前文\n");
  assert.deepEqual(
    await renderSegments(
      app,
      context,
      "ai_to_human",
      "[[amoji:not-a-message]]",
    ),
    [{ kind: "text", text: "[[amoji:not-a-message]]" }],
  );
  const entry = await client.getEntry(ref.asset_id);
  await client.setArchived(ref.asset_id, entry.version, true);
  assert.equal(
    (await renderSegments(app, context, "human_to_ai", wire))[0]!.kind,
    "expression",
  );
});

test("缩略图实际解码且有预算，桥接分页不泄露库路径；越界页收敛", async (t) => {
  const { app, client, context } = await setup(t);
  const item = (await client.list())[0]!;
  const raw = await readFile(
    await client.blobPath((item.visual.poster ?? item.visual.primary).sha256),
  );
  const image = await thumbnailImage(raw);
  assert.match(image, /^data:image\/webp;base64,/);
  assert.ok(image.length <= 48000);
  assert.match(image, /data:image\/webp;base64,/);
  const encoded = image.match(/base64,([^"']+)/)![1]!;
  const dimensions = await sharp(Buffer.from(encoded, "base64")).metadata();
  assert.equal(Math.max(dimensions.width!, dimensions.height!), 192, "96 CSS px at 2x must retain 192 source pixels");
  const result: any = await executeBridge(app, client, {
    command: "browse",
    context,
    args: { query: "", page: 99 },
  });
  assert.equal(result.page, 6, "an out-of-range page converges on the last page of the 40 expressions a person can send");
  assert.equal(result.items.length, 4);
  for (const item of result.items) {
    assert.match(item.preview, /^data:image\/avif;base64,/);
    const pixels = Buffer.from(item.preview.split(",")[1], "base64");
    assert.ok(pixels.length <= 3350, "20 visible images must fit the host text budget");
    const dimensions = await sharp(pixels).metadata();
    assert.equal(Math.max(dimensions.width!, dimensions.height!), 152);
  }
  const window: any = await executeBridge(app, client, {
    command: "browse", context, args: { query: "", offset: 1, limit: 2 },
  });
  assert.equal(window.offset, 1);
  assert.equal(window.total, 40);
  assert.ok(!(await app.browseWindow({ query: "", offset: 0, limit: 100 })).items.some((x: any) => !actAllows(x.expression.realizes, "h2a")), "选择器不展示人不能发出的表情");
  const first: any = await executeBridge(app, client, { command: "browse", context, args: { query: "", offset: 0, limit: 3 } });
  assert.deepEqual(window.items.map((x: any) => x.expression.asset_id), first.items.slice(1).map((x: any) => x.expression.asset_id));
  await assert.rejects(app.browseWindow({ query: "", offset: -1, limit: 2 }), /INVALID_ARGUMENT/);
  await assert.rejects(app.browseWindow({ query: "", offset: 0, limit: 101 }), /INVALID_ARGUMENT/);
  assert.equal((await app.browseWindow({ query: "", offset: 999, limit: 10 })).items.length, 0);
  assert.ok(JSON.stringify(result).length < 85000);
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret|file:\/\/|Application Support/,
  );
  await assert.rejects(
    executeBridge(app, client, { command: "unknown", context, args: {} }),
    /INVALID_ARGUMENT/,
  );
});

test("高清预览按原图摘要持久缓存，重开桥接不重编码，坏缓存可恢复", async (t) => {
  const { client, directory } = await setup(t);
  const item = (await client.list())[0]!;
  const digest = (item.visual.poster ?? item.visual.primary).sha256;
  const cache = join(directory, "preview-cache");
  let reads = 0;
  const readSource = async () => { reads++; return readFile(await client.blobPath(digest)); };
  const first = await cachedThumbnailImage(digest, readSource, cache);
  const second = await cachedThumbnailImage(digest, readSource, cache);
  assert.equal(second, first);
  assert.equal(reads, 1, "a new helper call should reuse persisted pixels without reading the source");
  await writeFile(join(cache, `192-q88-v1-${digest}.webp`), "broken cache");
  assert.equal(await cachedThumbnailImage(digest, readSource, cache), first);
  assert.equal(reads, 2);
  const otherDigest = "a".repeat(64);
  await cachedThumbnailImage(otherDigest, readSource, cache);
  assert.equal(reads, 3, "different immutable media must not reuse another preview");
  const personal = join(directory, "personal-cache");
  assert.equal(await cachedThumbnailImage(digest, readSource, personal, "detail", cache), first);
  assert.equal(reads, 3, "bundled pixels must work before a personal cache exists");
  await writeFile(join(cache, `192-q88-v1-${digest}.webp`), "broken bundle");
  assert.equal(await cachedThumbnailImage(digest, readSource, personal, "detail", cache), first);
  assert.equal(reads, 4, "a corrupt bundle falls back to the original and personal cache");
  assert.equal(await cachedThumbnailImage(digest, readSource, personal, "detail", cache), first);
  assert.equal(reads, 4, "a corrupt bundle must not trigger encoding on every call");
});

test("偏好保存和列表读取在同一次桥接完成，刷新失败不重试已提交设置", async (t) => {
  const { app, client, context } = await setup(t);
  const { version, ...p } = await client.getSettings();
  const result: any = await executeBridge(app, client, { context, command: "updateSettings", args: {
    version, preferences: { ...p, display: "text" },
    browse: {query:"", offset:0, limit:64},
  } });
  assert.equal(result.preferences.display, "text");
  assert.ok(Array.isArray(result.collection.items));
  const failed: any = await executeBridge(app, client, { context, command: "updateSettings", args: {
    version: result.preferences.version, preferences: { ...p, display: "image" },
    browse: {query:"", offset:-1, limit:64},
  } });
  assert.equal(failed.preferences.display, "image");
  assert.equal(failed.refreshError, true);
  assert.equal((await client.getSettings()).version, failed.preferences.version);
});

test("通过管理用例创建、核对、确认、归档和包导出导入；拒绝静默覆盖文件", async (t) => {
  const { app, client, context, directory } = await setup(t);
  const run = (command: string, args: unknown = {}) =>
    executeBridge(app, client, { command, context, args }) as Promise<any>;
  const draft = await run("createDraft");
  const original = (await client.list())[0]!;
  const imagePath = join(directory, "chosen.png");
  await writeFile(
    imagePath,
    await readFile(await client.blobPath(original.visual.primary.sha256)),
  );
  const fields = { ...draftFixture, name: { "zh-CN": "一起稳步推进", en: "Moving steadily" } };
  const saved = await run("saveDraft", {
    id: draft.draft_id,
    version: draft.version,
    fields,
    imagePath,
  });
  const preview = await run("previewDraft", {
    id: saved.draft_id,
    version: saved.version,
  });
  assert.match(preview.preview, /^data:image\/webp;base64,/);
  await assert.rejects(
    run("confirmDraft", {
      id: saved.draft_id,
      version: saved.version,
      reviewed: false,
    }),
    /REVIEW_REQUIRED/,
  );
  const expression = await run("confirmDraft", {
    id: saved.draft_id,
    version: saved.version,
    reviewed: true,
  });
  assert.deepEqual(expression.name, fields.name);
  const path = join(directory, "export.amoji");
  await run("exportPack", {
    refs: [
      { asset_id: expression.asset_id, revision_id: expression.revision_id },
    ],
    path,
  });
  const bytes = await readFile(path);
  await assert.rejects(
    run("exportPack", {
      refs: [
        { asset_id: expression.asset_id, revision_id: expression.revision_id },
      ],
      path,
    }),
    /EXPORT_EXISTS/,
  );
  assert.deepEqual(await readFile(path), bytes);
  assert.ok(await run("importPack", { path }));
  const entry = await client.getEntry(expression.asset_id);
  await run("archive", {
    assetId: expression.asset_id,
    version: entry.version,
    archived: true,
  });
  assert.ok(!(await app.browse({ query: fields.name["zh-CN"], page: 0 })).items.length);
});

test("共享服务本身拒绝无回合 AI 工具，桥接只给模型纯文字结果；建议不能改版权", async (t) => {
  const { app, client, context } = await setup(t);
  const binding = await client.bind(context);
  await assert.rejects(client.search(binding, "加油"), /TURN_REQUIRED/);
  await assert.rejects(client.express(binding, { selection_token: "not-a-token" }), /TURN_REQUIRED/);
  await client.unbind(binding);
  const run = (command: string, args: unknown, ctx = context) =>
    executeBridge(app, client, { command, context: ctx, args }) as Promise<any>;
  const turn = { ...context, turnId: "actual-turn", turnOrdinal: 1 };
  const found = await run("search", { query: "加油" }, turn);
  const emitted = await run(
    "tool",
    { name: "express", input: { selection_token: found.candidates[0].selection_token } },
    turn,
  );
  assert.match(emitted.marker, /^\[\[amoji:/);
  assert.deepEqual([emitted.status, emitted.from], ["sent", "ai"]);
  const tools = await run("tools", {});
  assert.deepEqual(tools.map((tool: any) => tool.name), ["express", "search", "resolve"]);
  assert.doesNotMatch(JSON.stringify(emitted), /visual|base64|sha256|image\//);
  const ask = await run("suggestionRequest", { intent: "感谢搭档耐心解释" });
  assert.equal(ask.maxTokens, 1200);
  assert.equal(ask.timeoutMs, 45000);
  assert.deepEqual(JSON.parse(ask.prompt), { intent: "感谢搭档耐心解释", locale: "zh-CN" });
  const suggestion = { realizes: "core:thanks", name: "谢谢", meaning: "感谢搭档", fallback: "谢谢", tags: ["感谢"] };
  await assert.rejects(run("parseSuggestion", { text: JSON.stringify({ ...suggestion, rights: { license: "伪造授权" } }) }), /SUGGESTION_OUTPUT_INVALID/);
  await assert.rejects(run("parseSuggestion", { text: JSON.stringify({ ...suggestion, realizes: "core:approve" }) }), /SUGGESTION_OUTPUT_INVALID/);
  const fields = await run("parseSuggestion", { text: JSON.stringify(suggestion), locale: "en" });
  assert.deepEqual([fields.realizes, fields.original_locale, fields.name], ["core:thanks", "en", { en: "谢谢" }]);
  assert.ok(!("rights" in fields));
});

test("固定语义中的文件提及符被 JSON 转义，不触发宿主附加文件且语义无损", async (t) => {
  const { app, context } = await setup(t);
  const ref = (await app.browse({ query: "", page: 0 })).items[0]!.expression;
  const stored = await app.receive(context, ref, "escape");
  const revision = stored.revision!;
  const message = {
    ...stored, note: "看看 @~/secret.txt",
    revision: { ...revision, semantics: { ...revision.semantics, [revision.original_locale]: { ...revision.semantics[revision.original_locale]!, meaning: "提及 @/private/file 只是文字" } } },
  };
  const text = humanText(message);
  assert.ok(!text.includes("@"));
  const projection = JSON.parse(text.slice(text.lastIndexOf("\n") + 1));
  assert.equal(projection.note, message.note);
  assert.equal(projection.meaning, "提及 @/private/file 只是文字");
});

test("文件失败返回可显示的稳定错误，不泄露本地路径或误报 Node 缺失", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "amoji-file-errors-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(readBoundedFile(join(directory, "missing.png"), 100), {
    code: "FILE_READ_FAILED",
  });
  await assert.rejects(
    writeNewFile(
      join(directory, "missing", "export.amoji"),
      Buffer.from("pack"),
    ),
    { code: "FILE_WRITE_FAILED" },
  );
});


test("真实 stdin 跨 UTF-8 字符分块不改变中文意图", async (t) => {
  const { directory, context } = await setup(t);
  const bytes = Buffer.from(JSON.stringify({ command: "suggestionRequest", context, args: { intent: "感谢搭档🌱" } }));
  const boundary = bytes.indexOf(Buffer.from("感")) + 1;
  const child = spawn(process.execPath, ["--import", "tsx", "src/claude-mods/main.ts"], {
    env: { ...process.env, AMOJI_DATA_DIR: directory }, stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => { output += chunk; });
  const exited = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Bridge exit ${code}`)));
  });
  child.stdin.write(bytes.subarray(0, boundary));
  await delay(500); // Separate actual OS pipe reads, including the incomplete UTF-8 code point.
  child.stdin.end(bytes.subarray(boundary));
  await exited;
  const reply = JSON.parse(output);
  assert.equal(reply.ok, true);
  assert.deepEqual(JSON.parse(reply.result.prompt), { intent: "感谢搭档🌱", locale: "zh-CN" });
});

test("冲突另存可沿用原图片摘要，远端草稿与本地文字互不覆盖", async (t) => {
  const { app, client, context } = await setup(t);
  const run = (command: string, args: unknown = {}) => executeBridge(app, client, { command, context, args }) as Promise<any>;
  const expression = (await client.list()).find(e => !e.visual.animated)!;
  const original = await run("createDraft");
  const fields = { ...draftFixture, name: { "zh-CN": "我的本地修改", en: "My local edit" } };
  const remote = await run("saveDraft", { id: original.draft_id, version: original.version, fields: { ...fields, name: { "zh-CN": "另一会话的修改", en: "Elsewhere" } } });
  await assert.rejects(run("saveDraft", {id:original.draft_id,version:original.version,fields}), /DRAFT_CONFLICT/);
  const fork = await run("createDraft");
  const saved = await run("saveDraft", { id: fork.draft_id, version: fork.version, fields, imageHash: expression.visual.primary.sha256 });
  assert.deepEqual(saved.fields.name, fields.name);
  assert.deepEqual(saved.visual.primary, expression.visual.primary);
  assert.equal((await client.getDraft(original.draft_id)).version, remote.version);
  assert.equal((await client.getDraft(original.draft_id)).fields.name["zh-CN"], "另一会话的修改");
  await assert.rejects(run("saveDraft", {id:saved.draft_id,version:saved.version,fields,imageHash:"../../private"}), /INVALID_ARGUMENT/);
});

test("码位家族在完整结果上筛选再取窗口，未知分类被拒绝", async (t) => {
  const { app } = await setup(t);
  const all = await app.browseWindow({ query: "", offset: 0, limit: 100 });
  const categoryOf = (x: any) => actEntry(x.expression.realizes).family;
  assert.deepEqual(all.categories, ["grounding", "steering", "progress", "epistemic", "social"]);
  for (const category of all.categories) {
    const expected = all.items.filter(x => categoryOf(x) === category);
    const first = await app.browseWindow({ query: "", category, offset: 0, limit: 1 });
    assert.equal(first.total, expected.length);
    assert.equal(first.items[0]?.expression.asset_id, expected[0]?.expression.asset_id);
    assert.deepEqual(first.categories, all.categories);
  }
  await assert.rejects(app.browseWindow({ query: "", category: "forged", offset: 0, limit: 1 }), /INVALID_ARGUMENT|无效/);
});

test("表情包筛选只显示该包，名称取最新发布，未知包回到全部", async (t) => {
  const { app } = await setup(t);
  const all = await app.browseWindow({ query: "", offset: 0, limit: 100 });
  assert.equal(all.pack, "all");
  assert.deepEqual(all.packs.map(p => p.name["zh-CN"]).sort(), ["办公", "经典"]);
  for (const pack of all.packs) {
    const only = await app.browseWindow({ query: "", pack: pack.pack_id, offset: 0, limit: 100 });
    assert.equal(only.pack, pack.pack_id);
    assert.ok(only.total > 0 && only.total < all.total);
    assert.ok(only.items.every(entry => entry.pack_id === pack.pack_id));
    assert.deepEqual(only.packs, all.packs, "the choices stay visible while one pack is shown");
  }
  const unknown = await app.browseWindow({ query: "", pack: "missing", offset: 0, limit: 100 });
  assert.equal(unknown.pack, "all");
  assert.equal(unknown.total, all.total);
});

test("窄栏语义完整换行，不截断固定内容", async () => {
  const { wrapText } = await import(new URL("../src/claude-mods/native/text-layout.js", import.meta.url).href);
  const meaning = "表达发送者觉得很好笑、非常开心或畅快的情绪反应。";
  const wrapped = wrapText(meaning, 30);
  assert.ok(wrapped.includes("\n"));
  assert.equal(wrapped.replaceAll("\n", ""), meaning);
  for (const line of wrapped.split("\n")) assert.ok([...line].length <= 15);
  assert.ok(wrapText("PNG / JPG / WebP / GIF · 10 MiB", 28).includes("MiB"));
  assert.equal(wrapText("仅根据文字生成，按所选模型计费。", 32).includes("\n。"), false);
});

test("Claude 桥接呈现待决策与快捷回复，作答只保存一次并返回给模型的偏好文字", async (t) => {
  const { app, client, context } = await setup(t);
  const turn = { ...context, turnId: "real-turn", turnOrdinal: 1 };
  const sent = await app.express(turn, {
    act: "core:decide", rationale: "两种做法都可行", replies: ["core:thanks"],
    options: [{ id: "a", label: "方案甲" }, { id: "b", label: "方案乙" }],
  });
  assert.ok(sent.status === "sent", JSON.stringify(sent));
  const run = (command: string, args: Record<string, unknown> = {}) => executeBridge(app, client, { context, command, args }) as Promise<any>;
  const [card] = await run("pending");
  assert.equal(card.messageId, sent.message.message_id);
  assert.equal(card.rationale, "两种做法都可行");
  assert.deepEqual(card.options.map((o: { id: string }) => o.id), ["a", "b"]);
  assert.equal(card.replies[0].act, "core:thanks");
  const answered = await run("choose", { messageId: card.messageId, option: "a" });
  assert.match(answered.text, /不构成授权/); assert.match(answered.text, /方案甲/);
  assert.equal((await run("choose", { messageId: card.messageId, option: "a" })).text, answered.text, "同一选项可安全重取文字以重发");
  await assert.rejects(run("choose", { messageId: card.messageId, option: "b" }), /ALREADY_CHOSEN/);
  assert.deepEqual(await run("pending"), [], "已作答不再待决");
  const second = await app.express({ ...turn, turnId: "next", turnOrdinal: 2 }, { act: "core:celebrate", replies: ["core:thanks"] });
  assert.ok(second.status === "sent", JSON.stringify(second));
  const [open] = await run("pending");
  const reply = await run("receive", { act: "core:thanks", respondsTo: open.messageId, requestId: "reply-1" });
  assert.match(reply.text, /core:thanks/);
  assert.deepEqual(await run("pending"), [], "已回应的快捷回复不再显示");
});
