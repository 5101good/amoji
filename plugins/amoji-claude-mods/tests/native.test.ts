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
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const pictureClient = async (ui: any) => (await ui.findAll({ type: "Client" })).find((node: any) => node.props.module.endsWith("picture-input.js"));
async function navigateTo(ui: any, tab: string, startDraft = true) {
  if (tab === "picker") { await ui.press({ key: "tab:picker" }); return; }
  if (!(await ui.find({ key: "manager-section" }))) await ui.press({ key: "tab:library" });
  await ui.select({ key: "manager-section", value: tab });
  if (tab === "create" && startDraft && !(await ui.find({ key: "intent" }))) await ui.press({ key: "new-draft" });
}
function backend(
  on: any,
  calls: any[],
  failSend = false,
  model = () => "haiku",
  respond = (request: any, result: any) => result,
  language = "中文",
) {
  on("env.get", () => ({ value: undefined }));
  on("clock.now", () => ({ value: 1000 }));
  on("ui.close", () => ({ value: undefined }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("turn.start", ($: any, e: any) => ({ turnId: e.turnId }));
  on("session.id", () => ({ value: "native-test" }));
  on("session.turns", () => ({ value: 1 }));
  on("session.model", () => ({ value: model() }));
  on("settings.read", () => ({ value: { language } }));
  on("process.run", async ($: any, e: any) => {
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
    result = await respond(request, result);
    if (request.command === "updateSettings" && request.args.browse && !result.collection && !result.bridgeError)
      result = { preferences: result, collection: { total: 1, offset: 0,
        items: [{ expression, preview, version: 1, origin: "builtin", archived: false }] } };
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify(
          result?.bridgeError
            ? { ok: false, error: { code: result.bridgeError } }
            : failSend && request.command === "receive"
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
  expect(await pictureClient(ui)).toBeDefined();
  expect(await ui.find({ type: "Svg" })).toBeUndefined();
  await ui.press({ key: "send:asset-1" });
  expect(sent).toContain("一起加油");
  expect(sent.includes("base64")).toBe(false);
  const request = calls.find((c) => c.command === "receive");
  expect(request.context.sessionId).toBe("native-test");
  expect(request.context.turnId).toBeUndefined();
  await ui.unmount();
});
test("图片完整左键点击跨重绘发送一次，重复与过期事件不重发", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  const sent: string[] = [];
  on("prompt.submit", ($, e) => { sent.push(e.text); return { text: e.text }; });
  const ui = await $.ui.mount(pane);
  const picture = await pictureClient(ui);
  expect(picture).toBeDefined();
  const key = picture!.props.key as string;
  await ui.resize({ in: key, columns: 9, rows: 4 });
  await ui.pointer({ in: key, type: "down", x: 8, y: 3, button: "left" });
  expect(sent.length).toBe(0);
  await ui.redraw();
  await ui.pointer({ in: key, type: "up", x: 8, y: 3, button: "left" });
  expect(sent.length).toBe(1);
  expect(sent[0]).toContain("一起加油");
  expect(sent[0].includes("base64")).toBe(false);
  expect(calls.filter(c => c.command === "receive").length).toBe(1);
  // The accepted click retires its target. A stale surface message cannot send.
  await ui.post({ action: "send" }, { in: key }).catch(() => {});
  const nextPicture = await pictureClient(ui);
  await ui.pointer({ in: nextPicture!.props.key as string, type: "up", x: 8, y: 3, button: "left" });
  expect(sent.length).toBe(1);
  await ui.unmount();
});
test("图片右键、修饰键、拖拽、移出和单独松开都不发送", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  on("prompt.submit", ($, e) => ({ text: e.text }));
  const ui = await $.ui.mount(pane);
  const picture = await pictureClient(ui);
  expect(picture).toBeDefined();
  const key = picture!.props.key as string;
  await ui.resize({ in: key, columns: 9, rows: 4 });
  const event = (type: any, x = 5, y = 2, extra: any = {}) => ui.pointer({ in: key, type, x, y, button: "left", ...extra });
  await event("up");
  await event("down", 5, 2, { button: "right" }); await event("up", 5, 2, { button: "right" });
  await event("down", 5, 2, { ctrl: true }); await event("up");
  await event("down"); await event("move", 6); await event("move", 5); await event("up");
  await event("down"); await event("leave"); await event("up");
  await event("down"); await event("up", 14);
  expect(calls.filter(c => c.command === "receive").length).toBe(0);
  await event("down", 0, 0); await event("up", 0, 0);
  expect(calls.filter(c => c.command === "receive").length).toBe(1);
  await ui.unmount();
});
test("图片消息只接受当前目标，不信任客户端提供的表情或过期 key", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  on("prompt.submit", ($, e) => ({ text: e.text }));
  const ui = await $.ui.mount(pane);
  const first = await pictureClient(ui);
  expect(first).toBeDefined();
  const oldKey = first!.props.key as string;
  await ui.post({ action: "delete", asset_id: "forged" }, { in: oldKey });
  expect(calls.filter(c => c.command === "receive").length).toBe(0);
  await ui.press({ key: "category:全部" });
  const current = await pictureClient(ui);
  expect(current!.props.key === oldKey).toBe(false);
  await ui.post({ action: "send", asset_id: "forged", semantics: "forged" }, { in: current!.props.key as string });
  expect(calls.find(c => c.command === "receive").args.ref.asset_id).toBe("asset-1");
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
  expect(await ui.find({type:"Markdown",text:/data:image/})).toBeDefined();
  expect(await ui.find({ type: "Svg" })).toBeUndefined();
  expect(await ui.find({ type: "Markdown" })).toBeDefined();
  expect(await ui.find({ type: "Text", text: "Claude" })).toBeUndefined();
  const message = await ui.find({ key: "amoji-assistant-message" });
  expect(message?.props.alignItems).toBe("flex-start");
  await ui.unmount();
});
test("人的表情只用右侧位置区分角色，重绘不重复读取消息", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  const ui = await $.ui.mount({
    plugin: "amoji", component: "UserMessage", surface: "desktop",
    requestId: "human-message", props: { text: "[[amoji:human-1]]", origin: { kind: "prompt" }, isExpanded: true },
  });
  expect(await ui.find({ type: "Text", text: "你" })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: "You" })).toBeUndefined();
  const role = await ui.find({ key: "amoji-human-message" });
  expect(role?.props.alignItems).toBe("flex-end");
  await ui.redraw();
  expect(calls.filter(c => c.command === "render").length).toBe(1);
  await ui.unmount();
});
test("提交成功立即反馈等待回复，主回合完成后解除等待", async ($, on) => {
  on("turn.complete", ($, e) => ({ text: e.text }));
  const calls: any[] = [];
  backend(on, calls);
  let submitted = "";
  on("prompt.submit", ($, e) => { submitted = e.text; return { text: e.text }; });
  const ui = await $.ui.mount(pane);
  await ui.press({ key: "send:asset-1" });
  const entry = await $.ui.mount({ plugin: "amoji", component: "AbovePrompt", surface: "desktop", props: {} });
  expect(await entry.find({ type: "Text", text: /已发送.*等待/ })).toBeDefined();
  await $.turn.start({ text: "unrelated", turnId: "unrelated" });
  await $.turn.complete({ text: "done", turnId: "unrelated", reason: "answer" });
  await entry.redraw();
  expect(await entry.find({ type: "Text", text: /等待/ })).toBeDefined();
  await $.turn.start({ text: submitted, turnId: "reply" });
  await $.turn.complete({ text: "done", turnId: "reply", reason: "answer" });
  await entry.redraw();
  expect(await entry.find({ type: "Text", text: /等待/ })).toBeUndefined();
  await entry.unmount();
  await ui.unmount();
});
test("本地准备变慢时立即显示发送中，连续点击不会多次提交", async ($, on) => {
  const calls: any[] = [];
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const gate = new Promise<void>(r => { release = r; });
  backend(on, calls, false, () => "haiku", async (request, result) => {
    if (request.command === "receive") { entered(); await gate; }
    return result;
  });
  let submitted = 0;
  on("prompt.submit", ($, e) => { submitted++; return { text: e.text }; });
  const ui = await $.ui.mount(pane);
  const sending = ui.press({ key: "send:asset-1" });
  await started;
  const entry = await $.ui.mount({ plugin: "amoji", component: "AbovePrompt", surface: "desktop", props: {} });
  expect(await entry.find({ type: "Text", text: /正在发送/ })).toBeDefined();
  await ui.press({ key: "send:asset-1" });
  expect(calls.filter(c => c.command === "receive").length).toBe(1);
  release();
  await sending;
  expect(submitted).toBe(1);
  await entry.unmount();
  await ui.unmount();
});
test("提交返回的冻结图片可立即绘制，无须再次启动渲染进程", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls, false, () => "haiku", (request, result) =>
    request.command === "receive" ? { ...result, segments: [{ kind: "expression", name: expression.name, semantics: expression.semantics, preview }] } : result);
  let submitted = "";
  on("prompt.submit", ($, e) => { submitted = e.text; return { text: e.text }; });
  const ui = await $.ui.mount(pane);
  await ui.press({ key: "send:asset-1" });
  const message = await $.ui.mount({ plugin: "amoji", component: "UserMessage", surface: "desktop", props: { text: submitted } });
  expect(await message.find({type:"Markdown",text:/data:image/})).toBeDefined();
  expect(await message.find({ type: "Svg" })).toBeUndefined();
  expect(calls.some(c => c.command === "render")).toBe(false);
  await message.unmount();
  await ui.unmount();
});
test("偏好与创建分开呈现，创建不自动调用模型", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  const ui = await $.ui.mount(pane);
  await navigateTo(ui, "settings");
  expect(await ui.find({ key: "preference:appearance" })).toBeDefined();
  await ui.select({ key: "preference:appearance", value: "office" });
  expect(
    calls.find((c) => c.command === "updateSettings").args.preferences
      .appearance,
  ).toBe("office");
  await navigateTo(ui, "create");
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
  await navigateTo(ui, "create");
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
  await navigateTo(ui, "create");
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
  await navigateTo(ui, "create");
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
  expect(await pictureClient(ui)).toBeDefined();
  expect(await ui.find({ type: "Svg" })).toBeUndefined();
  expect(calls.length).toBe(count);
  await ui.unmount();
  await entry.unmount();
});
test("完整可见窗口在预算内绘制且不出现分页控件", async ($, on) => {
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
            total: 20, offset: 0,
            items: Array.from({ length: 20 }, (_, i) => ({
              ...result.items[0],
              expression: { ...expression, asset_id: "item-" + i },
              preview: "data:image/avif;base64," + "A".repeat(4468),
            })),
          }
        : result,
  );
  const ui = await $.ui.mount({ ...pane, viewport: { columns: 52, rows: 40 } });
  expect((await ui.findAll({ type: "Client" })).filter(node => node.props.module.endsWith("picture-input.js")).length).toBe(20);
  expect((await ui.findAll({ type: "Svg" })).length).toBe(0);
  expect(await ui.find({ key: "previous" })).toBeUndefined();
  expect(await ui.find({ key: "next" })).toBeUndefined();
  // Full 2x raster data fits the native Markdown text budget without clipping.
  expect((await ui.findAll({ type: "Markdown", text: "![一起加油](data:image/avif;base64," + "A".repeat(4468) + ")" })).length).toBe(20);
  await ui.unmount();
});

