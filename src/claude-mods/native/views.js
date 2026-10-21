import { guidanceView } from './guidance.js';
import { publisherView, scenarioView } from './publisher-view.js';
import { marketView } from './market-view.js';
import { wrapText } from "./text-layout.js";
import { creationView } from "./creation-view.js";
import { rasterPicture } from "./raster-picture.js";
import { L, refOf } from "./transport.js";
import { deliveryText } from "./message-view.js";
import { galleryLayout, galleryLabel, TILE_HEIGHT, PANE_MAX_COLUMNS } from "./gallery.js";
import { controls } from "./controls.js";
import {
  perform,
  revise,
  navigate,
  load,
  send,
  changePreference,
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
  const textColumns = Math.min(80, bodyColumns >= 96 && s.tab !== "picker" ? bodyColumns - 23 : bodyColumns);
  const t = (value, dim = false) =>
    Text({ children: [wrapText(value, textColumns)], wrap: "wrap", ...(dim ? { dimColor: true } : {}) });
  const heading = (value) => Text({ children: [wrapText(value, textColumns)], bold: true, wrap: "wrap" });
  const section = (label, children) => Box({ flexDirection: "column", gap: 1,
    marginTop: 1, children: [heading(label), ...children.filter(Boolean)] });
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
      t(label, true), Input({
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
    col([
      t(label, true),
      Select({
        key,
        value,
        options: options.map(([value, label]) => ({ value, label })),
        onSelect: change,
      }),
    ]);
  const picture = (preview, name) =>
    preview
      ? Box({
          width: 14,
          children: [
            rasterPicture($, e, s, { key: "preview:" + name, source: preview, alt: name }),
          ],
        })
      : t(L(s, "预览不可用", "Preview unavailable"), true);
  const managerSections = [
    ["library", L(s, "表情库", "Library")],
    ["market", L(s, "表情市场", "Expression market")],
    ["publish", L(s, "分享与投稿", "Share and publish")],
    ["guidance", L(s, "协作提示", "Collaboration guidance")],
    ["create", L(s, "创作与草稿", "Create and drafts")],
    ["settings", L(s, "AI 偏好", "AI preferences")],
    ["packs", L(s, "导入与导出", "Import and export")],
  ];
  const wideManager = s.tab !== "picker" && (e.props.bodyColumns || 48) >= 96;
  const tabs = s.tab === "picker"
    ? Box({ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1, children: [heading(L(s, "用表情表达", "Say it with an expression")),
        button("tab:library", L(s, "管理表情", "Manage expressions"), () => navigate($, s, "library"))] })
    : col([
        row([button("tab:picker", L(s, "‹ 返回表情", "‹ Back to expressions"), () => navigate($, s, "picker")), heading(L(s, "管理表情", "Manage expressions"))]),
        !wideManager && Select({ key: "manager-section", value: s.tab,
          options: managerSections.map(([value, label]) => ({value, label})),
          onSelect: value => perform($, s, () => navigate($, s, value)) }),
      ]);
  const refresh = button("refresh", L(s, "刷新", "Refresh"), async () => {
    s.collection = null;
    s.preferences = null;
    await load($, s);
  });
  let body;
  if (s.tab === "guidance") {
    body=guidanceView($,s,{col,row,t,heading,button,Button});
  } else if (s.tab === "scenario" && s.scenarioDraft) {
    body=scenarioView($,s,{col,row,t,heading,button,input,select,picture,Link,Button});
  } else if (s.tab === "publish") {
    body=publisherView($,s,{col,row,t,heading,button,input,select,picture,Link,Button});
  } else if (s.tab === "market") {
    body=marketView($,s,{col,row,t,heading,button,input,select,picture,Link,Button});
  } else if (s.tab === "settings") {
    const p = s.preferences;
    body = p
      ? col([
          heading(L(s, "让表达更像你", "Make it feel like you")),
          t(L(s, "选择你看到的画风，以及 AI 回应你的方式。", "Choose the artwork you see and how AI responds."), true),
          section(L(s, "外观", "Appearance"), [select(
            "preference:appearance",
            L(s, "表情画风", "Appearance"),
            p.appearance,
            [
              [
                "classic",
                L(s, "经典 · 温暖手绘", "Classic · warm illustrations"),
              ],
              ["office", L(s, "办公 · 简洁克制", "Office · clear and calm")],
            ],
            (value) => changePreference($, s, "appearance", value),
          )]),
          section(L(s, "AI 的表达", "AI expression"), [select(
            "preference:style",
            L(s, "AI 语气偏好", "AI tone"),
            p.style,
            [
              ["neutral", L(s, "自然", "Natural")],
              ["warm", L(s, "温暖", "Warm")],
              ["playful", L(s, "活泼", "Playful")],
            ],
            (value) => changePreference($, s, "style", value),
          ),
          select(
            "preference:frequency",
            L(s, "AI 使用频率", "AI frequency"),
            p.frequency,
            [
              ["restrained", L(s, "克制", "Restrained")],
              ["moderate", L(s, "适中", "Moderate")],
              ["active", L(s, "活跃", "Active")],
            ],
            (value) => changePreference($, s, "frequency", value),
          ),
          select(
            "preference:paused",
            L(s, "AI 表情", "AI expressions"),
            String(p.paused),
            [
              ["false", L(s, "开启", "Enabled")],
              ["true", L(s, "暂停", "Paused")],
            ],
            (value) => changePreference($, s, "paused", value === "true"),
          )]),
          t(
            L(
              s,
              "语言跟随 Claude Code 的 language 配置，支持中文和英文。",
              "Language follows Claude Code’s language setting (Chinese or English).",
            ),
            true,
          ),
          section(L(s, "关于 Amoji", "About Amoji"), [
            t(L(s, "人看图，AI 懂语义。", "Images for people. Meaning for AI.")),
            Link({ href: "https://github.com/5101good/amoji", children: [L(s, "GitHub 开源项目", "Open source on GitHub")] }),
            refresh,
          ]),
        ])
      : refresh;
  } else if (s.tab === "create") {
    const d = s.draft;
    const editField = (key, value) =>
      edit(s, () => {
        d.fields[key] = value;
      });
    const semantic = (key, value) =>
      edit(s, () => {
        d.fields.semantics[key] = value;
      });
    if (s.draftConflict) {
      const latest = s.conflictLatest;
      body = col([
        t(L(s, "你的输入", "Your input")),
        t(d.fields.name),
        t(d.fields.semantics.meaning),
        s.imagePath && t(L(s, "新图片：", "New image: ") + s.imagePath, true),
        t(L(s, "另存会保留你的文字和图片。", "Save separately to keep your text and image."), true),
        t(L(s, "原草稿不会被覆盖。", "The original draft will not be overwritten."), true),
        button("conflict-fork", L(s, "另存我的草稿", "Save my draft separately"), () => forkLocalDraft($, s), true),
        button("conflict-latest", L(s, "查看最新草稿", "View latest draft"), async () => {
          s.conflictLatest = await call($, s.context, "getDraft", { id: d.draft_id });
        }),
        ...(latest ? [
          t(L(s, "已保存的最新内容", "Latest saved content")),
          latest.preview && picture(latest.preview, latest.fields.name),
          t(latest.fields.name),
          t(latest.fields.semantics.meaning),
          t(latest.fields.semantics.fallback, true),
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
              draft.fields.name || L(s, "未命名草稿", "Untitled draft"),
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
        t(
          L(
            s,
            "确认后，图片与语义将固定为一个版本。",
            "Confirming fixes this image and meaning as one version.",
          ),
        ),
        picture(s.preview.preview, d.fields.name),
        t(d.fields.name),
        t(d.fields.semantics.meaning),
        t(d.fields.semantics.fallback, true),
        d.fields.semantics.tone &&
          t(L(s, "语气：", "Tone: ") + d.fields.semantics.tone, true),
        t(
          L(s, "适用：", "Use when: ") +
            (d.fields.semantics.use_when || []).join(" / "),
          true,
        ),
        t(
          L(s, "避免：", "Avoid when: ") +
            (d.fields.semantics.avoid_when || []).join(" / "),
          true,
        ),
        t(L(s, "许可：", "License: ") + d.fields.rights.license, true),
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
    body = col([
      t(
        s.transfer === "import"
          ? L(s, "导入 .amoji 表情包", "Import an .amoji pack")
          : L(
              s,
              `导出已选的 ${Object.keys(s.selected).length} 个表情`,
              `Export ${Object.keys(s.selected).length} selected expressions`,
            ),
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
      t(
        L(
          s,
          "仅在你点击下方按钮时读写这个文件；导出不会覆盖已有文件。",
          "The file is accessed only when you press below. Export never overwrites a file.",
        ),
        true,
      ),
      row([
        button("transfer-back", L(s, "返回", "Back"), async () => {
          s.transfer = null;
        }),
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
      ]),
    ]);
  } else if (s.tab === "packs") {
    body = col([
      heading(L(s, "分享你的表达", "Share your expressions")),
      t(L(s, ".amoji 文件包含图片和固定语义，可以在支持 Amoji 的客户端之间使用。", ".amoji packs contain images and fixed meanings, ready for any Amoji client."), true),
      button("import", L(s, "导入表情包", "Import a pack"), async () => { s.transfer = "import"; s.path = ""; }, true),
      button("choose-export", L(s, "选择表情并导出", "Choose expressions to export"), async () => {
        await navigate($, s, "library"); s.selecting = true; s.selected = {};
      }),
    ]);
  } else if (s.detail) {
    const item = s.detail;
    const x = item.expression;
    body = col([
      button("detail-back", L(s, "返回列表", "Back to list"), async () => {
        s.detail = null;
      }),
      picture(item.preview, x.name),
      t(x.name),
      t(x.semantics.meaning),
      t(x.semantics.fallback, true),
      x.semantics.tone && t(x.semantics.tone, true),
      t(
        L(s, "适用：", "Use when: ") + (x.semantics.use_when || []).join(" / "),
        true,
      ),
      t(
        L(s, "避免：", "Avoid when: ") +
          (x.semantics.avoid_when || []).join(" / "),
        true,
      ),
      t(L(s, "许可：", "License: ") + x.rights.license, true),
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
      button("detail-guidance",L(s,"查看可选协作提示","Optional collaboration guidance"),async()=>{s.guidanceExpression=x;await navigate($,s,"guidance");}),
      button("versions", L(s, "查看版本", "Show revisions"), async () => {
        s.revisions = await call($, s.context, "revisions", {
          assetId: x.asset_id,
        });
      }),
      ...(s.revisions || []).map((revision) =>
        t(
          `${revision.created_at.slice(0, 10)} · ${revision.revision_id.slice(0, 8)} · ${revision.name}${revision.revision_id === x.revision_id ? " ✓" : ""}`,
          true,
        ),
      ),
      s.revisions?.length > 1 &&
        item.origin !== "local" &&
        select(
          "choose-revision",
          L(s, "用于新消息的版本", "Version for new messages"),
          x.revision_id,
          s.revisions.map((r) => [
            r.revision_id,
            r.name + " · " + r.revision_id.slice(0, 8),
          ]),
          (value) =>
            perform($, s, async () => {
              const updated = await call($, s.context, "selectRevision", {
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
      // Desktop currently draws Button.label even when Text children exist.
      // Keep captions bounded here; the image alt and detail retain full names.
      const caption = (value) => galleryLabel(value, geometry.tileWidth);
      // Host-specific media stays in the presentation adapter.
      const visual = makePicture
        ? makePicture(item)
        : picture(item.preview, x.name);
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
                key: "send:" + x.asset_id, label: caption(x.name), plain: true, dimColor: true,
                onPress: () => send($, s, x, sendEpoch),
              })] })
            : s.tab === "library" && s.selecting
              ? Button({ key: "select:" + x.asset_id, label: caption((s.selected[x.asset_id] ? "☑ " : "☐ ") + x.name), plain: true,
                  onPress: () => perform($, s, async () => {
                  if (s.selected[x.asset_id]) delete s.selected[x.asset_id];
                  else s.selected[x.asset_id] = refOf(x);
                }) })
              : Button({ key: "details:" + x.asset_id, label: caption(x.name), plain: true,
                  onPress: () => perform($, s, async () => {
                s.detail = item;
                s.revisions = null;
              }) }),

        ],
      });
    });
    body = col([
      s.tab === "picker" && row([
        t(L(s, "画风", "Artwork"), true),
        ...[["classic", "经典", "Classic"], ["office", "办公", "Office"]].map(([value, zh, en]) =>
          Button({ key: "appearance:" + value, label: L(s, zh, en),
            ...(s.preferences?.appearance === value ? { variant: "primary" } : { plain: true, dimColor: true }),
            onPress: () => changePreference($, s, "appearance", value) })),
      ]),
      Input({
        key: "search",
        placeholder: L(s, "想表达什么？", "What do you want to express?"),
        submitLabel: L(s, "搜索", "Search"),
        value: s.query,
        onInput: (value) => {
          s.query = value;
        },
        onSubmit: (value) =>
          perform($, s, async () => {
            s.query = value;
            s.category = "全部";
            s.page = 0;
            s.collection = null;
            await load($, s);
          }),
      }),
      s.tab === "picker"
        ? row(["全部", ...(collection?.categories || [])].map(category =>
            button("category:" + category, L(s, category,
              ({"全部":"All", "进度":"Progress", "澄清":"Clarify", "方向":"Direction", "反馈":"Feedback", "其他":"Other"})[category]), async () => {
              s.category = category; s.collection = null; await load($, s);
            }, (s.category || "全部") === category)))
        : row([
            button("select-mode", L(s, s.selecting ? "取消选择" : "选择", s.selecting ? "Cancel selection" : "Select"), async () => {
              s.selecting = !s.selecting;
              s.pictureEpoch = (s.pictureEpoch || 0) + 1;
              if (!s.selecting) s.selected = {};
            }),
            button(
              "archived",
              L(
                s,
                s.archived ? "查看使用中" : "查看已归档",
                s.archived ? "Show active" : "Show archived",
              ),
              async () => {
                s.archived = !s.archived;
                s.page = 0;
                s.collection = null;
                await load($, s);
              },
            ),
            Object.keys(s.selected).length > 0 && button("create-pack", L(s,"组织为表情包","Create a pack"), async()=>{
              s.scenarioDraft=await call($,s.context,"scenario",{method:"create",refs:Object.values(s.selected)});
              s.scenarioPreview=false;s.scenarioReviewed=false;s.publicationFields=null;
              await navigate($,s,"scenario");
            }),
            Object.keys(s.selected).length > 0 &&
              button(
                "export",
                L(
                  s,
                  `导出 (${Object.keys(s.selected).length})`,
                  `Export (${Object.keys(s.selected).length})`,
                ),
                async () => {
                  s.transfer = "export";
                  s.path = "";
                },
              ),
          ]),
      cards.length
        ? Box({ flexDirection: "column", children: [
            (collection.offset || 0) > 0 && Box({ height: Math.floor(collection.offset / geometry.columns) * TILE_HEIGHT, children: [] }),
            Box({ flexDirection: "row", flexWrap: "wrap", columnGap: 1, rowGap: 0, children: cards }),
            Box({ height: Math.max(0, Math.ceil(collection.total / geometry.columns) -
              Math.ceil(((collection.offset || 0) + cards.length) / geometry.columns)) * TILE_HEIGHT, children: [] }),
          ].filter(Boolean) })
        : s.busy ? t(L(s, "正在查找表情…", "Finding expressions…"), true)
        : s.error ? refresh
        : col([
            t(L(s, "没有找到表情", "No expressions found")),
            t(L(s, "换个关键词，或创建自己的表情。", "Try another search or create your own."), true),
            row([
              s.query && button("clear-search", L(s, "显示全部", "Show all"), async () => {
                s.query = "";
                s.page = 0;
                s.collection = null;
                await load($, s);
              }),
              button("empty-create", L(s, "创建表情", "Create expression"), () => navigate($, s, "create")),
            ]),
          ]),
      s.tab === "picker" && t(L(s, `${collection?.total || 0} 个表情 · 点击即发送`, `${collection?.total || 0} expressions · Click to send`), true),
      s.tab === "picker" && s.pictureFault && button("retry-pictures", L(s, "恢复图片点击", "Restore image clicks"), async () => {
        s.pictureFault = false; s.pictureEpoch = (s.pictureEpoch || 0) + 1;
      }),
    ]);
  }
  const content = col([
    !s.error && (deliveryText(s) || s.busy) && t(deliveryText(s) || L(s, "处理中…", "Working…"), true),
    s.error && t(s.error), s.notice && t(s.notice), body,
  ]);
  const navigation = Box({ width: 20, flexDirection: "column", gap: 1,
    children: managerSections.map(([tab, label]) => button("tab:" + tab, label, () => navigate($, s, tab), s.tab === tab)) });
  return Box({ width: "100%", alignItems: "center", flexDirection: "column", children: [
    Box({ width: Math.min(wideManager ? 108 : s.tab === "picker" || s.tab === "library" ? PANE_MAX_COLUMNS : 84, e.props.bodyColumns || 48),
      minWidth: 0, flexDirection: "column", gap: 1, children: [
        tabs,
        wideManager ? Box({ flexDirection: "row", gap: 3, children: [navigation,
          Box({ width: Math.min(84, e.props.bodyColumns - 23), flexDirection: "column", children: [content] })] }) : content,
      ] }),
  ] });
}
