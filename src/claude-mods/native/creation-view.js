import { L } from "./transport.js";
import { LINE, SURFACE } from "./ui-kit.js";
import { edit, suggest, invalidate, save, newDraft, call, perform } from "./controller.js";

// Workflow matches dsh's workbench; file access and native controls stay here.
export function creationView($, e, s, u) {
  const { Box, Text } = $.ui.resolve(e);
  const { col, row, t, heading, button, input, select, picture, Button } = u;
  const d = s.draft;
  const requestSwitch = async action => {
    if (s.dirty) s.draftSwitch = action;
    else await action();
  };
  const resume = () => requestSwitch(async () => {
    s.drafts = await call($, s.context, "listDrafts");
  });
  const tools = row([
    button("new-draft", L(s, "新建表情", "New expression"), () => requestSwitch(() => newDraft($, s))),
    button("resume-drafts", L(s, "继续草稿", "Resume draft"), resume),
  ]);
  if (s.draftSwitch) return col([
    heading(L(s, "先保留当前修改", "Keep your changes")),
    t(L(s, "这份草稿有未保存的修改。", "This draft has unsaved changes.")),
    button("switch-save", L(s, "保存并继续", "Save and continue"), async () => {
      await save($, s); const action = s.draftSwitch; s.draftSwitch = null; await action();
    }, true),
    button("switch-discard", L(s, "放弃未保存修改", "Discard unsaved changes"), async () => {
      const saved = await call($, s.context, "getDraft", { id: d.draft_id });
      const action = s.draftSwitch; s.draftSwitch = null; s.dirty = false;
      s.draft = saved; s.imagePath = ""; s.copyImageHash = null;
      s.intent = ""; s.suggestion = null; await action();
    }),
    button("switch-cancel", L(s, "继续编辑", "Keep editing"), async () => { s.draftSwitch = null; }),
  ]);
  if (!d) return col([
    tools, heading(L(s, "把想说的话，变成表情", "Turn what you mean into an expression")),
    t(L(s, "从一句想表达的话开始，再配上一张图。", "Start with what you want to say, then add an image."), true),
  ]);
  const field = (key, value) => edit(s, () => { d.fields[key] = value; });
  const semantic = (key, value) => edit(s, () => { d.fields.semantics[key] = value; });
  const meaning = d.fields.name.trim() || d.fields.semantics.meaning.trim();
  const summary = fields => col([
    heading(fields.name || L(s, "未命名表情", "Untitled expression")),
    t(fields.semantics.meaning),
    fields.semantics.fallback && t(L(s, "图片无法显示时：", "Text fallback: ") + fields.semantics.fallback, true),
  ]);
  const artwork = col([
    d.preview ? picture(d.preview, d.fields.name) : Box({ width: 14, height: 6,
      borderStyle: "round", borderColor: LINE, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center",
      children: [Text({ children: [L(s, "＋ 配一张图", "＋ Add artwork")], dimColor: true })] }),
    input("image-path", L(s, "表情图片", "Artwork"), s.imagePath,
      value => edit(s, () => { s.imagePath = value; }),
      L(s, "粘贴图片路径，也可以稍后添加", "Paste an image path, or add it later")),
    t(s.imagePath ? L(s, "保存时读取这张图片", "Image is loaded when you save") :
      d.visual || s.copyImageHash ? L(s, "已保留原图", "Original image kept") : "PNG / JPG / WebP / GIF\n≤ 10 MiB", true),
  ]);
  const composer = col([
    input("intent", L(s, "想表达什么？", "What do you want to express?"), s.intent,
      value => edit(s, () => { s.intent = value; }),
      L(s, "描述场景、意思和语气…", "Who is speaking to whom? Describe the moment, meaning and tone.")),
    select("suggestion-model", L(s, "模型", "Model"), s.model,
      [["current", L(s, "当前对话 · ", "Current chat · ") + s.currentModel],
        ...["haiku", "sonnet", "opus"].map(x => [x, x]), ["custom", L(s, "自定义模型…", "Custom model…")]],
      value => { edit(s, () => { s.model = value; }); invalidate($); }),
    s.model === "custom" && input("custom-model", L(s, "模型 ID", "Model ID"), s.customModel || "",
      value => edit(s, () => { s.customModel = value; })),
    s.generating
      ? Button({ key: "cancel-suggestion", label: L(s, "取消生成", "Cancel generation"),
          onPress: () => { s.suggestionAbort?.abort(); s.editEpoch++; invalidate($); } })
      : Button({ key: "suggest", label: L(s, "AI 生成文字建议", "Generate text with AI"), variant: "primary",
          onPress: () => suggest($, s) }),
    t(L(s, "仅用文字生成，按模型计费。", "Uses your description only. Your selected model’s pricing applies."), true),
  ]);
  const fields = s.manual ? col([
    input("field:name", L(s, "名称", "Name"), d.fields.name, value => field("name", value)),
    input("field:meaning", L(s, "固定含义", "Fixed meaning"), d.fields.semantics.meaning, value => semantic("meaning", value)),
    input("field:fallback", L(s, "文字回退", "Text fallback"), d.fields.semantics.fallback, value => semantic("fallback", value)),
    button("advanced", L(s, s.advanced ? "收起更多设置" : "更多设置：语气、场景与来源", s.advanced ? "Fewer settings" : "Tone, context and source"), async () => { s.advanced = !s.advanced; }),
    ...(s.advanced ? [
      input("field:locale", L(s, "语言", "Language"), d.fields.semantics.locale, value => semantic("locale", value)),
      input("field:tone", L(s, "语气", "Tone"), d.fields.semantics.tone || "", value => semantic("tone", value)),
      ...[["use", "use_when", "适用场景", "Use when"], ["avoid", "avoid_when", "避免场景", "Avoid when"]].map(([id, key, zh, en]) =>
        input("field:" + id, L(s, zh + "（分号分隔）", en + " (semicolon separated)"), (d.fields.semantics[key] || []).join("; "),
          value => semantic(key, value.split(/[;；]/).map(x => x.trim()).filter(Boolean)))),
      input("field:tags", L(s, "标签（分号分隔）", "Tags (semicolon separated)"), (d.fields.tags || []).join("; "),
        value => field("tags", value.split(/[;；]/).map(x => x.trim()).filter(Boolean))),
      ...[["license", "使用许可", "License"], ["creator", "作者", "Creator"], ["source", "来源", "Source"]].map(([key, zh, en]) =>
        input("field:" + key, L(s, zh, en), d.fields.rights[key] || "", value => edit(s, () => { d.fields.rights[key] = value; }))),
    ] : []),
  ]) : null;
  return col([
    tools,
    heading(L(s, "把想说的话，变成表情", "Turn what you mean into an expression")),
    // Native inputs need a full column in the dock. Expanded panes gain a
    // separate artwork column without forcing narrow controls to overflow.
    (e.props.bodyColumns || 48) >= 88
      ? Box({ flexDirection: "row", gap: 3, children: [Box({ width: 30, children: [artwork] }), Box({ width: 48, children: [composer] })] })
      : col([composer, artwork]),
    s.suggestion ? col([
      heading(L(s, "AI 建议", "AI suggestion")), summary(s.suggestion),
      row([
        button("apply-suggestion", L(s, "采用建议", "Use suggestion"), async () => {
          edit(s, () => { d.fields = { ...d.fields, ...s.suggestion }; });
          s.suggestion = null; s.manual = false;
        }, true),
        button("discard-suggestion", L(s, "放弃建议", "Discard suggestion"), async () => { s.suggestion = null; }),
      ]),
    ]) : col([
      meaning && col([t(L(s, "AI 会读到下面这段意思", "The meaning AI will read"), true), summary(d.fields)]),
      button("manual-edit", L(s, s.manual ? "收起编辑" : meaning ? "编辑语义与来源" : "不使用 AI，手动填写语义",
        s.manual ? "Collapse editor" : meaning ? "Edit meaning and source" : "Write meaning manually"), async () => { s.manual = !s.manual; }),
      fields,
      row([
        button("save-draft", L(s, "保存草稿", "Save draft"), () => save($, s)),
        button("preview-draft", L(s, "保存并预览", "Save and preview"), () => save($, s, true), true),
      ]),
    ]),
  ]);
}