test("画风切换保留当前图片，保存和新列表只使用一次本地请求", async ($, on) => {
  const calls: any[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  backend(on, calls, false, () => "haiku", async (request, result) => {
    if (request.command === "updateSettings") {
      await gate;
      return { preferences: result, collection: { total: 1, offset: 0,
        items: [{ expression: {...expression, asset_id: "office-1"}, preview }] } };
    }
    return result;
  });
  const ui = await $.ui.mount(pane);
  const before = calls.length;
  const pending = ui.press({key:"appearance:office"});
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(await ui.find({key:"send:asset-1"})).toBeDefined();
  release!();
  await pending;
  expect(calls.length - before).toBe(1);
  expect(calls.at(-1).args.browse).toBeDefined();
  expect(await ui.find({key:"send:office-1"})).toBeDefined();
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
  await navigateTo(ui, "create");
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
test("草稿连续呈现，超过三十项的草稿也能恢复", async ($, on) => {
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
  await navigateTo(ui, "create");
  await ui.press({ key: "resume-drafts" });
  expect(await ui.find({ key: "draft-next" })).toBeUndefined();
  await ui.press({ key: "draft:draft-32" });
  expect(calls.find((c) => c.command === "getDraft").args.id).toBe("draft-32");
  expect(await ui.find({ type: "Text", text: "最后一项" })).toBeDefined();
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
  await navigateTo(ui, "library");
  expect(await ui.find({ key: "select:asset-1" })).toBeUndefined();
  await ui.press({ key: "select-mode" });
  await ui.press({ key: "select:asset-1" });
  await ui.press({ key: "export" });
  await ui.input({ key: "pack-path", text: "/tmp/selected.amoji" });
  expect(calls.some((c) => c.command === "exportPack")).toBe(false);
  await ui.press({ key: "transfer-confirm" });
  expect(
    calls.find((c) => c.command === "exportPack").args.refs[0].revision_id,
  ).toBe("rev-1");
  await navigateTo(ui, "packs");
  await ui.press({ key: "import" });
  await ui.input({ key: "pack-path", text: "/tmp/incoming.amoji" });
  await ui.press({ key: "transfer-confirm" });
  expect(calls.find((c) => c.command === "importPack").args.path).toBe(
    "/tmp/incoming.amoji",
  );
  await ui.unmount();
});


for (const imagePath of ["", "/tmp/我的新图片.png"]) {
  test(`草稿冲突保留输入并另存独立草稿（${imagePath ? "新图" : "原图"}）`, async ($, on) => {
    const calls: any[] = [];
    let created = 0;
    const oldHash = "a".repeat(64);
    backend(on, calls, false, () => "haiku", (request, result) => {
      if (request.command === "createDraft") return { ...result, draft_id: `draft-${++created}`, visual: {primary:{sha256:oldHash}} };
      if (request.command === "saveDraft") return request.args.id === "draft-1"
        ? { bridgeError: "DRAFT_CONFLICT" }
        : { draft_id: request.args.id, version: 2, fields: request.args.fields };
      if (request.command === "getDraft") return {
        draft_id: "draft-1", version: 2,
        fields: {name:"远端内容",semantics:{locale:"zh-CN",meaning:"远端意思",fallback:"远端"},rights:{license:"MIT"}},
      };
      return result;
    });
    const ui = await $.ui.mount(pane);
    await navigateTo(ui, "create");
    await ui.press({key:"manual-edit"});
    await ui.input({key:"field:name",text:"保留我的输入"});
    if (imagePath) await ui.input({key:"image-path",text:imagePath});
    await ui.press({key:"save-draft"});
    expect(await ui.find({key:"conflict-latest"})).toBeDefined();
    await ui.press({key:"conflict-latest"});
    expect(await ui.find({type:"Text",text:/远端内容/})).toBeDefined();
    await ui.press({key:"conflict-fork"});
    const saved = calls.filter(c=>c.command === "saveDraft");
    expect(saved.length).toBe(2);
    expect(saved[1].args.id).toBe("draft-2");
    expect(saved[1].args.fields.name).toBe("保留我的输入");
    if (imagePath) expect(saved[1].args.imagePath).toBe(imagePath);
    else expect(saved[1].args.imageHash).toBe(oldHash);
    expect(await ui.find({key:"field:name"})).toBeDefined();
    await ui.unmount();
  });
}

test("冲突只有显式采用最新内容才丢弃本地编辑，后续保存使用远端版本", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls, false, () => "haiku", (request, result) => {
    if (request.command === "saveDraft") return request.args.version === 1
      ? { bridgeError: "DRAFT_CONFLICT" }
      : { draft_id: "draft-1", version: 3, fields: request.args.fields };
    if (request.command === "getDraft") return {
      draft_id: "draft-1", version: 2,
      fields: {name:"远端草稿",semantics:{locale:"zh-CN",meaning:"最新意思",fallback:"最新"},rights:{license:"MIT"}},
    };
    return result;
  });
  const ui = await $.ui.mount(pane);
  await navigateTo(ui, "create");
  await ui.press({key:"manual-edit"});
  await ui.input({key:"field:name",text:"本地输入"});
  await ui.press({key:"save-draft"});
  expect(await ui.find({key:"conflict-adopt"})).toBeUndefined();
  await ui.press({key:"conflict-latest"});
  expect(calls.filter(c=>c.command === "saveDraft").length).toBe(1);
  await ui.press({key:"conflict-adopt"});
  await ui.press({key:"save-draft"});
  const saved = calls.filter(c=>c.command === "saveDraft");
  expect(saved[1].args.version).toBe(2);
  expect(saved[1].args.fields.name).toBe("远端草稿");
  await ui.unmount();
});

test("子代理视图不向主会话误发，首次入口跟随英文配置", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls, false, () => "haiku", (_request, result) => result, "English");
  const entry = await $.ui.mount({ plugin: "amoji", component: "AbovePrompt", surface: "desktop", props: {} });
  expect(await entry.find({ key: "amoji-open", text: /Expressions/ })).toBeDefined();
  await entry.unmount();
  const ui = await $.ui.mount({ ...pane, props: { ...pane.props, view: { agentId: "child" } } });
  expect(await ui.find({ type: "Text", text: /main conversation/ })).toBeDefined();
  expect(await pictureClient(ui)).toBeUndefined();
  expect(calls.length).toBe(0);
  await ui.unmount();
});

