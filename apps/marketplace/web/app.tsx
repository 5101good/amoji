import { narrative } from "./copy";
import { catalogPage, type CatalogPage } from "../src/catalog-page";
import { Lifecycle } from "./lifecycle";
import { DeviceApproval } from "./device";
import { Catalog, Reviews } from "./market";
import React, { useEffect, useState } from "react";
import { CreatorWorkspace } from "./creator-workspace";
import { Brand } from "./gallery";
import { SiteHeader } from "./shell";
import { Icon, Modal, EmptyState } from "./ui";
import { createRoot } from "react-dom/client";
const words = {
  zh: {
    market: "表情市场",
    headline: "让协作，多一点默契。",
    intro: "人看懂表情，AI 读懂含义。在 Amoji 分享你的表达方式。",
    login: "登录",
    register: "创建账号",
    email: "邮箱",
    password: "密码",
    name: "显示名称",
    hint: "至少 12 个字符，请使用独有的长密码。",
    notice: "无需验证邮件。目前不提供邮件找回，请妥善保存密码。",
    logout: "退出登录",
    account: "你的账号",
    unverified: "邮箱仅用作登录标识，未经验证。",
    welcome: "已登录",
    busy: "正在处理…",
    retry: "暂时无法连接，请稍后重试。",
    invalid: "邮箱或密码不正确。",
    failed: "无法创建账号。请检查输入；已有账号请登录。",
    limited: "尝试过于频繁，请 15 分钟后重试。",
    opensource: "开源项目",
    change: "已有账号？登录",
    create: "第一次来？创建账号",
    role: "创作者",
  },
  en: {
    market: "Expression marketplace",
    headline: "A little more understanding.",
    intro:
      "People see expressions. AI reads their meaning. Share your way of communicating with Amoji.",
    login: "Sign in",
    register: "Create account",
    email: "Email",
    password: "Password",
    name: "Display name",
    hint: "At least 12 characters. Use a unique, long password.",
    notice:
      "No verification email is needed. Email recovery is unavailable; keep your password safe.",
    logout: "Sign out",
    account: "Your account",
    unverified: "Email is an unverified sign-in identifier.",
    welcome: "Signed in",
    busy: "Working…",
    retry: "Unable to connect. Please try again later.",
    invalid: "Email or password is incorrect.",
    failed:
      "Unable to create your account. Check your input, or sign in if you already have one.",
    limited: "Too many attempts. Try again in 15 minutes.",
    opensource: "Open source",
    change: "Already registered? Sign in",
    create: "New here? Create account",
    role: "Creator",
  },
};
type Account = { id: string; name: string; email: string; role: string };
type View = "discover" | "studio" | "review" | "account" | "connect";
const requestedView = new URLSearchParams(location.search).get("view");
const view: View = new URLSearchParams(location.search).has("authorization")
  ? "connect"
  : ["studio", "review", "account"].includes(requestedView ?? "")
    ? (requestedView as View)
    : "discover";
