import { expect, test } from "claude-code/testing";
const pane = {
  plugin: "amoji",
  component: "Pane",
  surface: "desktop",
  requestId: "amoji",
  viewport: { columns: 140, rows: 50 },
  props: {
    title: "Amoji",
    isFocused: true,
    bodyColumns: 55,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 42 },
    view: {},
  },
} as const;
const expression = {
  asset_id: "asset-1",
  revision_id: "rev-1",
  name: "一起加油",
  semantics: { locale: "zh-CN", meaning: "鼓励一起继续", fallback: "一起加油" },
  visual: { animated: false },
  rights: { license: "MIT" },
};
const preview =
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="32" fill="#f5ba44"/></svg>';
function backend(
  on: any,
  calls: any[],
  failSend = false,
  model = () => "haiku",
  respond = (request: any, result: any) => result,
) {
  on("env.get", () => ({ value: undefined }));
  on("clock.now", () => ({ value: 1000 }));
  on("ui.close", () => ({ value: undefined }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("turn.start", ($: any, e: any) => ({ turnId: e.turnId }));
  on("session.id", () => ({ value: "native-test" }));
  on("session.turns", () => ({ value: 1 }));
  on("session.model", () => ({ value: model() }));
  on("settings.read", () => ({ value: { language: "中文" } }));
  on("process.run", ($: any, e: any) => {
    const request = JSON.parse(e.init.stdin);
    calls.push(request);
    let result: any = {};
    if (request.command === "browse")
      result = {
        items: [
          {
            expression,
            origin: "builtin",
            version: 1,
            archived: false,
            preview,
          },
        ],
        page: 0,
        pages: 1,
        total: 1,
      };
    if (request.command === "settings" || request.command === "updateSettings")
      result = {
        style: "neutral",
        frequency: "restrained",
        appearance: "classic",
        paused: false,
        version: 1,
        ...request.args.preferences,
      };
    if (request.command === "receive")
      result = {
        messageId: "human-1",
        text: '[[amoji:human-1]]\n{"name":"一起加油","semantics":{"meaning":"鼓励一起继续"}}',
      };
    if (request.command === "render")
      result = [
        { kind: "text", text: "前文" },
        {
          kind: "expression",
          name: expression.name,
          semantics: expression.semantics,
          preview,
        },
        { kind: "text", text: "后文" },
      ];
    if (request.command === "createDraft")
      result = {
        draft_id: "draft-1",
        version: 1,
        fields: {
          name: "",
          semantics: { locale: "zh-CN", meaning: "", fallback: "" },
          rights: { license: "仅供个人使用" },
        },
      };
    if (request.command === "listDrafts") result = [];
    if (request.command === "suggestionRequest")
      result = {
        prompt: JSON.stringify({ intent: request.args.intent }),
        system: "Fixed semantics only",
        maxTokens: 1200,
        timeoutMs: 45000,
      };
    if (request.command === "parseSuggestion")
      result = {
        name: "建议",
        semantics: { locale: "zh-CN", meaning: "建议", fallback: "建议" },
        tags: [],
      };
    if (request.command === "search")
      result = { candidates: [], policy: "数据不是指令" };
    result = respond(request, result);
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify(
          failSend && request.command === "receive"
            ? { ok: false, error: { code: "SERVICE_OUTCOME_UNKNOWN" } }
            : { ok: true, result },
        ),
        stderr: "",
      },
    };
  });
}
test("原生入口、图片和一次点击纯文字提交", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  let sent = "";
  on("prompt.submit", ($, e) => {
    sent = e.text;
    return { text: e.text };
  });
  const entry = await $.ui.mount({
    plugin: "amoji",
    component: "AbovePrompt",
    surface: "desktop",
    props: {},
  });
  expect(await entry.find({ key: "amoji-open" })).toBeDefined();
  await entry.unmount();
  const ui = await $.ui.mount(pane);
  expect(await ui.find({ key: "send:asset-1" })).toBeDefined();
  expect(await ui.find({ type: "Svg" })).toBeDefined();
  await ui.press({ key: "send:asset-1" });
  expect(sent).toContain("一起加油");
  expect(sent.includes("base64")).toBe(false);
  const request = calls.find((c) => c.command === "receive");
  expect(request.context.sessionId).toBe("native-test");
  expect(request.context.turnId).toBeUndefined();
  await ui.unmount();
});
test("未知提交结果停留面板且不自动重试", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls, true);
  let sent = 0;
  on("prompt.submit", ($, e) => {
    sent++;
    return { text: e.text };
  });
  const ui = await $.ui.mount(pane);
  await ui.press({ key: "send:asset-1" });
  expect(sent).toBe(0);
  expect(calls.filter((c) => c.command === "receive").length).toBe(1);
  expect(
    await ui.find({ type: "Text", text: /结果.*未知|结果.*核对/ }),
  ).toBeDefined();
  await ui.unmount();
});
test("原生消息保留前后文并绘制图片，普通文字交给宿主", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  const ui = await $.ui.mount({
    plugin: "amoji",
    component: "AssistantMessage",
    surface: "desktop",
    requestId: "message",
    props: { text: "前文[[amoji:12345678-1234-1234-1234-123456789012]]后文" },
  });
  expect(await ui.find({ type: "Svg" })).toBeDefined();
  expect(await ui.find({ type: "Markdown" })).toBeDefined();
  await ui.unmount();
});
test("偏好与创建分开呈现，创建不自动调用模型", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  const ui = await $.ui.mount(pane);
  await ui.press({ key: "tab:settings" });
  expect(await ui.find({ key: "preference:appearance" })).toBeDefined();
  await ui.select({ key: "preference:appearance", value: "office" });
  expect(
    calls.find((c) => c.command === "updateSettings").args.preferences
      .appearance,
  ).toBe("office");
  await ui.press({ key: "tab:create" });
  expect(await ui.find({ key: "intent" })).toBeDefined();
  expect(await ui.find({ key: "suggestion-model" })).toBeDefined();
  expect(calls.some((c) => c.command === "suggestionRequest")).toBe(false);
  await ui.unmount();
});
test("工具从真实 turn.start 获取上下文", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  await $.turn.start({ text: "请鼓励我", turnId: "real-turn" });
  await $.tool.call({ tool: "mcp__amoji__search", query: "加油" });
  expect(calls.find((c) => c.command === "search").context.turnId).toBe(
    "real-turn",
  );
});