test("连续滚动复用预读图片，超出缓存仍可到达全部表情", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls, false, () => "haiku", (request, result) => {
    if (request.command !== "browse") return result;
    const offset = request.args.offset || 0;
    const count = Math.min(request.args.limit || 6, 160 - offset);
    return { offset, total: 160, items: Array.from({ length: count }, (_, i) => ({
      ...result.items[0], expression: { ...expression, asset_id: `item-${offset + i}` },
    })) };
  });
  const ui = await $.ui.mount(pane);
  expect(await ui.find({ key: "send:item-0" })).toBeDefined();
  await ui.redraw({ ...pane.props, scroll: { offset: 70, bodyRows: 42 } });
  expect(await ui.find({ key: "send:item-0" })).toBeUndefined();
  expect(calls.filter(c => c.command === "browse").length).toBe(1);
  await ui.redraw({ ...pane.props, scroll: { offset: 350, bodyRows: 42 } });
  expect(await ui.find({ key: "send:item-159" })).toBeDefined();
  expect(calls.filter(c => c.command === "browse").at(-1).args.offset > 0).toBe(true);
  await ui.redraw({ ...pane.props, scroll: { offset: 0, bodyRows: 42 } });
  expect(await ui.find({ key: "send:item-0" })).toBeDefined();
  await ui.input({ key: "search", text: "不存在" });
  // Native keyboard accessibility remains available beside image gestures.
  expect(await ui.find({ key: "send:item-0" })).toBeDefined();
  expect(await ui.find({ key: "next" })).toBeUndefined();
  await ui.unmount();
});