const initialCatalog = (() => {
  const node = document.getElementById("catalog-bootstrap");
  try {
    return location.pathname === "/" && view === "discover" && node
      ? catalogPage(JSON.parse(node.textContent ?? ""))
      : undefined;
  } catch {
    return undefined;
  } finally {
    node?.remove();
  }
})();
function App({ initial }: { initial?: CatalogPage }) {
  const [locale, setLocale] = useState<"zh" | "en">(() => {
    try {
      return localStorage.getItem("amoji-market-language") === "en"
        ? "en"
        : "zh";
    } catch {
      return "zh";
    }
  });
  const t = words[locale],
    zh = locale === "zh";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [account, setAccount] = useState<Account | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const canReview = !!account && ["reviewer", "admin"].includes(account.role);
  useEffect(() => {
    document.documentElement.lang = zh ? "zh-CN" : "en";
    document.title = zh ? "Amoji · 表情市场" : "Amoji · Expression marketplace";
    document.cookie = `amoji-market-language=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.dataset.appReady = "true";
    try {
      localStorage.setItem("amoji-market-language", locale);
    } catch {
      /* Storage is optional. */
    }
  }, [locale]);
  async function me() {
    const r = await fetch("/v1/me");
    if (r.ok) setAccount(((await r.json()) as { account: Account }).account);
    else if (r.status === 401 || r.status === 403) setAccount(null);
    else throw Error("network");
  }
  async function check() {
    setBusy(true);
    setMessage("");
    try {
      await me();
    } catch {
      setMessage(t.retry);
    } finally {
      setBusy(false);
      setChecked(true);
    }
  }
  useEffect(() => {
    void check();
  }, []);
  async function operation(route: string, body: object) {
    setBusy(true);
    setMessage("");
    try {
      const c = await fetch("/v1/auth/csrf");
      if (!c.ok) throw Error("network");
      const { csrf } = (await c.json()) as { csrf: string };
      const r = await fetch(`/v1/auth/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        setMessage(
          r.status === 429
            ? t.limited
            : route === "login"
              ? t.invalid
              : route === "register"
                ? t.failed
                : t.retry,
        );
        return;
      }
      if (route === "logout") {
        setAccount(null);
        setMode("login");
      } else {
        await me();
        setAuthOpen(false);
      }
    } catch {
      setMessage(t.retry);
    } finally {
      setBusy(false);
    }
  }
  const openAuth = () => {
    setMessage("");
    setAuthOpen(true);
  };
  const names: Record<View, string> = {
    discover: zh ? "发现表情" : "Discover",
    studio: zh ? "创作工作台" : "Creator studio",
    review: zh ? "内容审核" : "Review",
    account: zh ? "账号与内容管理" : "Account & publications",
    connect: zh ? "连接你的 dsh" : "Connect your dsh",
  };
  return (
    <>
      <a className="skip-link" href="#main">
        {zh ? "跳到主要内容" : "Skip to content"}
      </a>
      <SiteHeader
        locale={locale}
        view={view}
        canReview={canReview}
        actions={
          <>
            <button
              className="language quiet"
              onClick={() => {
                setLocale(zh ? "en" : "zh");
                setMessage("");
              }}
              aria-label={zh ? "Switch to English" : "切换到中文"}
            >
              {zh ? "EN" : "中文"}
            </button>
            {account ? (
              <a
                className="account-link"
                href="/?view=account"
                aria-current={view === "account" ? "page" : undefined}
              >
                <span className="avatar">{Array.from(account.name)[0]}</span>
                <span>{account.name}</span>
              </a>
            ) : (
              <button className="small" disabled={busy} onClick={openAuth}>
                {t.login}
              </button>
            )}
          </>
        }
      />
      <main
        id="main"
        tabIndex={-1}
        className={
          view === "discover"
            ? "market-main"
            : `workspace-main workspace-${view}`
        }
      >
        {message && !authOpen && (
          <div className="notice" role="status">
            {message}{" "}
            <button className="quiet" disabled={busy} onClick={check}>
              {zh ? "重试" : "Retry"}
            </button>
          </div>
        )}
        {view === "discover" ? (
          <Catalog locale={locale} initial={initial} />
        ) : (
          <>
            <div className="workspace-heading">
              <div>
                <p className="page-eyebrow">
                  {view === "review"
                    ? zh
                      ? "内容策展 / 审核工作台"
                      : "CURATION / REVIEW DESK"
                    : view === "studio"
                      ? zh
                        ? "创作空间 / 发布作品"
                        : "CREATOR SPACE / PUBLISH"
                      : zh
                        ? "你的 AMOJI"
                        : "YOUR AMOJI"}
                </p>
                <h1>{names[view]}</h1>
                <p>
                  {view === "studio"
                    ? zh
                      ? "把你与 AI 的默契，分享给更多人。"
                      : "Share the expressions that make working with AI feel like you."
                    : view === "review"
                      ? zh
                        ? "核对每一份表达，让值得信任的内容被看见。"
                        : "Help thoughtful, trusted expressions find their audience."
                      : view === "connect"
                        ? zh
                          ? "确认设备后，回到 dsh 继续发布。"
                          : "Confirm your device, then return to dsh to continue."
                        : zh
                          ? "管理你的身份、公开内容与数据。"
                          : "Manage your identity, publications and data."}
                </p>
              </div>
              {account && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => operation("logout", {})}
                >
                  {t.logout}
                </button>
              )}
            </div>
            {!checked ? (
              <p className="loading-state" role="status">
                {t.busy}
              </p>
            ) : !account ? (
              <EmptyState title={zh ? "登录后继续" : "Sign in to continue"}>
                <p>
                  {zh
                    ? "浏览和下载无需账号。登录后即可投稿、管理内容和连接 dsh。"
                    : "No account needed to explore or download. Sign in to publish, manage content and connect dsh."}
                </p>
                <button onClick={openAuth}>{t.login}</button>
              </EmptyState>
            ) : (
              <>
                {view === "studio" && (
                  <CreatorWorkspace locale={locale} accountId={account.id} />
                )}
                {view === "review" &&
                  (canReview ? (
                    <Reviews
                      key={account.id + ":review"}
                      locale={locale}
                      accountId={account.id}
                    />
                  ) : (
                    <EmptyState
                      title={
                        zh
                          ? "此页面仅对审核者开放"
                          : "This area is for reviewers"
                      }
                    >
                      <p>
                        {zh
                          ? "你可以在创作工作台查看自己的投稿。"
                          : "Visit your creator studio to see your submissions."}
                      </p>
                      <a className="button" href="/?view=studio">
                        {names.studio}
                      </a>
                    </EmptyState>
                  ))}
                {view === "account" && (
                  <div className="account-layout">
                    <aside className="profile-summary">
                      <span className="avatar large">
                        {Array.from(account.name)[0]}
                      </span>
                      <div>
                        <h2>{account.name}</h2>
                        <p>{account.email}</p>
                        <span className="account-role">
                          {zh
                            ? ({
                                creator: "创作者",
                                reviewer: "审核者",
                                moderator: "内容管理员",
                                admin: "管理员",
                              }[account.role] ?? account.role)
                            : account.role}
                        </span>
                        <small>{t.unverified}</small>
                      </div>
                      <nav
                        aria-label={zh ? "账号快捷入口" : "Account shortcuts"}
                      >
                        <a href="/?view=studio">
                          <Icon name="grid" size={16} />
                          {zh ? "我的创作" : "My creations"}
                        </a>
                        <a href="/">
                          <Icon name="smile" size={16} />
                          {zh ? "浏览表情作品" : "Explore expressions"}
                        </a>
                      </nav>
                    </aside>
                    <Lifecycle
                      key={account.id}
                      account={account}
                      locale={locale}
                      onDeleted={() => setAccount(null)}
                    />
                  </div>
                )}
                {view === "connect" && <DeviceApproval locale={locale} />}
              </>
            )}
          </>
        )}
      </main>
      <footer className="site-footer">
        <div>
          <Brand />
          <p>{narrative[locale].footer}</p>
        </div>
        <div className="footer-links">
          <a href="https://github.com/5101good/amoji">
            GitHub
            <Icon name="arrow" size={14} />
          </a>
          <a
            href={`https://github.com/5101good/amoji/blob/main/README${zh ? "" : ".en"}.md`}
          >
            {zh ? "使用指南" : "Guide"}
          </a>
          <span>
            {zh ? "开源 · 自由表达" : "Open source. Yours to express."}
          </span>
        </div>
      </footer>
      {authOpen && (
        <Modal
          locale={locale}
          title={
            mode === "login" ? (zh ? "欢迎回来" : "Welcome back") : t.register
          }
          close={() => setAuthOpen(false)}
        >
          <p className="auth-intro">
            {zh
              ? "用你的表达，让协作更自然。"
              : "Make working together feel more natural."}
          </p>
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const body = {
                email: String(f.get("email")),
                password: String(f.get("password")),
              };
              void operation(
                mode,
                mode === "register"
                  ? { ...body, name: String(f.get("name")) }
                  : body,
              );
            }}
          >
            {mode === "register" && (
              <label>
                {t.name}
                <input
                  name="name"
                  autoComplete="nickname"
                  maxLength={80}
                  required
                  disabled={busy}
                />
              </label>
            )}
            <label>
              {t.email}
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                maxLength={254}
                required
                disabled={busy}
              />
            </label>
            <label>
              {t.password}
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                minLength={12}
                maxLength={128}
                required
                disabled={busy}
                aria-describedby="password-hint"
              />
            </label>
            <p id="password-hint" className="note">
              {t.hint}
            </p>
            {message && (
              <p className="notice error" role="alert">
                {message}
              </p>
            )}
            <button disabled={busy}>
              {busy ? t.busy : mode === "login" ? t.login : t.register}
            </button>
            <p className="note">{t.notice}</p>
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setMessage("");
              }}
            >
              {mode === "login" ? t.create : t.change}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <App initial={initialCatalog} />,
);