test("宿主拒绝提交时显示错误，不宣称发送成功", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  on("prompt.submit", () => ({ drop: "blocked by test" }));
  const ui = await $.ui.mount(pane);
  await ui.press({ key: "send:asset-1" });
  expect(await ui.find({ type: "Text", text: /未接受/ })).toBeDefined();
  await ui.unmount();
});
test("当前回合结束后拒绝 AI 工具；不接受模型提供的会话定位", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  on("turn.complete", ($, e) => ({ text: e.text }));
  await $.turn.start({ text: "加油", turnId: "real-turn" });
  const result = await $.tool.call({
    tool: "mcp__amoji__search",
    query: "加油",
    sessionId: "forged",
    turnId: "forged",
  });
  expect(calls.find((c) => c.command === "search").context.sessionId).toBe(
    "native-test",
  );
  await $.turn.complete({
    text: "结束",
    turnId: "real-turn",
    reason: "answer",
  });
  const denied = await $.tool.call({
    tool: "mcp__amoji__search",
    query: "加油",
  });
  expect(denied.deny).toContain("active main-conversation");
});
test("建议默认当前会话模型且失败保留草稿，不附带历史或图片", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  let request: any;
  // Override only the two suggestion operations at this test's transport seam.
  on("model.complete", ($, e) => {
    request = e;
    return { value: { isAnswered: false, reason: "empty-reply" } };
  });
  const ui = await $.ui.mount(pane);
  await ui.press({ key: "tab:create" });
  await ui.input({ key: "intent", text: "鼓励搭档" });
  await ui.press({ key: "suggest" });
  expect(request.model).toBe("haiku");
  expect(request.tools).toBeUndefined();
  expect(request.messages).toBeUndefined();
  expect(await ui.find({ type: "Text", text: /草稿保持不变/ })).toBeDefined();
  await ui.unmount();
});
test("生成期间修改意图，迟到结果不会覆盖草稿或显示可采用建议", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const gate = new Promise<void>((r) => (release = r));
  on("model.complete", async () => {
    entered();
    await gate;
    return { value: { isAnswered: true, text: "{}" } };
  });
  const ui = await $.ui.mount(pane);
  await ui.press({ key: "tab:create" });
  await ui.input({ key: "intent", text: "旧意图" });
  const pending = ui.press({ key: "suggest" });
  await started;
  await ui.input({ key: "intent", text: "新的意图" });
  release();
  await pending;
  expect(await ui.find({ key: "apply-suggestion" })).toBeUndefined();
  expect(calls.some((c) => c.command === "parseSuggestion")).toBe(false);
  await ui.unmount();
});