test("导航 Client 在焦点重绘间保留完整点击，旧页面控件不会执行", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls);
  const ui = await $.ui.mount(pane);
  const targets = await ui.findAll({ type: "Client" });
  const tab = targets.find(n => String(n.props.key).endsWith(":tab:library"))!;
  const key = tab.props.key as string;
  await ui.resize({ in: key, columns: 8, rows: 2 });
  await ui.pointer({ in: key, type: "down", x: 3, y: 0, button: "left" });
  await ui.redraw({ ...pane.props, isFocused: false });
  await ui.redraw({ ...pane.props, isFocused: true });
  await ui.pointer({ in: key, type: "up", x: 3, y: 0, button: "left" });
  expect(await ui.find({ key: "manager-section" })).toBeDefined();
  expect(calls.filter(c => c.command === "createDraft").length).toBe(0);
  await ui.post({ action: "press" }, { in: key }).catch(() => {});
  expect(calls.filter(c => c.command === "createDraft").length).toBe(0);
  await ui.unmount();
});

test("选择器与管理分层，画风和场景筛选保留搜索，发送保留宿主面板", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls, false, () => "haiku", (request, result) => request.command === "browse"
    ? { ...result, categories: ["进度", "反馈"] } : result);
  on("prompt.submit", ($, e) => ({ text: e.text }));
  const ui = await $.ui.mount(pane);
  expect(await ui.find({ key: "manager-section" })).toBeUndefined();
  await ui.press({ key: "appearance:office" });
  expect(calls.find(c => c.command === "updateSettings").args.preferences.appearance).toBe("office");
  await ui.input({ key: "search", text: "鼓励" });
  await ui.press({ key: "category:反馈" });
  expect(calls.filter(c => c.command === "browse").at(-1).args.category).toBe("反馈");
  await navigateTo(ui, "create", false);
  expect(calls.some(c => c.command === "createDraft")).toBe(false);
  expect(await ui.find({ key: "intent" })).toBeUndefined();
  await navigateTo(ui, "picker");
  expect(calls.filter(c => c.command === "browse").at(-1).args.query).toBe("鼓励");
  expect(calls.filter(c => c.command === "browse").at(-1).args.category).toBe("反馈");
  await ui.press({ key: "send:asset-1" });
  expect(await ui.find({ key: "send:asset-1" })).toBeDefined();
  await ui.unmount();
});

