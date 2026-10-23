import { narrative } from "./copy";
import { catalogPage, type CatalogPage } from "../src/catalog-page";
import { Report } from "./lifecycle";
import React, { useEffect, useRef, useState } from "react";
import { Preview, previewWords } from "./preview";
import { ACTS, actLabel, pick } from "./acts";
import { Hero, PackCard } from "./gallery";
import { Icon, CopyButton, EmptyState, type Locale } from "./ui";
const words = {
  zh: {
    title: "发现表情包",
    q: "关键词",
    act: "码位",
    locale: "语言",
    effects: "协作效果",
    all: "全部",
    yes: "含效果",
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
      "表情可供支持 Amoji 0.1 的宿主使用。协作效果由宿主适配；不支持时效果停用。提示不保证模型遵从，安装不会自动启用效果。",
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
    title: "Discover expression packs",
    q: "Keywords",
    act: "Act",
    locale: "Language",
    effects: "Collaboration effects",
    all: "All",
    yes: "With effects",
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
      "Expressions work in hosts supporting Amoji 0.1. Hosts adapt collaboration effects and disable them where unsupported. Guidance does not guarantee compliance, and installation never enables effects.",
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
export function Catalog({
  locale,
  initial,
}: {
  locale: Locale;
  initial?: CatalogPage;
}) {
  const t = words[locale],
    zh = locale === "zh";
  const initialQuery = new URLSearchParams(
    typeof location === "undefined" ? "" : location.search,
  );
  for (const key of [...initialQuery.keys()])
    if (!["q", "act", "locale", "effects"].includes(key))
      initialQuery.delete(key);
  const [rows, setRows] = useState<CatalogPage["packs"]>(initial?.packs ?? []);
  const [detail, setDetail] = useState<any>(null),
    [tombstone, setTombstone] = useState<any>(null);
  const [busy, setBusy] = useState(!initial),
    [failed, setFailed] = useState(false),
    [notFound, setNotFound] = useState(false);
  const [cursor, setCursor] = useState<string | null>(initial?.cursor ?? null);
  const [query, setQuery] = useState(initialQuery.toString());
  const [filters, setFilters] = useState(Object.fromEntries(initialQuery));
  const [advanced, setAdvanced] = useState(
    ["act", "locale", "effects"].some((k) => initialQuery.has(k)),
  );
  const request = useRef<AbortController | null>(null);
  const exact =
    /^\/packs\/([0-9a-f-]{36})(?:\/releases\/([0-9a-f-]{36}))?$/.test(
      location.pathname,
    );
  async function load(q = query, more = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailed(false);
    setNotFound(false);
    try {
      const url = exact
        ? "/v1" + location.pathname
        : "/v1/packs?" +
          q +
          (more && cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      const response = await fetch(url, { signal: controller.signal });
      const value: any = await response.json();
      if (exact && response.status === 404) {
        setNotFound(true);
        setDetail(null);
        setTombstone(null);
      } else if (exact && response.status === 410 && value.tombstone) {
        setTombstone(value.tombstone);
        setDetail(null);
      } else {
        if (!response.ok) throw Error("UNAVAILABLE");
        if (exact) {
          setTombstone(null);
          setDetail(value);
        } else {
          const data = catalogPage(value);
          setRows((old) =>
            more
              ? [
                  ...old,
                  ...data.packs.filter(
                    (row) => !old.some((o) => o.release_id === row.release_id),
                  ),
                ]
              : data.packs,
          );
          setCursor(data.cursor);
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        setFailed(true);
        if (!more && !exact) {
          setRows([]);
          setCursor(null);
        }
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    if (!initial) void load();
    const restore = () => {
      const params = new URLSearchParams(location.search);
      for (const key of [...params.keys()])
        if (!["q", "act", "locale", "effects"].includes(key))
          params.delete(key);
      setFilters(Object.fromEntries(params));
      setQuery(params.toString());
      void load(params.toString());
    };
    window.addEventListener("popstate", restore);
    return () => {
      request.current?.abort();
      window.removeEventListener("popstate", restore);
    };
  }, []);
  function search(next = filters) {
    const params = new URLSearchParams(
      Object.entries(next).filter(([, v]) => v.trim()),
    );
    const q = params.toString();
    setQuery(q);
    history.pushState(null, "", location.pathname + (q ? "?" + q : ""));
    void load(q);
  }
  function reset() {
    setFilters({});
    search({});
  }
  return (
    <>
      {!exact && <Hero locale={locale} />}
      <section
        className={exact ? "catalog detail-page" : "catalog"}
        id="collections"
        aria-labelledby="catalog-title"
      >
        {exact ? (
          <a className="back-link" href="/">
            {zh ? "返回所有表情" : "Back to all expressions"}
          </a>
        ) : (
          <>
            <div className="collection-heading">
              <div>
                <span className="section-index">
                  {narrative[locale].collection}
                </span>
                <h2 id="catalog-title">{narrative[locale].collectionTitle}</h2>
                <p>{narrative[locale].collectionBody}</p>
              </div>
              <a className="text-link" href="/?view=studio">
                <Icon name="plus" size={18} />
                {zh ? "分享表情包" : "Share a pack"}
              </a>
            </div>
            <form
              className="catalog-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                search();
              }}
            >
              <div className="search-bar">
                <Icon name="search" />
                <input
                  aria-label={t.q}
                  name="q"
                  placeholder={
                    zh ? "搜索表情或场景…" : "Search expressions or situations…"
                  }
                  value={filters.q ?? ""}
                  onChange={(e) =>
                    setFilters({ ...filters, q: e.target.value })
                  }
                  maxLength={256}
                />
                <button disabled={busy}>{t.search}</button>
              </div>
              <button
                type="button"
                className="secondary filter-toggle"
                aria-expanded={advanced}
                aria-controls="catalog-filters"
                onClick={() => setAdvanced(!advanced)}
              >
                <Icon name="filter" />
                {zh ? "筛选" : "Filters"}
                {Object.entries(filters).filter(([k, v]) => k !== "q" && v)
                  .length > 0 && (
                  <span className="filter-count">
                    {
                      Object.entries(filters).filter(([k, v]) => k !== "q" && v)
                        .length
                    }
                  </span>
                )}
              </button>
              <div
                id="catalog-filters"
                className="market-filters"
                hidden={!advanced}
              >
                <label>
                  {t.act}
                  <select
                    value={filters.act ?? ""}
                    onChange={(e) =>
                      setFilters({ ...filters, act: e.target.value })
                    }
                  >
                    <option value="">{t.all}</option>
                    {ACTS.map((a) => (
                      <option key={a.act} value={a.act}>
                        {actLabel(a.act, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.locale}
                  <input
                    list="semantic-locales"
                    value={filters.locale ?? ""}
                    maxLength={256}
                    placeholder={zh ? "全部语言" : "All languages"}
                    onChange={(e) =>
                      setFilters({ ...filters, locale: e.target.value })
                    }
                  />
                  <datalist id="semantic-locales">
                    <option value="zh-CN">中文</option>
                    <option value="en">English</option>
                  </datalist>
                </label>
                <label>
                  {t.effects}
                  <select
                    value={filters.effects ?? ""}
                    onChange={(e) =>
                      setFilters({ ...filters, effects: e.target.value })
                    }
                  >
                    <option value="">{t.all}</option>
                    <option value="true">{t.yes}</option>
                    <option value="false">{t.no}</option>
                  </select>
                </label>
                <div className="filter-actions">
                  <button type="submit" disabled={busy}>
                    {zh ? "应用筛选" : "Apply filters"}
                  </button>
                </div>
              </div>
            </form>
            <div className="results-heading">
              <span>
                {query
                  ? zh
                    ? "筛选结果"
                    : "Search results"
                  : zh
                    ? "所有表情包"
                    : "All expression packs"}
              </span>
              <span className="note">
                {!busy &&
                  rows.length > 0 &&
                  (zh ? `已展示 ${rows.length} 份` : `Showing ${rows.length}`)}
                {query && (
                  <button
                    className="quiet small"
                    disabled={busy}
                    onClick={reset}
                  >
                    {zh ? "清除筛选" : "Clear filters"}
                  </button>
                )}
              </span>
            </div>
          </>
        )}
        <div role="status" aria-live="polite" className="sr-only">
          {busy
            ? t.loading
            : failed
              ? t.error
              : !exact && !rows.length
                ? t.empty
                : ""}
        </div>
        {busy && !rows.length && !detail && (
          <div className="loading-state" aria-hidden="true">
            <span className="spinner" />
            {t.loading}
          </div>
        )}
        {failed && (
          <div className="notice error">
            <p>{t.error}</p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => load()}
            >
              {t.retry}
            </button>
          </div>
        )}
        {!exact && !busy && !failed && !rows.length && (
          <EmptyState
            title={
              query
                ? zh
                  ? "还没找到这份表达"
                  : "No expressions found"
                : zh
                  ? "这里，等着第一份表达"
                  : "The first expression is on its way"
            }
            icon="search"
          >
            <p>
              {query
                ? zh
                  ? "换个关键词，或清除筛选再看看。"
                  : "Try another keyword or clear your filters."
                : zh
                  ? "创作你的表情包，审核通过后会在这里与大家见面。"
                  : "Share a pack. Once reviewed, it will appear here for everyone."}
            </p>
            {query ? (
              <button className="secondary" onClick={reset}>
                {zh ? "清除筛选" : "Clear filters"}
              </button>
            ) : (
              <a className="button" href="/?view=studio">
                {zh ? "分享我的表情" : "Share my expressions"}
              </a>
            )}
          </EmptyState>
        )}
        {notFound && (
          <EmptyState
            title={zh ? "没有找到这份表情包" : "This pack could not be found"}
          >
            <p>
              {zh
                ? "链接可能已失效，或内容尚未公开。"
                : "The link may be outdated, or this content has not been published."}
            </p>
            <a className="button" href="/">
              {zh ? "返回表情市场" : "Back to the marketplace"}
            </a>
          </EmptyState>
        )}
        {tombstone && (
          <EmptyState
            title={
              zh
                ? "这份表达暂时离开了市场"
                : "This release is no longer available"
            }
          >
            <p>
              {tombstone.state === "safety_removed"
                ? zh
                  ? "安全下架：此版本的协作效果不可再启用。"
                  : "Safety removal: collaboration effects in this release must stay disabled."
                : zh
                  ? "作者或账号状态已停止此版本的分发。"
                  : "Distribution of this release has ended."}
            </p>
            <p>
              {zh
                ? "已开始下载或保存的副本无法远程收回。"
                : "In-flight downloads and saved copies cannot be remotely recalled."}
            </p>
            <a className="button" href="/">
              {zh ? "发现其他表情" : "Explore other expressions"}
            </a>
          </EmptyState>
        )}
        {detail && (
          <div className="detail-layout">
            <div className="detail-heading">
              <span className="category-label">
                {[...new Set<string>(detail.manifest.expressions.map((e: any) => e.realizes))].slice(0, 4).map((act) => actLabel(act, locale)).join(" / ")}
              </span>
              <h1 id="catalog-title">{pick(detail.manifest.name, locale, detail.manifest.original_locale)}</h1>
              <p>{pick(detail.manifest.description, locale, detail.manifest.original_locale)}</p>
            </div>
            <div className="detail-content">
              <Preview
                manifest={detail.manifest}
                files={{}}
                mediaBase={`/v1/packs/${detail.pack_id}/releases/${detail.release_id}`}
                t={previewWords[locale]}
                hideHeading
              />
            </div>
            <aside className="acquisition">
              <h2>
                {zh ? "把默契带进对话" : "Bring it into your conversation"}
              </h2>
              <p>
                {zh
                  ? "图片传递情绪，固定文字语义让 AI 读懂你的意思。"
                  : "Images express the feeling. Fixed text semantics make the meaning clear to AI."}
              </p>
              <a
                className="button"
                href={`/v1/packs/${detail.pack_id}/releases/${detail.release_id}/archive`}
              >
                <Icon name="download" />
                {t.download}
              </a>
              <details className="install-help">
                <summary>{zh ? "在 dsh 中使用" : "Use in dsh"}</summary>
                <p>
                  {zh
                    ? "打开「表情 → 市场」，搜索包 ID 并安装。"
                    : "Open Expressions → Marketplace, search the pack ID and install."}
                </p>
                <CopyButton
                  value={detail.pack_id}
                  locale={locale}
                  label={zh ? "复制包 ID" : "Copy pack ID"}
                />
              </details>
              <details className="pack-information">
                <summary>
                  {zh ? "版本、作者与许可" : "Version, author & license"}
                </summary>
                <dl className="pack-facts">
                  <div>
                    <dt>{t.author}</dt>
                    <dd>{detail.author ?? detail.manifest.rights.creator}</dd>
                  </div>
                  <div>
                    <dt>{t.version}</dt>
                    <dd>{detail.manifest.version}</dd>
                  </div>
                  <div>
                    <dt>{zh ? "许可" : "License"}</dt>
                    <dd>{detail.manifest.rights.license}</dd>
                  </div>
                  <div>
                    <dt>{zh ? "表情" : "Expressions"}</dt>
                    <dd>{detail.manifest.expressions.length}</dd>
                  </div>
                  <div>
                    <dt>{t.locale}</dt>
                    <dd>{detail.manifest.locales.join(" · ")}</dd>
                  </div>
                </dl>
              </details>
              <p className="note">
                {zh
                  ? "安装不会自动启用协作效果，需要你在宿主中明确选择。"
                  : "Installation never enables effects. Collaboration guidance requires your explicit choice in the host."}
              </p>
              <CopyButton
                value={detail.share_url}
                locale={locale}
                label={t.share}
              />
              <details>
                <summary>{t.identity}</summary>
                <p>{detail.pack_id}</p>
                <p>{detail.release_id}</p>
                <p>SHA-256: {detail.archive_sha256}</p>
              </details>
              <details className="report-disclosure">
                <summary>{zh ? "举报此内容" : "Report this content"}</summary>
                <Report pack={detail} locale={locale} />
              </details>
            </aside>
          </div>
        )}
        {!exact && (
          <div className="pack-grid" aria-busy={busy}>
            {rows.map((row, index) => (
              <PackCard
                key={row.release_id}
                row={row}
                index={index}
                locale={locale}
              />
            ))}
          </div>
        )}
        {!exact && cursor && (
          <div className="load-more">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => load(query, true)}
            >
              {busy ? t.loading : t.more}
            </button>
          </div>
        )}
      </section>
      {!exact && (
        <section
          className="about-expression"
          aria-labelledby="invitation-title"
        >
          <h2 id="invitation-title">
            {narrative[locale].invitation.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </h2>
          <div className="about-copy">
            <p>{narrative[locale].invitationBody}</p>
            <div className="about-actions">
              <a className="text-link" href="/?view=studio">
                {narrative[locale].invitationShare}
                <Icon name="plus" size={16} />
              </a>
              <a className="text-link" href="https://github.com/5101good/amoji">
                {narrative[locale].invitationLink}
                <Icon name="arrow" size={16} />
              </a>
            </div>
          </div>
        </section>
      )}
    </>
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
    <section className="review-workspace" aria-labelledby="review-title">
      <div className="review-toolbar">
        <h2 id="review-title">{t.review}</h2>
        <span className="review-process">
          {locale === "zh"
            ? "内容 · 语义 · 许可"
            : "CONTENT · MEANING · LICENSE"}
        </span>
        <button
          className="secondary small"
          disabled={busy}
          onClick={() => queue()}
        >
          {t.refresh}
        </button>
      </div>
      <p className="review-status" ref={status} tabIndex={-1} role="status">
        {busy ? t.loading : message}
      </p>
      {operation && (
        <button disabled={busy} onClick={reconcile}>
          {t.reconcile}
        </button>
      )}
      <div className="review-surface">
        <aside
          className="review-inbox"
          aria-label={locale === "zh" ? "投稿队列" : "Submission queue"}
        >
          <div className="inbox-heading">
            <span>{locale === "zh" ? "待处理" : "TO REVIEW"}</span>
            <strong>
              {rows.length}
              {cursor ? "+" : ""}
            </strong>
          </div>
          <div className="review-queue">
            {rows.map((s, index) => (
              <article
                key={s.id}
                data-selected={detail?.submission.id === s.id}
              >
                <div className="queue-item-heading">
                  <span className="queue-order">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="queue-state">
                    {locale === "zh" ? "待审核" : "Pending"}
                  </span>
                </div>
                <p className="queue-title">
                  {detail?.submission.id === s.id
                    ? pick(detail.manifest.name, locale, detail.manifest.original_locale)
                    : locale === "zh"
                      ? "表情包投稿"
                      : "Pack submission"}
                </p>
                <p className="queue-version">
                  {t.version} {s.version}
                </p>
                <code>{s.pack_id}</code>
                <button
                  className="queue-inspect"
                  disabled={busy}
                  onClick={() => inspect(s.id)}
                  aria-current={
                    detail?.submission.id === s.id ? "true" : undefined
                  }
                >
                  {t.inspect}
                  <Icon name="arrow" size={17} />
                </button>
              </article>
            ))}
          </div>
          {!busy && !rows.length && (
            <p className="inbox-empty">{t.queueEmpty}</p>
          )}
          {cursor && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => queue(true)}
            >
              {t.more}
            </button>
          )}
          <p className="inbox-note">
            {locale === "zh"
              ? "每次审核对应一份不可修改的发布快照。"
              : "Every review refers to an immutable release snapshot."}
          </p>
        </aside>
        <div className="review-canvas">
          {detail ? (
            <>
              <div className="review-document-heading">
                <span className="page-eyebrow">
                  {locale === "zh"
                    ? "内容预览 / 精确版本"
                    : "CONTENT PREVIEW / EXACT VERSION"}
                </span>
                <span className="version-tag">v{detail.manifest.version}</span>
              </div>
              <ReleaseView
                data={detail}
                locale={locale}
                mediaBase={`/v1/review/submissions/${detail.submission.id}`}
              />
              <section className="review-comparison">
                <h3>{t.diff}</h3>
                {detail.previous ? (
                  <>
                    <p>
                      {t.before}: {detail.previous.release_id}
                    </p>
                    {[
                      "name",
                      "description",
                      "locales",
                      "expressions",
                      "effects",
                      "bindings",
                      "rights",
                      "derived_from",
                    ].map((field) => {
                      const before = detail.previous.manifest[field],
                        after = detail.manifest[field],
                        changed =
                          JSON.stringify(before) !== JSON.stringify(after);
                      return (
                        <details key={field}>
                          <summary>
                            {field} — {changed ? t.changed : t.same}
                          </summary>
                          {changed && (
                            <div className="review-diff">
                              <div>
                                <h4>{t.before}</h4>
                                <pre>
                                  {JSON.stringify(before ?? null, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <h4>{t.after}</h4>
                                <pre>
                                  {JSON.stringify(after ?? null, null, 2)}
                                </pre>
                              </div>
                            </div>
                          )}
                        </details>
                      );
                    })}
                  </>
                ) : (
                  <p>{t.first}</p>
                )}
              </section>
              <section className="review-decision">
                <div>
                  <span className="page-eyebrow">
                    {locale === "zh" ? "完成核对后" : "AFTER YOUR REVIEW"}
                  </span>
                  <h3>
                    {locale === "zh" ? "给出审核决定" : "Make your decision"}
                  </h3>
                </div>
                <label>
                  {t.reason}
                  <textarea
                    value={reason}
                    maxLength={2000}
                    rows={3}
                    placeholder={
                      locale === "zh"
                        ? "说明通过的依据，或需要修改的具体内容…"
                        : "Explain your decision or describe the changes needed…"
                    }
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div className="button-row">
                  <button
                    disabled={busy || !!operation || !reason.trim()}
                    onClick={() => decide("approve")}
                  >
                    <Icon name="check" size={18} />
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
              </section>
            </>
          ) : (
            <div className="review-welcome">
              <span className="page-eyebrow">
                {locale === "zh"
                  ? "表达的品质，由你把关"
                  : "A THOUGHTFUL COLLECTION STARTS HERE"}
              </span>
              <div className="review-illustration" aria-hidden="true">
                <div className="illustration-sheet">
                  <Icon name="smile" size={76} />
                </div>
                <div className="illustration-semantic">
                  <Icon name="text" size={36} />
                  <span />
                  <span />
                  <span />
                </div>
                <span className="illustration-seal">
                  <Icon name="check" size={24} />
                </span>
              </div>
              <h3>
                {locale === "zh" ? (
                  <>
                    每一份表达，
                    <br />
                    都值得认真看。
                  </>
                ) : (
                  <>
                    Good expressions.
                    <br />
                    Thoughtfully reviewed.
                  </>
                )}
              </h3>
              <p>
                {locale === "zh"
                  ? "选择一份投稿，核对图片、固定语义与发布许可。你的决定，让值得信任的表达被更多人看见。"
                  : "Choose a submission to inspect its images, fixed meanings and licenses. Help trusted expressions find their audience."}
              </p>
              <ol className="review-checkpoints">
                <li>
                  <span>01</span>
                  {locale === "zh" ? "查看完整内容" : "Inspect the content"}
                </li>
                <li>
                  <span>02</span>
                  {locale === "zh"
                    ? "核对语义与许可"
                    : "Check meaning & rights"}
                </li>
                <li>
                  <span>03</span>
                  {locale === "zh" ? "填写审核决定" : "Record your decision"}
                </li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
