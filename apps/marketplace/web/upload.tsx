import React, { useEffect, useRef, useState } from "react";
import { unzipSync, zipSync } from "fflate";
import { validate01, validate02 } from "amoji-schema";
import { buildSnapshot } from "./snapshot";
import { draftStore } from "./draft";
type Upload = {
  id: string;
  pack_id: string;
  release_id: string;
  version: number;
  row_version: number;
  expires_at: number;
  state: string;
};
type Submission = {
  id: string;
  upload_id: string;
  pack_id: string;
  release_id: string;
  version: number;
  state: string;
  row_version: number;
  reason: string | null;
  archive_sha256: string;
};
type Draft = {
  files: Record<string, Uint8Array>;
  manifest: any;
  filename: string;
  step: number;
  targetPack?: string;
  reserve?: string;
  authorize?: string;
  complete?: string;
  upload?: Upload;
  archive?: Uint8Array;
  submit?: string;
  withdraw?: { id: string; key: string; version: number };
  confirmed?: boolean;
};
const sum = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const words = {
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
  },
};
async function api(
  path: string,
  data?: object,
  key?: string,
  version?: number,
) {
  const headers: Record<string, string> = {};
  if (data !== undefined) {
    const c = await fetch("/v1/auth/csrf");
    if (!c.ok) throw Error("UNAUTHENTICATED");
    headers["x-csrf-token"] = ((await c.json()) as { csrf: string }).csrf;
    headers["content-type"] = "application/json";
    if (key) headers["idempotency-key"] = key;
    if (version !== undefined) headers["if-match"] = `"${version}"`;
  }
  const r = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result: any = await r.json();
  if (!r.ok) throw Error(result.error?.code ?? "UNAVAILABLE");
  return result;
}
function Preview({
  manifest,
  uploadId,
  files,
  t,
}: {
  manifest: any;
  uploadId?: string;
  files: Record<string, Uint8Array>;
  t: typeof words.zh | typeof words.en;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (uploadId) {
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
  }, [manifest, files, uploadId]);
  const mediaUrl = (m: any) =>
    uploadId ? `/v1/uploads/${uploadId}/media/${m.sha256}` : urls[m.sha256];
  return (
    <section className="pack-preview" aria-label={t.allContent}>
      <h3>{manifest.name}</h3>
      <p>{manifest.description}</p>
      <p>{manifest.scenario?.join(" · ")}</p>
      <div className="expression-grid">
        {manifest.expressions.map((e: any) => (
          <article key={e.asset_id + e.revision_id}>
            <div className="preview-media">
              <img
                src={mediaUrl(e.visual.primary)}
                alt={e.semantics.fallback}
              />
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
            </details>
            <p>
              {e.rights.license} · {e.rights.creator}
            </p>
            <p>{e.rights.source}</p>
          </article>
        ))}
      </div>
      {manifest.actions?.map((a: any) => (
        <article key={a.action_id}>
          <h4>{a.name ?? a.effect_summary}</h4>
          <p>
            {a.kind} · {a.scope} · {a.locale}
          </p>
          <p>{a.effect_summary}</p>
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
          <p>
            {a.rights.license} · {a.rights.creator}
          </p>
          <p>{a.rights.source}</p>
        </article>
      ))}
      {manifest.examples?.map((e: any, i: number) => (
        <article key={i}>
          <h4>{t.example}</h4>
          <p>{typeof e === "string" ? e : JSON.stringify(e)}</p>
        </article>
      ))}
      <p>
        {manifest.rights.license} · {manifest.rights.creator}
      </p>
      <p>{manifest.rights.source}</p>
      {manifest.derived_from && (
        <pre>{JSON.stringify(manifest.derived_from, null, 2)}</pre>
      )}
      <details>
        <summary>{t.full}</summary>
        <pre>{JSON.stringify(manifest, null, 2)}</pre>
      </details>
    </section>
  );
}
export function UploadPanel({
  locale,
  accountId,
}: {
  locale: "zh" | "en";
  accountId: string;
}) {
  const t = words[locale],
    zh = locale === "zh";
  const [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [rows, setRows] = useState<Submission[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [preview, setPreview] = useState<any>(null),
    [ready, setReady] = useState(false),
    [viewed, setViewed] = useState<{
      id: string;
      uploadId: string;
      manifest: any;
    } | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const saveTail = useRef(Promise.resolve());
  function notify(text: string) {
    setMessage(text);
    setTimeout(() => status.current?.focus(), 0);
  }
  async function save(d: Draft | null) {
    setDraft(d);
    const work = saveTail.current.then(() => draftStore(accountId, d));
    saveTail.current = work.then(
      () => {},
      () => {},
    );
    await work;
  }
  function edit(d: Draft) {
    setPreview(null);
    void save({
      ...d,
      archive: undefined,
      upload: undefined,
      reserve: undefined,
      authorize: undefined,
      complete: undefined,
      submit: undefined,
      confirmed: false,
    }).catch(() =>
      notify(
        zh
          ? "无法保存本地草稿。请检查浏览器存储。"
          : "Unable to save this draft. Check browser storage.",
      ),
    );
  }
  function explanation(e: unknown) {
    const c = e instanceof Error ? e.message : "";
    if (c === "UNAUTHENTICATED" || c === "ACCOUNT_DISABLED") {
      setPreview(null);
      setViewed(null);
      return zh
        ? "登录已失效，请重新登录；本地草稿仍保留。"
        : "Sign-in expired. Sign in again; the local draft is preserved.";
    }
    if (/LICENSE|ATTRIBUTION|DERIVATION|RIGHTS/.test(c))
      return zh
        ? "请核对每一项的分发许可、创作者署名和衍生来源。"
        : "Check every item’s distribution license, creator attribution and provenance.";
    if (c === "ROW_VERSION")
      return zh
        ? "状态已变化，请刷新后重新确认。"
        : "The state changed. Refresh and confirm again.";
    if (c === "READ_QUOTA")
      return zh
        ? "预览读取额度已用完，请稍后重试。草稿仍保留在本机。"
        : "The preview read allowance is exhausted. Try later; your draft remains on this device.";
    if (/QUOTA|RATE_LIMITED/.test(c))
      return zh
        ? "已达到当前额度，请稍后重试。每日最多 10 次新投稿，最多 10 份待审。"
        : "Allowance reached. Try later. Maximum: 10 new submissions per day and 10 pending.";
    if (c === "UPLOAD_EXPIRED")
      return zh
        ? "上传已过期，草稿仍在。返回修改后重新上传。"
        : "Upload expired. Your draft remains; go back and upload again.";
    if (/ARCHIVE|MEDIA|MANIFEST|ZIP|SCHEMA|BLOB/.test(c))
      return zh
        ? "内容未通过格式、素材或大小校验。请修正后重试。"
        : "Content failed format, media or size validation. Correct it and retry.";
    return zh
      ? "操作尚未确认。草稿已保留，请恢复操作核对结果。"
      : "The outcome is not confirmed. Your draft remains; reconcile the operation.";
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(explanation(e));
    } finally {
      setBusy(false);
    }
  }
  async function list(more = false) {
    const r = await api(
      "/v1/me/submissions" +
        (more && cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    setRows((p) => (more ? [...p, ...r.submissions] : r.submissions));
    setCursor(r.cursor);
  }
  useEffect(() => {
    let active = true;
    draftStore(accountId)
      .then((d) => {
        if (active) setDraft(d ?? null);
      })
      .catch((e) => {
        if (active) notify(explanation(e));
      })
      .finally(() => {
        if (active) setReady(true);
      });
    api("/v1/me/submissions")
      .then((r) => {
        if (active) {
          setRows(r.submissions);
          setCursor(r.cursor);
        }
      })
      .catch((e) => {
        if (active) notify(explanation(e));
      });
    return () => {
      active = false;
    };
  }, [accountId]);
  async function choose(file: File) {
    if (file.size > 10485760) throw Error("ARCHIVE_LIMIT");
    let n = 0,
      total = 0;
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        n++;
        total += f.originalSize;
        if (
          n > 256 ||
          total > 16777216 ||
          f.originalSize > (f.name === "manifest.json" ? 524288 : 1048576) ||
          !/^(manifest\.json|blobs\/[a-f0-9]{64})$/.test(f.name)
        )
          throw Error("ARCHIVE_LIMIT");
        return true;
      },
    });
    const m = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(files["manifest.json"]),
    );
    if (!(m.schema_version === "0.2" ? validate02 : validate01)(m))
      throw Error("MANIFEST_SCHEMA");
    const targetPack = draft?.targetPack;
    const manifest = {
      ...m,
      schema_version: "0.2",
      scenario: m.scenario ?? ["imported"],
      actions: m.actions ?? [],
      bindings: m.bindings ?? [],
      rights: m.rights ?? { license: "" },
      ...(m.schema_version === "0.2"
        ? { derived_from: { pack_id: m.pack_id, release_id: m.release_id } }
        : {}),
    };
    await save({ files, manifest, filename: file.name, step: 1, targetPack });
    setPreview(null);
    notify(t.saved);
  }
  async function validate() {
    if (!draft) return;
    let d = { ...draft };
    if (!d.reserve) {
      d = {
        ...d,
        reserve: crypto.randomUUID(),
        authorize: crypto.randomUUID(),
        complete: crypto.randomUUID(),
      };
      await save(d);
    }
    let u: Upload = (
      await api(
        "/v1/uploads",
        d.targetPack ? { pack_id: d.targetPack } : {},
        d.reserve,
      )
    ).upload;
    if (u.expires_at <= Date.now()) throw Error("UPLOAD_EXPIRED");
    d.upload = u;
    await save(d);
    if (!d.archive) {
      const manifest = buildSnapshot(
        d.manifest,
        JSON.parse(new TextDecoder().decode(d.files["manifest.json"])),
        { pack_id: u.pack_id, release_id: u.release_id, version: u.version },
      );
      const files = {
        ...d.files,
        "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
      };
      d = {
        ...d,
        archive: zipSync(files, {
          level: 0,
          mtime: new Date("2000-01-01T00:00:00Z"),
        }),
      };
      await save(d);
    }
    if (d.archive!.length > 10485760) throw Error("ARCHIVE_LIMIT");
    if (!["valid", "reserved", "uploaded", "validating"].includes(u.state))
      throw Error("MANIFEST_INVALID");
    if (u.state === "reserved") {
      const a = await api(
        `/v1/uploads/${u.id}/authorize`,
        { length: d.archive!.length, sha256: await sum(d.archive!) },
        d.authorize,
        u.row_version,
      );
      const put = await fetch(a.authorization.url, {
        method: "PUT",
        headers: a.authorization.headers,
        body: new Uint8Array(d.archive!),
        credentials: "omit",
      });
      if (!put.ok) throw Error("UPLOAD_FAILED");
      u = a.upload;
    }
    if (u.state !== "valid") {
      u = (
        await api(`/v1/uploads/${u.id}/complete`, {}, d.complete, u.row_version)
      ).upload;
      d.upload = u;
      await save(d);
    }
    await showPreview(d);
    notify(t.ready);
  }
  async function showPreview(d: Draft) {
    if (!d.upload) return;
    const r = await api(`/v1/uploads/${d.upload.id}/preview`);
    setPreview(r.manifest);
    await save({
      ...d,
      upload: { ...d.upload, row_version: r.row_version },
      step: 3,
    });
  }
  async function restore() {
    if (!draft) return;
    let d = { ...draft };
    for (const operation of [d.submit, d.withdraw?.key].filter(Boolean)) {
      try {
        await api("/v1/operations/" + operation);
      } catch (e) {
        if (!(e instanceof Error) || e.message !== "NOT_FOUND") throw e;
      }
    }
    if (d.upload) {
      const current = (await api("/v1/uploads/" + d.upload.id)).upload;
      d.upload = current;
      await save(d);
      if (current.state === "valid") await showPreview(d);
      else if (["reserved", "uploaded", "validating"].includes(current.state))
        await validate();
      else throw Error("UPLOAD_EXPIRED");
    } else if (d.reserve) await validate();
    await list();
    notify(t.saved);
  }
  async function submit() {
    if (!draft?.upload || !draft.confirmed || !preview) return;
    const d = { ...draft, submit: draft.submit ?? crypto.randomUUID() };
    await save(d);
    await api(
      "/v1/submissions",
      { upload_id: d.upload!.id, rights_confirmed: true },
      d.submit,
      d.upload!.row_version,
    );
    await list();
    notify(zh ? "已提交，等待审核。" : "Submitted for review.");
  }
  async function withdraw(s: Submission) {
    const d = draft ?? { files: {}, manifest: null, filename: "", step: 0 };
    const op =
      d.withdraw?.id === s.id
        ? d.withdraw
        : { id: s.id, key: crypto.randomUUID(), version: s.row_version };
    await save({ ...d, withdraw: op });
    await api(`/v1/submissions/${s.id}/withdraw`, {}, op.key, op.version);
    await list();
    notify(t.withdrawn);
  }
  const rights = draft?.manifest
    ? [
        { label: t.pack, value: draft.manifest.rights },
        ...draft.manifest.expressions.map((e: any) => ({
          label: `${t.expression}: ${e.name}`,
          value: e.rights,
        })),
        ...draft.manifest.actions.map((a: any) => ({
          label: `${t.action}: ${a.effect_summary}`,
          value: a.rights,
        })),
      ]
    : [];
  return (
    <section className="creator" aria-labelledby="creator-title">
      <h2 id="creator-title">{t.title}</h2>
      <p>{t.fileHint}</p>
      <p ref={status} tabIndex={-1} role="status" aria-live="polite">
        {message}
      </p>
      {!ready ? (
        <p>{t.busy}</p>
      ) : (
        <>
          <ol className="steps">
            {t.steps.map((label, i) => (
              <li
                key={label}
                aria-current={draft?.step === i ? "step" : undefined}
              >
                {i + 1}. {label}
              </li>
            ))}
          </ol>
          {!draft?.manifest ? (
            <label>
              {t.choose}
              <input
                type="file"
                accept=".amoji,.zip"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.currentTarget.value = "";
                  if (file) void run(() => choose(file));
                }}
              />
            </label>
          ) : (
            <>
              <p className="note">
                {draft.filename} · {t.saved}
              </p>
              {draft.step === 1 && (
                <div className="editor-fields">
                  <label>
                    {t.name}
                    <input
                      value={draft.manifest.name}
                      maxLength={120}
                      disabled={busy}
                      onChange={(e) =>
                        edit({
                          ...draft,
                          manifest: { ...draft.manifest, name: e.target.value },
                        })
                      }
                    />
                  </label>
                  <label>
                    {t.description}
                    <textarea
                      value={draft.manifest.description ?? ""}
                      maxLength={4000}
                      disabled={busy}
                      onChange={(e) =>
                        edit({
                          ...draft,
                          manifest: {
                            ...draft.manifest,
                            description: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <p>{t.rights}</p>
                  {rights.map((r: any, i: number) => (
                    <fieldset key={i}>
                      <legend>{r.label}</legend>
                      {(["license", "creator", "source"] as const).map(
                        (field) => (
                          <label key={field}>
                            {t[field]}
                            <input
                              value={r.value?.[field] ?? ""}
                              maxLength={field === "source" ? 500 : 120}
                              list={
                                field === "license" ? "licenses" : undefined
                              }
                              disabled={busy}
                              onChange={(e) => {
                                const m = structuredClone(draft.manifest);
                                const target =
                                  i === 0
                                    ? m.rights
                                    : i <= m.expressions.length
                                      ? m.expressions[i - 1].rights
                                      : m.actions[i - m.expressions.length - 1]
                                          .rights;
                                if (e.target.value)
                                  target[field] = e.target.value;
                                else delete target[field];
                                edit({ ...draft, manifest: m });
                              }}
                            />
                          </label>
                        ),
                      )}
                    </fieldset>
                  ))}
                  <datalist id="licenses">
                    <option>CC0-1.0</option>
                    <option>CC-BY-4.0</option>
                    <option>CC-BY-SA-4.0</option>
                  </datalist>
                </div>
              )}
              {draft.step === 2 && (
                <>
                  <p>{t.actions}</p>
                  {!draft.manifest.actions.length ? (
                    <p>{t.noActions}</p>
                  ) : (
                    draft.manifest.actions.map((a: any) => (
                      <article key={a.action_id}>
                        <h3>{a.effect_summary}</h3>
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
                        <button
                          disabled={busy}
                          onClick={() => {
                            const m = structuredClone(draft.manifest);
                            m.actions = m.actions.filter(
                              (v: any) => v.action_id !== a.action_id,
                            );
                            m.bindings = m.bindings
                              .map((b: any) => ({
                                ...b,
                                actions: b.actions.filter(
                                  (v: any) => v.action_id !== a.action_id,
                                ),
                              }))
                              .filter((b: any) => b.actions.length);
                            edit({ ...draft, manifest: m });
                          }}
                        >
                          {zh ? "不包含此动作" : "Exclude this action"}
                        </button>
                      </article>
                    ))
                  )}
                </>
              )}
              {draft.step === 3 && (
                <>
                  <h3>{preview ? t.verifiedPreview : t.localPreview}</h3>
                  <p>{t.sourceHint}</p>
                  <Preview
                    manifest={preview ?? draft.manifest}
                    files={draft.files}
                    uploadId={preview ? draft.upload?.id : undefined}
                    t={t}
                  />
                  {preview ? (
                    <>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={!!draft.confirmed}
                          disabled={busy}
                          onChange={(e) =>
                            void save({
                              ...draft,
                              confirmed: e.target.checked,
                            }).catch(() => notify(explanation(Error())))
                          }
                        />
                        <span>{t.confirm}</span>
                      </label>
                      <button
                        disabled={busy || !draft.confirmed}
                        onClick={() => void run(submit)}
                      >
                        {t.submit}
                      </button>
                    </>
                  ) : (
                    <button disabled={busy} onClick={() => void run(validate)}>
                      {busy ? t.busy : t.validate}
                    </button>
                  )}
                </>
              )}
              <div className="button-row">
                {draft.step > 1 && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => edit({ ...draft, step: draft.step - 1 })}
                  >
                    {t.back}
                  </button>
                )}
                {draft.step < 3 && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await save({ ...draft, step: draft.step + 1 });
                        notify(t.saved);
                      })
                    }
                  >
                    {t.next}
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void run(restore)}
                >
                  {t.restore}
                </button>
              </div>
              <button
                className="switch"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await save(null);
                    setPreview(null);
                  })
                }
              >
                {t.new}
              </button>
            </>
          )}
        </>
      )}
      <section className="submissions">
        <div className="section-heading">
          <h3>{t.list}</h3>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run(() => list())}
          >
            {t.refresh}
          </button>
        </div>
        {!rows.length && <p>{t.empty}</p>}
        {rows.map((s) => (
          <article key={s.id}>
            <h4>
              {s.pack_id} · v{s.version}
            </h4>
            <p>{t[s.state as "pending"] ?? s.state}</p>
            {s.reason && <p>{s.reason}</p>}
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const current = (await api(`/v1/me/submissions/${s.id}`))
                    .submission;
                  const p = await api(
                    `/v1/uploads/${current.upload_id}/preview`,
                  );
                  setViewed({
                    id: s.id,
                    uploadId: current.upload_id,
                    manifest: p.manifest,
                  });
                })
              }
            >
              {t.inspect}
            </button>
            {viewed?.id === s.id && (
              <Preview
                manifest={viewed.manifest}
                uploadId={viewed.uploadId}
                files={{}}
                t={t}
              />
            )}

            <code>{s.archive_sha256}</code>
            <div className="button-row">
              {s.state === "pending" && (
                <button
                  disabled={busy}
                  onClick={() => void run(() => withdraw(s))}
                >
                  {t.withdraw}
                </button>
              )}
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await save({
                      files: {},
                      manifest: null,
                      filename: "",
                      step: 0,
                      targetPack: s.pack_id,
                    });
                    setPreview(null);
                    notify(
                      zh
                        ? "请选择修订后的包文件。"
                        : "Choose the revised pack file.",
                    );
                  })
                }
              >
                {t.revision}
              </button>
            </div>
          </article>
        ))}
        {cursor && (
          <button disabled={busy} onClick={() => void run(() => list(true))}>
            {t.more}
          </button>
        )}
      </section>
    </section>
  );
}