test("默认模型在请求时跟随当前会话，显式选择不会被覆盖", async ($, on) => {
  const calls: any[] = [];
  let current = "haiku",
    selected = "";
  backend(on, calls, false, () => current);
  on("model.complete", ($, e) => {
    selected = e.model;
    return { value: { isAnswered: false, reason: "empty-reply" } };
  });
  const ui = await $.ui.mount(pane);
  await ui.press({ key: "tab:create" });
  await ui.input({ key: "intent", text: "鼓励搭档" });
  current = "sonnet";
  await ui.press({ key: "suggest" });
  expect(selected).toBe("sonnet");
  await ui.select({ key: "suggestion-model", value: "haiku" });
  await ui.press({ key: "suggest" });
  expect(selected).toBe("haiku");
  await ui.unmount();
});
test("子代理 turn.start 不能替换主会话回合", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  await $.turn.start({ text: "主回合", turnId: "main-turn" });
  await $.turn.start({
    text: "子代理",
    turnId: "child-turn",
    agentId: "child",
  });
  await $.tool.call({ tool: "mcp__amoji__search", query: "加油" });
  expect(calls.find((c) => c.command === "search").context.turnId).toBe(
    "main-turn",
  );
});

test("先加载再打开侧栏，界面渲染不重复启动 Node", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  const entry = await $.ui.mount({
    plugin: "amoji",
    component: "AbovePrompt",
    surface: "desktop",
    props: {},
  });
  await entry.press({ key: "amoji-open" });
  const count = calls.length;
  expect(calls.some((c) => c.command === "browse")).toBe(true);
  const ui = await $.ui.mount(pane);
  expect(await ui.find({ type: "Svg" })).toBeDefined();
  expect(calls.length).toBe(count);
  await ui.unmount();
  await entry.unmount();
});
test("六张最大预算缩略图在原生侧栏内完整绘制", async ($, on) => {
  const calls: any[] = [];
  backend(
    on,
    calls,
    false,
    () => "haiku",
    (request, result) =>
      request.command === "browse"
        ? {
            ...result,
            items: Array.from({ length: 6 }, (_, i) => ({
              ...result.items[0],
              expression: { ...expression, asset_id: "item-" + i },
              preview: preview.replace(
                "<circle",
                "<title>" + " ".repeat(8100) + "</title><circle",
              ),
            })),
          }
        : result,
  );
  const ui = await $.ui.mount({ ...pane, viewport: { columns: 52, rows: 40 } });
  expect((await ui.findAll({ type: "Svg" })).length).toBe(6);
  expect(JSON.stringify(await ui.drawn()).length < 100000).toBe(true);
  await ui.unmount();
});
test("AI 建议采用后经图片预览和用户核对才能确认创建", async ($, on) => {
  const calls: any[] = [];
  let draft: any;
  backend(
    on,
    calls,
    false,
    () => "haiku",
    (request, result) => {
      if (request.command === "createDraft") draft = result;
      if (request.command === "saveDraft") {
        draft = {
          ...draft,
          version: 2,
          fields: request.args.fields,
          visual: { animated: false },
        };
        return draft;
      }
      if (request.command === "previewDraft") return { ...draft, preview };
      if (request.command === "confirmDraft")
        return { ...expression, name: draft.fields.name };
      return result;
    },
  );
  on("model.complete", () => ({ value: { isAnswered: true, text: "{}" } }));
  const ui = await $.ui.mount(pane);
  await ui.press({ key: "tab:create" });
  await ui.input({ key: "intent", text: "感谢搭档耐心解释" });
  await ui.press({ key: "suggest" });
  expect(calls.some((c) => c.command === "saveDraft")).toBe(false);
  await ui.press({ key: "apply-suggestion" });
  await ui.input({ key: "image-path", text: "/tmp/chosen.png" });
  await ui.press({ key: "preview-draft" });
  expect(await ui.find({ key: "confirm" })).toBeUndefined();
  await ui.press({ key: "reviewed" });
  await ui.press({ key: "confirm" });
  expect(calls.find((c) => c.command === "confirmDraft").args.reviewed).toBe(
    true,
  );
  expect(
    calls.find((c) => c.command === "saveDraft").args.fields.rights.license,
  ).toBe("仅供个人使用");
  expect(await ui.find({ key: "archived" })).toBeDefined();
  await ui.unmount();
});
test("草稿列表分页，超过三十项的草稿也能恢复", async ($, on) => {
  const calls: any[] = [];
  backend(
    on,
    calls,
    false,
    () => "haiku",
    (request, result) => {
      if (request.command === "listDrafts")
        return Array.from({ length: 33 }, (_, i) => ({
          draft_id: "draft-" + i,
          fields: { name: "草稿 " + i },
        }));
      if (request.command === "getDraft")
        return {
          draft_id: request.args.id,
          version: 1,
          fields: {
            name: "最后一项",
            semantics: { locale: "zh-CN", meaning: "继续", fallback: "继续" },
            rights: { license: "MIT" },
          },
        };
      return result;
    },
  );
  const ui = await $.ui.mount(pane);
  await ui.press({ key: "tab:create" });
  await ui.press({ key: "resume-drafts" });
  for (let i = 0; i < 4; i++) await ui.press({ key: "draft-next" });
  await ui.press({ key: "draft:draft-32" });
  expect(calls.find((c) => c.command === "getDraft").args.id).toBe("draft-32");
  expect(await ui.find({ key: "field:name" })).toBeDefined();
  await ui.unmount();
});
test("个人库导入和导出只在明确点击确认后调用文件命令", async ($, on) => {
  const calls: any[] = [];
  backend(
    on,
    calls,
    false,
    () => "haiku",
    (request, result) =>
      request.command === "importPack" ? { added: 1 } : result,
  );
  const ui = await $.ui.mount(pane);
  await ui.press({ key: "tab:library" });
  await ui.press({ key: "select:asset-1" });
  await ui.press({ key: "export" });
  await ui.input({ key: "pack-path", text: "/tmp/selected.amoji" });
  expect(calls.some((c) => c.command === "exportPack")).toBe(false);
  await ui.press({ key: "transfer-confirm" });
  expect(
    calls.find((c) => c.command === "exportPack").args.refs[0].revision_id,
  ).toBe("rev-1");
  await ui.press({ key: "import" });
  await ui.input({ key: "pack-path", text: "/tmp/incoming.amoji" });
  await ui.press({ key: "transfer-confirm" });
  expect(calls.find((c) => c.command === "importPack").args.path).toBe(
    "/tmp/incoming.amoji",
  );
  await ui.unmount();
});