test("创建先展示语义摘要，切换草稿不会丢失未保存输入", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls, false, () => "haiku", (request, result) => {
    if (request.command === "saveDraft") return { draft_id: request.args.id, version: 2, fields: request.args.fields };
    return result;
  });
  on("model.complete", () => ({ value: { isAnswered: true, text: "{}" } }));
  const ui = await $.ui.mount(pane);
  await navigateTo(ui, "create");
  await ui.input({ key: "intent", text: "鼓励搭档" });
  await ui.press({ key: "suggest" });
  await ui.press({ key: "apply-suggestion" });
  expect(await ui.find({ key: "field:meaning" })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: "建议" })).toBeDefined();
  await ui.press({ key: "new-draft" });
  expect(await ui.find({ key: "switch-save" })).toBeDefined();
  expect(calls.filter(c => c.command === "createDraft").length).toBe(1);
  await ui.press({ key: "switch-cancel" });
  await ui.press({ key: "manual-edit" });
  expect(await ui.find({ key: "field:meaning" })).toBeDefined();
  await ui.press({ key: "new-draft" });
  await ui.press({ key: "switch-save" });
  expect(calls.filter(c => c.command === "saveDraft").length).toBe(1);
  expect(calls.filter(c => c.command === "createDraft").length).toBe(2);
  await ui.unmount();
});


test("窄栏滚到底时不足整行的最后一张表情也可点击", async ($, on) => {
  const calls: any[] = [];
  backend(on, calls, false, () => "haiku", (request, result) => {
    if (request.command !== "browse") return result;
    return { offset: 0, total: 25, items: Array.from({ length: 25 }, (_, i) => ({
      ...result.items[0], expression: { ...expression, asset_id: `last-${i}` },
    })) };
  });
  const ui = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: 33, scroll: { offset: 0, bodyRows: 28 } } });
  expect(await ui.find({ key: "send:last-0" })).toBeDefined();
  await ui.redraw({ ...pane.props, bodyColumns: 33, scroll: { offset: 33, bodyRows: 28 } });
  expect(await ui.find({ key: "send:last-24" })).toBeDefined();
  expect(calls.filter(c => c.command === "browse").length).toBe(1);
  await ui.unmount();
});
