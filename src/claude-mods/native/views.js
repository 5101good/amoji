import { guidanceView } from './guidance.js';
import { publisherView, packView } from './publisher-view.js';
import { marketView } from './market-view.js';
import { creationView } from "./creation-view.js";
import { stickerPicture, stickerPixels } from "./raster-picture.js";
import { L, refOf, view, local, gloss, FAMILY_LABELS } from "./transport.js";
import { deliveryText } from "./message-view.js";
import { galleryLayout, galleryLabel, TILE_HEIGHT, PANE_MAX_COLUMNS } from "./gallery.js";
import { controls } from "./controls.js";
import { kit } from "./ui-kit.js";
import {
  perform,
  revise,
  navigate,
  load,
  send,
  changePreference,
  choosePack,
  edit,
  save,
  forkLocalDraft,
  suggest,
  call,
  invalidate,
} from "./controller.js";


export function pane($, e, s, makePicture) {
  const { Box, Text, Input, Select, Link } = $.ui.resolve(e);
  const Button = controls($, e, s);
  const sendEpoch = s.pictureEpoch;
  const bodyColumns = e.props.bodyColumns || 48;
  const textColumns = Math.min(84, bodyColumns);
  const ui = kit($, e, s, textColumns);
  const inner = textColumns - 4;
  const t = (value, dim = false) => dim ? ui.caption(value) : ui.body(value);
  const heading = (value) => ui.heading(value);
  const section = (label, children) => ui.card({ children: [ui.label(label, inner), ...children] });
  const row = (children) =>
    Box({
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 1,
      alignItems: "center",
      children: children.filter(Boolean),
    });
  const col = (children) =>
    Box({
      flexDirection: "column",
      width: "100%",
      minWidth: 0,
      gap: 1,
      children: children.filter(Boolean),
    });
  const button = (key, label, action, primary = false) =>
    Button({ key, label,
      ...(primary ? { variant: "primary" } : { plain: true }),
      dimColor: s.busy,
      onPress: () => perform($, s, action),
    });
  const input = (key, label, value, change, placeholder = "") =>
    Box({ flexDirection: "column", gap: 0, width: "100%", children: [
      ui.caption(label), Input({
      key,
      value,
      placeholder,
      onInput: (value) => {
        if (!s.busy) change(value);
      },
      onSubmit: (value) => {
        if (!s.busy) change(value);
      },
    })] });
  const select = (key, label, value, options, change) =>
    Box({ flexDirection: "column", gap: 0, width: "100%", children: [
      ui.caption(label),
      Select({
        key,
        value,
        options: options.map(([value, label]) => ({ value, label })),
        onSelect: change,
      }),
    ] });
  const picture = (preview, name) =>
    preview
      ? Box({
          width: 14,
          children: [
            stickerPicture($, e, s, { source: preview, alt: name, width: 12, height: 5, pixels: stickerPixels(12, 5), plate: true, interactive: false }),
          ],
        })
      : t(L(s, "预览不可用", "Preview unavailable"), true);
  // Picture beside its words; only a very narrow dock stacks them.
  const thumb = (preview, name, width = 12, height = 5) => preview
    ? Box({ width, flexShrink: 0, children: [stickerPicture($, e, s, { source: preview, alt: name, width, height,
        pixels: stickerPixels(width, height), plate: true, interactive: false })] })
    : Box({ width, height, flexShrink: 0, alignItems: "center", justifyContent: "center", children: [ui.mono("—")] });
  // Cells left for words beside a picture inside a card (outline and padding).
  const besideWidth = (width) => Math.max(12, Math.min(textColumns, bodyColumns) - width - 6);
  const showcase = (preview, name, children, width = 12, height = 5) => bodyColumns >= 36
    ? Box({ flexDirection: "row", gap: 2, alignItems: "center", width: "100%", children: [
        thumb(preview, name, width, height),
        Box({ flexDirection: "column", gap: 0, flexGrow: 1, minWidth: 0, children: children.filter(Boolean) }),
      ] })
    : col([thumb(preview, name, width, height), ...children]);
  const managerSections = [
    ["library", L(s, "表情库", "Library")],
    ["market", L(s, "市场", "Market")],
    ["guidance", L(s, "协作提示", "Guidance")],
    ["create", L(s, "创作", "Create")],
    ["publish", L(s, "投稿", "Publish")],
    ["settings", L(s, "偏好", "Preferences")],
    ["packs", L(s, "导入导出", "Import/export")],
  ];
  const activeSection = s.tab === "pack" ? "publish" : s.tab;
  const total = s.collection?.total;
  const tabs = s.tab === "picker"
    ? col([
        Box({ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 1, children: [
          ui.row([heading(L(s, "用表情表达", "Say it with an expression")), total > 0 && ui.pill(L(s, `${total} 个`, `${total}`))]),
          Button({ key: "tab:library", label: L(s, "管理", "Manage"), variant: "secondary",
            dimColor: s.busy, onPress: () => perform($, s, () => navigate($, s, "library")) }),
        ] }),
        ui.caption(L(s, "你看到图片，Claude 读到固定语义。", "You see the picture; Claude reads its fixed meaning.")),
      ])
    : col([
        Box({ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 1, children: [
          Button({ key: "tab:picker", label: L(s, "‹ 表情", "‹ Expressions"), plain: true, dimColor: true,
            onPress: () => perform($, s, () => navigate($, s, "picker")) }),
          ui.section(L(s, "AMOJI · 管理", "AMOJI · MANAGE")),
        ] }),
        Box({ flexDirection: "row", flexWrap: "wrap", gap: 1, children: managerSections.map(([tab, label]) =>
          Button({ key: "tab:" + tab, label, ...(activeSection === tab ? { variant: "primary" } : { plain: true, dimColor: true }),
            onPress: () => perform($, s, () => navigate($, s, tab)) })) }),
      ]);
  const refresh = button("refresh", L(s, "刷新", "Refresh"), async () => {
    s.collection = null;
    s.preferences = null;
    await load($, s);
  });
  const stack = (children) => Box({ flexDirection: "column", flexGrow: 1, minWidth: 0, children: children.filter(Boolean) });
  const kits = { besideWidth, Input, col, row, stack, t, heading, button, input, select, picture, thumb, showcase, Link, Button, ui, inner };
  let body;
  if (s.tab === "guidance") {
    body=guidanceView($,s,kits);
  } else if (s.tab === "pack" && s.packDraft) {
    body=packView($,s,kits);
  } else if (s.tab === "publish") {
    body=publisherView($,s,kits);
  } else if (s.tab === "market") {
    body=marketView($,s,kits);
  } else if (s.tab === "settings") {
    const p = s.preferences;
    body = p
      ? col([
          ui.caption(L(s, "偏好只影响显示和 AI 发送规则，不改变已发送的消息。", "Preferences change display and AI sending rules only, never messages already sent.")),
          section(L(s, "显示", "Display"), [select(
            "preference:display",
            L(s, "显示方式", "Display"),
            p.display,
            [["image", L(s, "显示图片", "Show images")], ["text", L(s, "只显示文字", "Text only")]],
            (value) => changePreference($, s, (q) => ({ ...q, display: value })),
          ),
          select(
            "preference:reduce-motion",
            L(s, "动态效果", "Motion"),
            p.reduce_motion,
            [["system", L(s, "跟随系统", "Follow system")], ["on", L(s, "减少动态效果", "Reduce motion")], ["off", L(s, "正常播放", "Play normally")]],
            (value) => changePreference($, s, (q) => ({ ...q, reduce_motion: value })),
          )]),
          section(L(s, "AI 的表达", "AI expression"), [select(
            "preference:ai-enabled",
            L(s, "AI 表情", "AI expressions"),
            String(p.ai_expressions.enabled),
            [["true", L(s, "开启", "Enabled")], ["false", L(s, "暂停", "Paused")]],
            (value) => changePreference($, s, (q) => ({ ...q, ai_expressions: { ...q.ai_expressions, enabled: value === "true" } })),
          ),
          select(
            "preference:max-per-window",
            L(s, "每次回答最多", "Per answer at most"),
            String(p.ai_expressions.max_per_window),
            ["0", "1", "2", "3"].map(n => [n, n]),
            (value) => changePreference($, s, (q) => ({ ...q, ai_expressions: { ...q.ai_expressions, max_per_window: Number(value) } })),
          ),
          ...Object.keys(FAMILY_LABELS).map(family => select(
            "preference:family:" + family,
            L(s, ...FAMILY_LABELS[family]),
            String(p.ai_expressions.families[family]),
            [["true", L(s, "可以发", "Allowed")], ["false", L(s, "不发", "Off")]],
            (value) => changePreference($, s, (q) => ({ ...q, ai_expressions: { ...q.ai_expressions, families: { ...q.ai_expressions.families, [family]: value === "true" } } })),
          ))]),
          ui.caption(L(s, "界面语言跟随 Claude Code 的 language 配置，支持中文和英文。", "Language follows Claude Code’s language setting (Chinese or English).")),
          section(L(s, "关于 Amoji", "About Amoji"), [
            ui.body(L(s, "人看图，AI 懂语义。", "Images for people. Meaning for AI."), inner),
            row([Link({ href: "https://github.com/5101good/amoji", children: [L(s, "GitHub 开源项目 ↗", "Open source on GitHub ↗")] }), refresh]),
          ]),
        ])
      : refresh;
  } else if (s.tab === "create") {
    const d = s.draft;
    if (s.draftConflict) {
      const latest = s.conflictLatest;
      body = col([
        t(L(s, "你的输入", "Your input")),
        t(view(s, d.fields).name),
        t(view(s, d.fields).meaning),
        s.imagePath && t(L(s, "新图片：", "New image: ") + s.imagePath, true),
        t(L(s, "另存会保留你的文字和图片。", "Save separately to keep your text and image."), true),
        t(L(s, "原草稿不会被覆盖。", "The original draft will not be overwritten."), true),
        button("conflict-fork", L(s, "另存我的草稿", "Save my draft separately"), () => forkLocalDraft($, s), true),
        button("conflict-latest", L(s, "查看最新草稿", "View latest draft"), async () => {
          s.conflictLatest = await call($, s.context, "getDraft", { id: d.draft_id });
        }),
        ...(latest ? [
          t(L(s, "已保存的最新内容", "Latest saved content")),
          latest.preview && picture(latest.preview, view(s, latest.fields).name),
          t(view(s, latest.fields).name),
          t(view(s, latest.fields).meaning),
          t(view(s, latest.fields).fallback, true),
          t(L(s, "许可：", "License: ") + latest.fields.rights.license, true),
          latest.confirmed
            ? t(L(s, "此草稿已确认。如需保留你的修改，请另存。", "This draft is already confirmed. Save separately to keep your changes."), true)
            : button("conflict-adopt", L(s, "采用最新，放弃本地修改", "Use latest and discard my edits"), async () => {
                s.draft = latest;
                s.imagePath = "";
                s.copyImageHash = null;
                s.draftConflict = false;
                s.conflictLatest = null;
                s.step = "idea";
                s.manual = false;
                s.dirty = false;
                s.preview = null;
                s.reviewed = false;
              }),
        ] : []),
      ]);
    } else if (s.drafts)
      body = col([
        t(L(s, "未完成的草稿", "Unfinished drafts")),
        ...s.drafts
          .map((draft) =>
            button(
              "draft:" + draft.draft_id,
              view(s, draft.fields).name || L(s, "未命名草稿", "Untitled draft"),
              async () => {
                s.draft = await call($, s.context, "getDraft", {
                  id: draft.draft_id,
                });
                s.drafts = null;
                s.step = "idea";
                s.manual = false;
                s.dirty = false;
                s.preview = null;
                s.imagePath = "";
                s.copyImageHash = null;
                s.draftConflict = false;
                s.conflictLatest = null;
              },
            ),
          ),
        button("draft-back", L(s, "返回", "Back"), async () => {
          s.drafts = null;
        }),
      ]);
    else if (!d) body = creationView($, e, s, { col, row, t, heading, button, input, select, picture, Button });
    else if (s.step === "review" && s.preview)
      body = col([
        heading(L(s, "最后核对一次", "One last check")),
        ui.caption(L(s, "确认后，图片与语义将固定为一个版本。", "Confirming fixes this image and meaning as one version.")),
        showcase(s.preview.preview, view(s, d.fields).name, [
          ui.label(view(s, d.fields).name),
          ui.body(view(s, d.fields).meaning),
        ]),
        ui.spec([
          [L(s, "码位", "ACT"), gloss(s, d.fields.realizes, d.fields.directions?.[0]) + " · " + d.fields.realizes + " · " + d.fields.intensity],
          [L(s, "文字回退", "FALLBACK"), view(s, d.fields).fallback],
          [L(s, "适合", "USE WHEN"), view(s, d.fields).use_when.join(" · ")],
          [L(s, "避免", "AVOID"), view(s, d.fields).avoid_when.join(" · ")],
          [L(s, "语言", "LANGUAGES"), Object.keys(d.fields.semantics).join(" · ")],
          [L(s, "许可", "LICENSE"), d.fields.rights.license],
        ]),
        s.preview.visual?.animated &&
          t(
            L(
              s,
              "动态素材在 Claude 中显示静态封面。",
              "Animated assets display their static cover in Claude.",
            ),
            true,
          ),
        s.preview.preview
          ? button(
              "reviewed",
              (s.reviewed ? "☑ " : "☐ ") +
                L(
                  s,
                  "我已核对图片和固定语义",
                  "I reviewed the image and fixed meaning",
                ),
              async () => {
                s.reviewed = !s.reviewed;
              },
            )
          : t(
              L(
                s,
                "图片预览失败，暂不能确认。",
                "Preview failed; confirmation is unavailable.",
              ),
            ),
        row([
          button(
            "edit-again",
            L(s, "返回编辑", "Back to editing"),
            async () => {
              s.step = "edit";
              s.reviewed = false;
            },
          ),
          s.reviewed &&
            s.preview.preview &&
            button(
              "confirm",
              L(s, "确认创建", "Confirm expression"),
              async () => {
                await call($, s.context, "confirmDraft", {
                  id: d.draft_id,
                  version: d.version,
                  reviewed: true,
                });
                s.draft = null;
                s.preview = null;
                s.step = "idea";
                s.intent = "";
                s.suggestion = null;
                await navigate($, s, "library");
                s.notice = L(
                  s,
                  "表情已加入个人库",
                  "Expression added to your library",
                );
              },
              true,
            ),
        ]),
      ]);
    else body = creationView($, e, s, { col, row, t, heading, button, input, select, picture, Button });
  } else if (s.transfer) {
    const count = Object.keys(s.selected).length;
    body = col([
      heading(
        s.transfer === "import"
          ? L(s, "导入 .amoji 表情包", "Import an .amoji pack")
          : L(s, `导出已选的 ${count} 个表情`, `Export ${count} selected expressions`),
      ),
      input(
        "pack-path",
        L(s, "文件路径", "File path"),
        s.path,
        (value) => {
          s.path = value;
        },
        L(
          s,
          "绝对路径，例如 ~/Downloads/team.amoji",
          "Absolute path, e.g. ~/Downloads/team.amoji",
        ),
      ),
      ui.caption(
        L(
          s,
          "仅在你点击下方按钮时读写这个文件；导出不会覆盖已有文件。",
          "The file is accessed only when you press below. Export never overwrites a file.",
        ),
      ),
      row([
        button(
          "transfer-confirm",
          s.transfer === "import"
            ? L(s, "导入", "Import")
            : L(s, "导出", "Export"),
          async () => {
            if (s.transfer === "import") {
              const result = await call($, s.context, "importPack", {
                path: s.path,
              });
              s.notice = L(
                s,
                `已导入 ${result.added} 个新版本`,
                `Imported ${result.added} new revisions`,
              );
            } else {
              await call($, s.context, "exportPack", {
                path: s.path,
                refs: Object.values(s.selected),
              });
              s.notice = L(s, "已导出", "Exported");
            }
            s.transfer = null;
            s.collection = null;
            await load($, s);
          },
          true,
        ),
        button("transfer-back", L(s, "返回", "Back"), async () => {
          s.transfer = null;
        }),
      ]),
    ]);
  } else if (s.tab === "packs") {
    body = col([
      ui.caption(L(s, ".amoji 文件包含图片和固定语义，可以在支持 Amoji 的客户端之间使用。", ".amoji packs contain images and fixed meanings, ready for any Amoji client.")),
      ui.card({ children: [
        ui.label(L(s, "导入表情包", "Import a pack"), inner),
        ui.caption(L(s, "把朋友或团队分享的 .amoji 文件加入你的表情库。", "Add an .amoji file from a friend or team to your library."), inner),
        button("import", L(s, "选择文件路径…", "Choose a file path…"), async () => { s.transfer = "import"; s.path = ""; }, true),
      ] }),
      ui.card({ children: [
        ui.label(L(s, "导出表情", "Export expressions"), inner),
        ui.caption(L(s, "在表情库中勾选表情，打包成一个 .amoji 文件。", "Pick expressions in your library and save them as one .amoji file."), inner),
        button("choose-export", L(s, "选择表情并导出", "Choose expressions to export"), async () => {
          await navigate($, s, "library"); s.selecting = true; s.selected = {};
        }),
      ] }),
    ]);
  } else if (s.detail) {
    const item = s.detail;
    const x = item.expression;
    const v = view(s, x);
    const list = (values) => (values || []).join(" · ");
    body = col([
      button("detail-back", L(s, "‹ 返回列表", "‹ Back to list"), async () => {
        s.detail = null;
      }),
      showcase(item.preview, v.name, [
        heading(v.name),
        ui.body(v.meaning, besideWidth(14)),
        ui.row([
          item.archived && ui.badge("warning", L(s, "已归档", "Archived")),
          ui.badge("info", item.origin === "local" ? L(s, "我的创作", "Created by you") :
            item.origin === "builtin" ? L(s, "内置", "Built in") : item.origin === "market" ? L(s, "来自市场", "From the market") : L(s, "已导入", "Imported")),
        ]),
      ], 14, 6),
      row([
        !item.archived &&
          Button({
            key: "detail-send",
            label: L(s, "发送", "Send"),
            variant: "primary",
            onPress: () => send($, s, x, sendEpoch),
          }),
        button(
          "revise",
          L(
            s,
            item.origin === "local" ? "创建新版本" : "复制后编辑",
            item.origin === "local" ? "Create a revision" : "Copy and edit",
          ),
          () => revise($, s, item),
        ),
        button("detail-guidance",L(s,"协作提示","Guidance"),async()=>{s.guidanceExpression=x;await navigate($,s,"guidance");}),
        button("versions", L(s, s.revisions ? "刷新版本" : "查看版本", s.revisions ? "Refresh revisions" : "Show revisions"), async () => {
          s.revisions = await call($, s.context, "revisions", {
            assetId: x.asset_id,
          });
        }),
        button(
          "archive",
          L(
            s,
            item.archived ? "恢复" : "归档",
            item.archived ? "Restore" : "Archive",
          ),
          async () => {
            await call($, s.context, "archive", {
              assetId: x.asset_id,
              version: item.version,
              archived: !item.archived,
            });
            s.detail = null;
            s.collection = null;
            await load($, s);
          },
        ),
      ]),
      ui.section(L(s, "CLAUDE 读到的语义", "WHAT CLAUDE READS")),
      ui.spec([
        [L(s, "码位", "ACT"), gloss(s, x.realizes, x.directions?.[0]) + " · " + x.realizes + " · " + x.intensity],
        [L(s, "文字回退", "FALLBACK"), v.fallback],
        [L(s, "适合", "USE WHEN"), list(v.use_when)],
        [L(s, "避免", "AVOID"), list(v.avoid_when)],
        [L(s, "语言", "LANGUAGES"), list(Object.keys(x.semantics))],
        [L(s, "许可", "LICENSE"), x.rights.license],
      ]),
      s.revisions && ui.card({ gap: 0, children: [
        ui.label(L(s, "版本记录", "Revisions"), inner),
        ...s.revisions.map((revision) => ui.meta([
          revision.created_at.slice(0, 10),
          view(s, revision).name,
          revision.revision_id === x.revision_id ? L(s, "当前使用", "In use") : "",
        ], inner)),
      ] }),
      s.revisions?.length > 1 &&
        item.origin !== "local" &&
        select(
          "choose-revision",
          L(s, "用于新消息的版本", "Version for new messages"),
          x.revision_id,
          s.revisions.map((r) => [
            r.revision_id,
            view(s, r).name + " · " + r.created_at.slice(0, 10),
          ]),
          (value) =>
            perform($, s, async () => {
              await call($, s.context, "selectRevision", {
                ref: { asset_id: x.asset_id, revision_id: value },
                version: item.version,
              });
              s.detail = null;
              s.collection = null;
              s.revisions = null;
              await load($, s);
            }),
        ),
    ]);
  } else {
    const collection = s.collection;
    const geometry = galleryLayout(e);
    const cards = (collection?.items || []).map((item) => {
      const x = item.expression;
      const name = view(s, x).name;
      // Desktop currently draws Button.label even when Text children exist.
      // Keep captions bounded here; the image alt and detail retain full names.
      const caption = (value) => galleryLabel(value, geometry.tileWidth);
      const chosen = s.tab === "library" && s.selecting && !!s.selected[x.asset_id];
      // Host-specific media stays in the presentation adapter.
      const visual = makePicture
        ? makePicture(item)
        : picture(item.preview, name);
      return Box({
        key: "card:" + x.asset_id,
        width: geometry.tileWidth,
        height: TILE_HEIGHT,
        position: "relative",
        alignItems: "center",
        flexDirection: "column",
        gap: 0,
        children: [
          visual,
          s.tab === "picker"
            ? Box({ key: "send-focus:" + x.asset_id, height: 2, children: [Button({
                key: "send:" + x.asset_id, label: caption(name), plain: true, dimColor: true,
                hover: { color: "claude" },
                onPress: () => send($, s, x, sendEpoch),
              })] })
            : s.tab === "library" && s.selecting
              ? Button({ key: "select:" + x.asset_id, label: caption((chosen ? "✓ " : "") + name), plain: true,
                  ...(chosen ? { hover: { color: "claude" } } : { dimColor: true, hover: { color: "claude" } }),
                  onPress: () => perform($, s, async () => {
                  if (s.selected[x.asset_id]) delete s.selected[x.asset_id];
                  else s.selected[x.asset_id] = refOf(x);
                }) })
              : Button({ key: "details:" + x.asset_id, label: caption(name), plain: true, dimColor: !!item.archived,
                  hover: { color: "claude" },
                  onPress: () => perform($, s, async () => {
                s.detail = item;
                s.revisions = null;
              }) }),

        ],
      });
    });
    const selectedCount = Object.keys(s.selected).length;
    const preferred = s.preferences?.preferred_packs ?? [];
    const rank = (p) => { const i = preferred.indexOf(p.pack_id); return i < 0 ? preferred.length : i; };
    const chip = (key, label, active, action) => Button({ key, label,
      ...(active ? { variant: "primary" } : { plain: true, dimColor: true }),
      onPress: action });
    body = col([
      s.tab === "picker" && Input({
        key: "note",
        placeholder: L(s, "附一句话（可选），例如：第 3 步没看懂", "Add a note (optional), e.g. I don't follow step 3"),
        value: s.note || "",
        onInput: (value) => { s.note = value.slice(0, 140); },
        onSubmit: (value) => { s.note = value.slice(0, 140); },
      }),
      Input({
        key: "search",
        placeholder: s.tab === "picker" ? L(s, "想表达什么？搜索心情或场景", "What do you want to say? Search a mood or moment") :
          L(s, "搜索你的表情库", "Search your library"),
        submitLabel: L(s, "搜索", "Search"),
        value: s.query,
        onInput: (value) => {
          s.query = value;
        },
        onSubmit: (value) =>
          perform($, s, async () => {
            s.query = value;
            s.category = "all";
            s.page = 0;
            s.collection = null;
            await load($, s);
          }),
      }),
      s.tab === "picker" && (collection?.packs?.length ?? 0) > 1 && row([
        ...[...collection.packs].sort((a, b) => rank(a) - rank(b)).map(p =>
          button("pack:" + p.pack_id, local(s, p.name, p.original_locale), () => choosePack($, s, p.pack_id), collection.pack === p.pack_id)),
        button("pack:all", L(s, "全部表情包", "All packs"), () => choosePack($, s, "all"), collection.pack === "all"),
      ]),
      s.tab === "picker"
        ? row(["all", ...(collection?.categories || [])].map(category =>
            button("category:" + category, category === "all" ? L(s, "全部", "All") : L(s, ...FAMILY_LABELS[category]), async () => {
              s.category = category; s.collection = null; await load($, s);
            }, (s.category || "all") === category)))
        : col([
            row([
              chip("select-mode", L(s, s.selecting ? "完成选择" : "选择", s.selecting ? "Done" : "Select"), s.selecting, () => perform($, s, async () => {
                s.selecting = !s.selecting;
                s.pictureEpoch = (s.pictureEpoch || 0) + 1;
                if (!s.selecting) s.selected = {};
              })),
              chip("archived", L(s, s.archived ? "查看使用中" : "查看已归档", s.archived ? "Show active" : "Show archived"), false, () => perform($, s, async () => {
                s.archived = !s.archived;
                s.page = 0;
                s.collection = null;
                await load($, s);
              })),
              !s.selecting && button("library-create", L(s, "＋ 创建表情", "＋ Create"), () => navigate($, s, "create")),
            ]),
            s.selecting && ui.card({ selected: selectedCount > 0, children: [
              ui.label(selectedCount ? L(s, `已选 ${selectedCount} 个表情`, `${selectedCount} selected`) :
                L(s, "点击表情加入选择", "Click expressions to select them"), inner),
              selectedCount > 0 && row([
                button("create-pack", L(s,"组织为表情包","Create a pack"), async()=>{
                  s.packDraft=await call($,s.context,"packs",{method:"create",refs:Object.values(s.selected)});
                  s.packPreview=false;s.packReviewed=false;s.publicationFields=null;
                  await navigate($,s,"pack");
                }, true),
                button(
                  "export",
                  L(s, `导出 (${selectedCount})`, `Export (${selectedCount})`),
                  async () => {
                    s.transfer = "export";
                    s.path = "";
                  },
                ),
              ]),
            ] }),
          ]),
      cards.length
        ? Box({ flexDirection: "column", children: [
            (collection.offset || 0) > 0 && Box({ height: Math.floor(collection.offset / geometry.columns) * TILE_HEIGHT, children: [] }),
            Box({ flexDirection: "row", flexWrap: "wrap", columnGap: 1, rowGap: 0, children: cards }),
            Box({ height: Math.max(0, Math.ceil(collection.total / geometry.columns) -
              Math.ceil(((collection.offset || 0) + cards.length) / geometry.columns)) * TILE_HEIGHT, children: [] }),
          ].filter(Boolean) })
        : s.busy ? ui.status("busy", L(s, "正在查找表情…", "Finding expressions…"))
        : s.error ? refresh
        : ui.card({ children: [
            ui.label(s.query ? L(s, `没有找到「${s.query}」`, `Nothing found for “${s.query}”`) :
              s.archived ? L(s, "没有已归档的表情", "No archived expressions") : L(s, "这里还没有表情", "No expressions yet"), inner),
            ui.caption(L(s, "换个关键词，或者把想说的话做成自己的表情。", "Try another word, or turn what you mean into your own expression."), inner),
            row([
              s.query && button("clear-search", L(s, "显示全部", "Show all"), async () => {
                s.query = "";
                s.page = 0;
                s.collection = null;
                await load($, s);
              }),
              button("empty-create", L(s, "创建表情", "Create expression"), () => navigate($, s, "create"), !s.query),
            ]),
          ] }),
      cards.length > 0 && ui.mono(s.tab === "picker"
        ? L(s, `${collection?.total || 0} 个表情 · 点击即发送`, `${collection?.total || 0} EXPRESSIONS · CLICK TO SEND`)
        : L(s, `${collection?.total || 0} 个表情 · 点击查看详情`, `${collection?.total || 0} EXPRESSIONS · CLICK FOR DETAILS`)),
      s.tab === "picker" && s.pictureFault && button("retry-pictures", L(s, "恢复图片点击", "Restore image clicks"), async () => {
        s.pictureFault = false; s.pictureEpoch = (s.pictureEpoch || 0) + 1;
      }),
    ]);
  }
  const delivery = s.delivery;
  const content = col([
    !s.error && delivery && ui.status(delivery.phase === "waiting" ? "success" : delivery.phase === "error" ? "error" : "busy", deliveryText(s)),
    !s.error && !delivery && s.busy && s.tab !== "picker" && s.tab !== "library" && ui.status("busy", L(s, "处理中…", "Working…")),
    s.error && ui.status("error", s.error),
    s.notice && ui.status("success", s.notice),
    body,
  ]);
  return Box({ width: "100%", alignItems: "center", flexDirection: "column", children: [
    Box({ width: Math.min(s.tab === "picker" || s.tab === "library" ? PANE_MAX_COLUMNS : 84, bodyColumns),
      minWidth: 0, flexDirection: "column", gap: 1, children: [tabs, content] }),
  ] });
}
