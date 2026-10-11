import React, { useEffect, useRef, useState } from "react";
import { Preview, previewWords } from "./upload";
type Locale = "zh" | "en";
const words = {
  zh: {
    title: "发现场景包",
    q: "关键词",
    scenario: "场景",
    locale: "语义语言",
    style: "画风",
    actions: "协作动作",
    all: "全部",
    yes: "含动作",
    no: "仅表情",
    search: "搜索",
    empty: "没有匹配的公开内容。",
    loading: "正在加载…",
    error: "暂时无法获取内容，请重试。",
    retry: "重试",
    more: "加载更多",
    author: "作者",
    version: "版本",
    share: "公开分享链接",
    download: "下载精确版本",
    dsh: "在 dsh 表情市场搜索此包 ID：",
    support: "宿主支持",
    supportText:
      "表情可供支持此包格式的宿主使用。协作动作由 dsh 适配；其他宿主不支持时动作禁用。提示不保证模型遵从，安装不会自动启用动作。",
    update: "更新说明",
    review: "审核工作台",
    inspect: "查看精确内容",
    approve: "批准公开",
    changes: "退回修改",
    reason: "审核理由",
    done: "决定已保存。",
    stale: "状态已变化，请重新查看后决定。",
    unknown: "结果未确认。请核对原操作，勿重复创建决定。",
    reconcile: "核对上次决定",
    diff: "与上一公开版本的差异",
    first: "首次发布，没有上一公开版本。",
    before: "上一公开版本",
    after: "本次投稿",
    identity: "身份与摘要",
    queueEmpty: "当前没有待审投稿。",
    refresh: "刷新队列",
    self: "禁止审核自己的投稿。",
    changed: "有变化",
    same: "无变化",
    fields: "字段",
    complete: "全部差异内容",
  },
  en: {
    title: "Discover scenario packs",
    q: "Keywords",
    scenario: "Scenario",
    locale: "Semantic language",
    style: "Visual style",
    actions: "Collaboration actions",
    all: "All",
    yes: "With actions",
    no: "Expressions only",
    search: "Search",
    empty: "No matching public content.",
    loading: "Loading…",
    error: "Unable to load content. Please retry.",
    retry: "Retry",
    more: "Load more",
    author: "Author",
    version: "Version",
    share: "Public share link",
    download: "Download exact release",
    dsh: "Search this pack ID in the dsh marketplace:",
    support: "Host support",
    supportText:
      "Expressions work in hosts supporting this pack format. Collaboration actions are adapted for dsh; unsupported hosts disable actions. Guidance does not guarantee compliance, and installation never enables actions.",
    update: "Release notes",
    review: "Review workspace",
    inspect: "Inspect exact content",
    approve: "Approve publication",
    changes: "Request changes",
    reason: "Review reason",
    done: "Decision saved.",
    stale: "State changed. Inspect again before deciding.",
    unknown:
      "Outcome not confirmed. Reconcile the original operation before deciding again.",
    reconcile: "Reconcile last decision",
    diff: "Changes from the previous public release",
    first: "First publication; no previous public release.",
    before: "Previous public release",
    after: "Submitted release",
    identity: "Identity and digests",
    queueEmpty: "No pending submissions.",
    refresh: "Refresh queue",
    self: "You cannot review your own submission.",
    changed: "Changed",
    same: "Unchanged",
    fields: "Field",
    complete: "Complete changed content",
  },
};
async function json(path: string, options?: RequestInit) {
  const r = await fetch(path, options);
  const d: any = await r.json();
  if (!r.ok) throw Error(d.error?.code ?? "UNAVAILABLE");
  return d;
}
export function ReleaseView({
  data,
  locale,
  mediaBase,
}: {
  data: any;
  locale: Locale;
  mediaBase: string;
}) {
  const t = words[locale],
    m = data.manifest;
  return (
    <article className="release">
      <p>
        {t.author}: {data.author ?? m.rights.creator} · {t.version}: {m.version}
      </p>
      <Preview
        manifest={m}
        files={{}}
        mediaBase={mediaBase}
        t={previewWords[locale]}
      />
      <h3>{t.update}</h3>
      <p>{m.description ?? "—"}</p>
      <h3>{t.support}</h3>
      <p>{t.supportText}</p>
      <details>
        <summary>{t.identity}</summary>
        <p>{m.pack_id}</p>
        <p>{m.release_id}</p>
        <p>SHA-256: {data.archive_sha256 ?? data.submission?.archive_sha256}</p>
        <p>
          Manifest SHA-256:{" "}
          {data.manifest_sha256 ?? data.submission?.manifest_sha256}
        </p>
      </details>
    </article>
  );
}
export function Catalog({ locale }: { locale: Locale }) {
  const t = words[locale],
    [rows, setRows] = useState<any[]>([]),
    [detail, setDetail] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [query, setQuery] = useState("");
  const exact =
    /^\/packs\/([0-9a-f-]{36})(?:\/releases\/([0-9a-f-]{36}))?$/.test(
      location.pathname,
    );
  async function load(q = query, more = false) {
    setBusy(true);
    setFailed(false);
    try {
      if (exact) {
        setDetail(await json("/v1" + location.pathname));
      } else {
        const d = await json(
          "/v1/packs?" +
            q +
            (more && cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        );
        setRows((old) => (more ? [...old, ...d.packs] : d.packs));
        setCursor(d.cursor);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="creator catalog">
      <h2>{t.title}</h2>
      {!exact && (
        <form
          className="market-filters"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new URLSearchParams(
              new FormData(e.currentTarget) as any,
            ).toString();
            setQuery(q);
            void load(q);
          }}
        >
          {(["q", "scenario", "locale", "style"] as const).map((k) => (
            <label key={k}>
              {t[k]}
              <input name={k} maxLength={256} />
            </label>
          ))}
          <label>
            {t.actions}
            <select name="actions">
              <option value="">{t.all}</option>
              <option value="true">{t.yes}</option>
              <option value="false">{t.no}</option>
            </select>
          </label>
          <button disabled={busy}>{t.search}</button>
        </form>
      )}
      <p role="status">
        {busy
          ? t.loading
          : failed
            ? t.error
            : !exact && !rows.length
              ? t.empty
              : ""}
      </p>
      {failed && <button onClick={() => load()}>{t.retry}</button>}
      {detail && (
        <>
          <ReleaseView
            data={detail}
            locale={locale}
            mediaBase={`/v1/packs/${detail.pack_id}/releases/${detail.release_id}`}
          />
          <p>
            <a href={detail.share_url}>{t.share}</a>
          </p>
          <p>
            {t.dsh} <code>{detail.pack_id}</code>
          </p>
          <a
            className="download"
            href={`/v1/packs/${detail.pack_id}/releases/${detail.release_id}/archive`}
          >
            {t.download}
          </a>
        </>
      )}
      {rows.map((r) => (
        <article className="catalog-row" key={r.pack_id}>
          <h3>
            <a href={`/packs/${r.pack_id}/releases/${r.release_id}`}>
              {r.manifest.name}
            </a>
          </h3>
          <p>{r.manifest.description}</p>
          <p>
            {r.manifest.scenario.join(" · ")} · {r.author} · {t.version}{" "}
            {r.manifest.version}
          </p>
        </article>
      ))}
      {cursor && (
        <button disabled={busy} onClick={() => load(query, true)}>
          {t.more}
        </button>
      )}
    </section>
  );
}
export function Reviews({
  locale,
  accountId,
}: {
  locale: Locale;
  accountId: string;
}) {
  const t = words[locale],
    [rows, setRows] = useState<any[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [detail, setDetail] = useState<any>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [operation, setOperation] = useState<any>(() => {
      try {
        return JSON.parse(
          sessionStorage.getItem("review:" + accountId) ?? "null",
        );
      } catch {
        return null;
      }
    });
  const status = useRef<HTMLParagraphElement>(null);
  function notify(s: string) {
    setMessage(s);
    setTimeout(() => status.current?.focus(), 0);
  }
  async function queue(more = false) {
    setBusy(true);
    try {
      const d = await json(
        "/v1/review/submissions" +
          (more && cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      );
      setRows((old) => (more ? [...old, ...d.submissions] : d.submissions));
      setCursor(d.cursor);
    } catch {
      notify(t.error);
    } finally {
      setBusy(false);
    }
  }
  async function inspect(id: string) {
    setBusy(true);
    try {
      setDetail(await json("/v1/review/submissions/" + id));
      setReason("");
    } catch {
      notify(t.error);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void queue();
  }, []);
  function remember(op: any) {
    sessionStorage.setItem("review:" + accountId, JSON.stringify(op));
    setOperation(op);
  }
  async function reconcile() {
    setBusy(true);
    try {
      try {
        await json("/v1/operations/" + operation.key);
      } catch (e) {
        if (!(e instanceof Error) || e.message !== "NOT_FOUND") throw e;
        const csrf = await json("/v1/auth/csrf");
        await json("/v1/review/submissions/" + operation.id + "/decision", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf.csrf,
            "idempotency-key": operation.key,
            "if-match": `"${operation.version}"`,
          },
          body: JSON.stringify({
            decision: operation.decision,
            reason: operation.reason,
          }),
        });
      }
      remember(null);
      setDetail(null);
      notify(t.done);
      await queue();
    } catch (e) {
      if (
        e instanceof Error &&
        [
          "ROW_VERSION",
          "SUBMISSION_STATE",
          "SELF_REVIEW",
          "FORBIDDEN",
        ].includes(e.message)
      ) {
        remember(null);
        notify(t.stale);
      } else notify(t.unknown);
    } finally {
      setBusy(false);
    }
  }
  async function decide(decision: string) {
    const op = {
      key: crypto.randomUUID(),
      id: detail.submission.id,
      version: detail.submission.row_version,
      decision,
      reason,
    };
    remember(op);
    setBusy(true);
    try {
      const csrf = await json("/v1/auth/csrf");
      await json("/v1/review/submissions/" + op.id + "/decision", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf.csrf,
          "idempotency-key": op.key,
          "if-match": `"${op.version}"`,
        },
        body: JSON.stringify({ decision, reason }),
      });
      remember(null);
      setDetail(null);
      notify(t.done);
      await queue();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (
        [
          "ROW_VERSION",
          "SUBMISSION_STATE",
          "SELF_REVIEW",
          "REVIEW_REASON",
          "FORBIDDEN",
        ].includes(code)
      ) {
        remember(null);
        notify(code === "SELF_REVIEW" ? t.self : t.stale);
      } else notify(t.unknown);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="creator">
      <h2>{t.review}</h2>
      <button disabled={busy} onClick={() => queue()}>
        {t.refresh}
      </button>
      <p ref={status} tabIndex={-1} role="status">
        {busy ? t.loading : message}
      </p>
      {operation && (
        <button disabled={busy} onClick={reconcile}>
          {t.reconcile}
        </button>
      )}
      {!busy && !rows.length && <p>{t.queueEmpty}</p>}
      <div className="review-queue">
        {rows.map((s) => (
          <article key={s.id}>
            <p>
              {s.pack_id} · {t.version} {s.version}
            </p>
            <button disabled={busy} onClick={() => inspect(s.id)}>
              {t.inspect}
            </button>
          </article>
        ))}
      </div>
      {cursor && (
        <button disabled={busy} onClick={() => queue(true)}>
          {t.more}
        </button>
      )}
      {detail && (
        <>
          <ReleaseView
            data={detail}
            locale={locale}
            mediaBase={`/v1/review/submissions/${detail.submission.id}`}
          />
          <h3>{t.diff}</h3>
          {detail.previous ? (
            <>
              <p>
                {t.before}: {detail.previous.release_id}
              </p>
              {[
                "name",
                "description",
                "scenario",
                "styles",
                "expressions",
                "actions",
                "bindings",
                "rights",
                "examples",
                "requires",
                "derived_from",
              ].map((field) => {
                const before = detail.previous.manifest[field],
                  after = detail.manifest[field],
                  changed = JSON.stringify(before) !== JSON.stringify(after);
                return (
                  <details key={field}>
                    <summary>
                      {field} — {changed ? t.changed : t.same}
                    </summary>
                    {changed && (
                      <>
                        <h4>{t.before}</h4>
                        <pre>{JSON.stringify(before ?? null, null, 2)}</pre>
                        <h4>{t.after}</h4>
                        <pre>{JSON.stringify(after ?? null, null, 2)}</pre>
                      </>
                    )}
                  </details>
                );
              })}
            </>
          ) : (
            <p>{t.first}</p>
          )}
          <label>
            {t.reason}
            <textarea
              value={reason}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="button-row">
            <button
              disabled={busy || !!operation || !reason.trim()}
              onClick={() => decide("approve")}
            >
              {t.approve}
            </button>
            <button
              className="secondary"
              disabled={busy || !!operation || !reason.trim()}
              onClick={() => decide("changes_requested")}
            >
              {t.changes}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
