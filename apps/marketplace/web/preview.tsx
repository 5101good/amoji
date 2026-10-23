import React, { useEffect, useState } from "react";
import { Modal } from "./ui";
import { expressionText } from "../../../src/protocol/text";
import { actLabel, pick, uiLocale } from "./acts";
export const previewWords = {
  zh: {
    title: "创作者工作台",
    steps: ["选择内容", "说明与许可", "可选效果", "预览投稿"],
    choose: "选择 .amoji 表情包",
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
      "仅支持 CC0-1.0、CC-BY-4.0、CC-BY-SA-4.0；包和每个表情均须填写创作者，衍生包须保留来源。不会自动改变导入内容的许可。修改表情的署名/许可会创建新身份并保留来源。",
    effects:
      "可选择保留包内协作效果。效果是可选提示，不会因安装或发送表情而自动启用。",
    noEffects: "这个包只有表情，没有协作效果。",
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
    allContent: "全部表情、素材、效果、许可与来源",
    more: "加载更多",
    pack: "表情包",
    expression: "表情",
    effect: "效果",
    act: "码位",
    languages: "语言",
    translation: "翻译",
    context: "协作提示",
    template: "会话习惯",
    bound: "绑定",
    packLevel: "包级习惯，需手动启用",
  },
  en: {
    title: "Creator workspace",
    steps: [
      "Choose content",
      "Details and licenses",
      "Optional effects",
      "Preview and submit",
    ],
    choose: "Choose an .amoji expression pack",
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
      "Supported: CC0-1.0, CC-BY-4.0 and CC-BY-SA-4.0. The pack and every expression require creator attribution; derivatives require provenance. Imported licenses are never changed automatically. Editing an expression's attribution or license creates a new identity and preserves provenance.",
    effects:
      "Choose which included collaboration effects to keep. They are optional guidance, never enabled by installation or by sending an expression.",
    noEffects:
      "This pack contains expressions only, with no collaboration effects.",
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
      "All expressions, media, effects, licenses and sources",
    more: "Load more",
    pack: "Expression pack",
    expression: "Expression",
    effect: "Effect",
    act: "Act",
    languages: "Languages",
    translation: "Translation",
    context: "Collaboration hint",
    template: "Conversation habit",
    bound: "Bound to",
    packLevel: "Pack-level habit; enable it yourself",
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
  const locale = zh ? "zh" : "en";
  const lang = uiLocale(locale);
  const local = (map: Record<string, string>) => pick(map, locale, manifest.original_locale);
  const [zoom, setZoom] = useState<any>(null);
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
  const bindings = (effectId: string) =>
    (manifest.bindings ?? [])
      .filter((b: any) => b.effects.includes(effectId))
      .map((b: any) => {
        if ("act" in b.target) return actLabel(b.target.act, locale);
        const e = manifest.expressions.find((x: any) => x.asset_id === b.target.asset_id && x.revision_id === b.target.revision_id);
        return e ? expressionText(e, lang).name : b.target.revision_id;
      });
  const zoomed = zoom && expressionText(zoom, lang);
  return (
    <section className="pack-preview" aria-label={t.allContent}>
      {!hideHeading && (
        <div className="preview-heading">
          <h3>{local(manifest.name)}</h3>
          <p>{local(manifest.description)}</p>
          <p>
            {t.languages}: {manifest.locales.join(" · ")}
          </p>
        </div>
      )}
      {hideHeading && (
        <div className="preview-toolbar">
          <h2>{zh ? "表情与含义" : "Expressions & meanings"}</h2>
        </div>
      )}
      <div className="expression-grid">
        {manifest.expressions.map((e: any) => {
          const x = expressionText(e, lang);
          return (
            <article key={e.asset_id + e.revision_id}>
              <div className="preview-media">
                <button
                  className="image-preview-button"
                  type="button"
                  onClick={() => setZoom(e)}
                  aria-label={(zh ? "放大查看：" : "View larger: ") + x.name}
                >
                  <img
                    loading="lazy"
                    decoding="async"
                    src={mediaUrl(e.visual.primary)}
                    alt={x.fallback}
                  />
                </button>
                {e.visual.poster && (
                  <img
                    src={mediaUrl(e.visual.poster)}
                    alt={x.fallback + " (poster)"}
                  />
                )}
              </div>
              <h4 lang={x.locale}>{x.name}</h4>
              <p>
                {t.act}: {actLabel(e.realizes, locale)} · {e.realizes}
              </p>
              <p lang={x.locale}>{x.meaning}</p>
              <p>
                {t.locale}: <span lang={e.original_locale}>{e.original_locale}</span>
                {" · "}
                {t.languages}: {Object.keys(e.semantics).join(" · ")}
              </p>
              <details>
                <summary>{t.full}</summary>
                <pre>{JSON.stringify({ realizes: e.realizes, intensity: e.intensity, directions: e.directions, name: e.name, semantics: e.semantics, tags: e.tags }, null, 2)}</pre>
                <p>
                  {e.rights.license} · {e.rights.creator}
                </p>
                <p>{e.rights.source}</p>
              </details>
            </article>
          );
        })}
      </div>
      {!!manifest.effects?.length && (
        <h2 className="preview-section-title">
          {zh ? "可选协作效果" : "Optional collaboration effects"}
        </h2>
      )}
      {manifest.effects?.map((a: any) => {
        const bound = bindings(a.effect_id);
        return (
          <article className="action-preview" key={a.effect_id}>
            <h4>{local(a.title)}</h4>
            <p>
              {a.kind === "context" ? t.context : t.template} ·{" "}
              {bound.length ? `${t.bound}: ${bound.join(" · ")}` : t.packLevel}
            </p>
            <p>{local(a.summary)}</p>
            {a.kind === "context" ? (
              <p>{local(a.instruction)}</p>
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
          </article>
        );
      })}
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
          locale={locale}
          title={zoomed.name}
          close={() => setZoom(null)}
        >
          <img
            className="zoom-image"
            src={mediaUrl(zoom.visual.primary)}
            alt={zoomed.fallback}
          />
          <p lang={zoomed.locale}>{zoomed.meaning}</p>
        </Modal>
      )}
    </section>
  );
}
