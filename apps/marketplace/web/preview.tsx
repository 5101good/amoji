import React, { useEffect, useState } from "react";
import { Modal } from "./ui";
export const previewWords = {
  zh: {
    title: "创作者工作台",
    steps: ["选择内容", "说明与许可", "可选动作", "预览投稿"],
    choose: "选择 .amoji 场景包",
    next: "下一步",
    back: "上一步",
    name: "包名称",
    description: "说明",
    license: "发布许可",
    creator: "创作者 / 署名",
    source: "来源",
    validate: "上传并验证所选内容",
    submit: "确认投稿，等待审核",
    confirm: "我已核对全部内容、许可和来源，确认拥有公开分发权。",
    pending: "待审",
    withdrawn: "已撤回",
    published: "已公开",
    changes_requested: "需修改",
    withdraw: "撤回投稿",
    refresh: "刷新状态",
    revision: "创建新修订",
    saved: "草稿已保存在此设备。重新打开页面可继续。",
    restore: "恢复上次上传与操作",
    list: "我的投稿",
    inspect: "查看精确投稿",
    empty: "还没有投稿。",
    ready: "完整校验通过。投稿后内容不可修改，修订会生成新版本。",
    rights:
      "仅支持 CC0-1.0、CC-BY-4.0、CC-BY-SA-4.0；每项均须填写创作者，衍生包须保留来源。不会自动改变导入内容的许可。修改表情或动作的署名/许可会创建新身份并保留来源。",
    actions:
      "可选择保留包内动作。动作是可选提示，不会因安装或发送表情而自动执行。",
    noActions: "这个包只有表情，没有协作动作。",
    example: "示例（不代表效果保证）",
    meaning: "固定语义",
    locale: "原始语义语言",
    full: "完整内容与元数据",
    new: "新建另一份草稿",
    busy: "处理中…",
    fileHint:
      "仅上传你选择的包。不会读取会话、模型密钥或本地表情整库。上限 10 MiB。",
    sourceHint: "导入后形成新的发布快照，保留原包版本作为衍生来源。",
    localPreview: "本地预览",
    verifiedPreview: "已验证的精确版本",
    allContent: "全部表达、素材、动作、示例、许可与来源",
    more: "加载更多",
    pack: "场景包",
    expression: "表情",
    action: "动作",
    turn: "本次请求",
    conversation: "当前会话",
    instruction: "协作提示",
    hook: "会话习惯",
  },
  en: {
    title: "Creator workspace",
    steps: [
      "Choose content",
      "Details and licenses",
      "Optional actions",
      "Preview and submit",
    ],
    choose: "Choose an .amoji scenario pack",
    next: "Next",
    back: "Back",
    name: "Pack name",
    description: "Description",
    license: "Publication license",
    creator: "Creator / attribution",
    source: "Source",
    validate: "Upload and validate selected content",
    submit: "Submit for review",
    confirm:
      "I checked all content, licenses and sources and confirm my right to distribute it publicly.",
    pending: "Pending",
    withdrawn: "Withdrawn",
    published: "Published",
    changes_requested: "Changes requested",
    withdraw: "Withdraw submission",
    refresh: "Refresh status",
    revision: "Create a revision",
    saved: "Draft saved on this device. Reopen this page to continue.",
    restore: "Reconcile last upload and operation",
    list: "My submissions",
    inspect: "Inspect exact submission",
    empty: "No submissions yet.",
    ready:
      "The complete archive passed validation. Submitted bytes are immutable; revisions create new versions.",
    rights:
      "Supported: CC0-1.0, CC-BY-4.0 and CC-BY-SA-4.0. Every item requires creator attribution; derivatives require provenance. Imported licenses are never changed automatically. Editing attribution/licenses creates new identities and preserves provenance.",
    actions:
      "Choose which included actions to keep. These are optional guidance, never activated by installation or expression sending.",
    noActions:
      "This pack contains expressions only, with no collaboration actions.",
    example: "Example (not a guarantee of results)",
    meaning: "Fixed semantics",
    locale: "Original semantic language",
    full: "Complete content and metadata",
    new: "Start another draft",
    busy: "Working…",
    fileHint:
      "Only the chosen pack is uploaded. No conversations, model keys or complete local library are accessed. Limit: 10 MiB.",
    sourceHint:
      "An import creates a new release snapshot and preserves the original pack version as its source.",
    localPreview: "Local preview",
    verifiedPreview: "Exact validated version",
    allContent:
      "All expressions, media, actions, examples, licenses and sources",
    more: "Load more",
    pack: "Scenario pack",
    expression: "Expression",
    action: "Action",
    turn: "This request",
    conversation: "This conversation",
    instruction: "Collaboration instruction",
    hook: "Conversation habit",
  },
};
export function Preview({
  manifest,
  hideHeading = false,
  uploadId,
  mediaBase,
  files,
  t,
}: {
  manifest: any;
  hideHeading?: boolean;
  uploadId?: string;
  mediaBase?: string;
  files: Record<string, Uint8Array>;
  t: typeof previewWords.zh | typeof previewWords.en;
}) {
  const zh = t.title === previewWords.zh.title;
  const appearances: string[] = [
    ...new Set<string>(
      manifest.expressions.flatMap((e: any) =>
        (e.tags ?? [])
          .filter((tag: string) => tag.startsWith("amoji:appearance:"))
          .map((tag: string) => tag.slice(17)),
      ),
    ),
  ];
  const [appearance, setAppearance] = useState(appearances[0] ?? "");
  const [zoom, setZoom] = useState<any>(null);
  const shown =
    hideHeading && appearance
      ? manifest.expressions.filter(
          (e: any) =>
            !e.tags?.some((tag: string) =>
              tag.startsWith("amoji:appearance:"),
            ) || e.tags.includes("amoji:appearance:" + appearance),
        )
      : manifest.expressions;
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (uploadId || mediaBase) {
      setUrls({});
      return;
    }
    const u: Record<string, string> = {};
    for (const e of manifest.expressions)
      for (const media of [e.visual.primary, e.visual.poster].filter(Boolean)) {
        const b = files["blobs/" + media.sha256];
        if (b)
          u[media.sha256] = URL.createObjectURL(
            new Blob([new Uint8Array(b)], { type: media.mime }),
          );
      }
    setUrls(u);
    return () => Object.values(u).forEach(URL.revokeObjectURL);
  }, [manifest, files, uploadId, mediaBase]);
  const mediaUrl = (m: any) =>
    mediaBase
      ? `${mediaBase}/media/${m.sha256}`
      : uploadId
        ? `/v1/uploads/${uploadId}/media/${m.sha256}`
        : urls[m.sha256];
  return (
    <section className="pack-preview" aria-label={t.allContent}>
      {!hideHeading && (
        <div className="preview-heading">
          <h3>{manifest.name}</h3>
          <p>{manifest.description}</p>
        </div>
      )}
      {hideHeading && (
        <div className="preview-toolbar">
          <h2>{zh ? "表情与含义" : "Expressions & meanings"}</h2>
          {appearances.length > 1 && (
            <div
              className="segmented"
              role="group"
              aria-label={zh ? "选择画风" : "Choose appearance"}
            >
              {["", ...appearances].map((style) => (
                <button
                  type="button"
                  key={style}
                  aria-pressed={appearance === style}
                  onClick={() => setAppearance(style)}
                >
                  {style === ""
                    ? zh
                      ? "全部"
                      : "All"
                    : style === "classic"
                      ? zh
                        ? "经典"
                        : "Classic"
                      : style === "office"
                        ? zh
                          ? "办公"
                          : "Office"
                        : style}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="expression-grid">
        {shown.map((e: any) => (
          <article key={e.asset_id + e.revision_id}>
            <div className="preview-media">
              <button
                className="image-preview-button"
                type="button"
                onClick={() => setZoom(e)}
                aria-label={(zh ? "放大查看：" : "View larger: ") + e.name}
              >
                <img
                  loading="lazy"
                  decoding="async"
                  src={mediaUrl(e.visual.primary)}
                  alt={e.semantics.fallback}
                />
              </button>
              {e.visual.poster && (
                <img
                  src={mediaUrl(e.visual.poster)}
                  alt={e.semantics.fallback + " (poster)"}
                />
              )}
            </div>
            <h4>{e.name}</h4>
            <p>
              {t.locale}:{" "}
              <span lang={e.semantics.locale}>{e.semantics.locale}</span>
            </p>
            <p lang={e.semantics.locale}>{e.semantics.meaning}</p>
            <details>
              <summary>{t.full}</summary>
              <pre>{JSON.stringify(e.semantics, null, 2)}</pre>
              <p>
                {e.rights.license} · {e.rights.creator}
              </p>
              <p>{e.rights.source}</p>
            </details>
          </article>
        ))}
      </div>
      {!!manifest.actions?.length && (
        <h2 className="preview-section-title">
          {zh ? "可选协作提示" : "Optional collaboration guidance"}
        </h2>
      )}
      {manifest.actions?.map((a: any) => (
        <article className="action-preview" key={a.action_id}>
          <h4>{a.name ?? a.effect_summary}</h4>
          <p>
            {a.kind === "instruction" ? t.instruction : t.hook} ·{" "}
            {a.scope === "turn" ? t.turn : t.conversation} · {a.locale}
          </p>
          {a.name && a.name !== a.effect_summary && <p>{a.effect_summary}</p>}
          {a.instruction ? (
            <p>{a.instruction}</p>
          ) : (
            <details>
              <summary>{t.full}</summary>
              <pre>
                {JSON.stringify(
                  { template: a.template, config: a.config },
                  null,
                  2,
                )}
              </pre>
            </details>
          )}
          <details>
            <summary>{zh ? "许可与来源" : "License & attribution"}</summary>
            <p>
              {a.rights.license} · {a.rights.creator}
            </p>
            <p>{a.rights.source}</p>
          </details>
        </article>
      ))}
      {manifest.examples?.map((e: any, i: number) => (
        <article className="example-preview" key={i}>
          <h4>{t.example}</h4>
          <p>{typeof e === "string" ? e : JSON.stringify(e)}</p>
        </article>
      ))}
      <p>
        {manifest.rights.license} · {manifest.rights.creator}
      </p>
      <p>{manifest.rights.source}</p>
      {manifest.derived_from && (
        <details>
          <summary>{t.source}</summary>
          <pre>{JSON.stringify(manifest.derived_from, null, 2)}</pre>
        </details>
      )}
      <details>
        <summary>{t.full}</summary>
        <pre>{JSON.stringify(manifest, null, 2)}</pre>
      </details>
      {zoom && (
        <Modal
          locale={zh ? "zh" : "en"}
          title={zoom.name}
          close={() => setZoom(null)}
        >
          <img
            className="zoom-image"
            src={mediaUrl(zoom.visual.primary)}
            alt={zoom.semantics.fallback}
          />
          <p lang={zoom.semantics.locale}>{zoom.semantics.meaning}</p>
        </Modal>
      )}
    </section>
  );
}
