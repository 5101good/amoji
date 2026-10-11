import {DeviceApproval} from "./device";
import { Catalog, Reviews } from "./market";
import { UploadPanel } from "./upload";
import React, { useEffect, useState } from "react";
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
function App() {
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  const t = words[locale];
  const [mode, setMode] = useState<"login" | "register">("login");
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  async function me() {
    const r = await fetch("/v1/me");
    if (r.ok) setAccount(((await r.json()) as { account: Account }).account);
    else if (r.status === 401 || r.status === 403) setAccount(null);
    else throw Error("network");
  }
  useEffect(() => {
    me()
      .catch(() => setMessage(t.retry))
      .finally(() => setBusy(false));
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
      if (route === "logout") setMode("login");
      await me();
    } catch {
      setMessage(t.retry);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header>
        <a className="brand" href="/">
          amoji<span>{t.market}</span>
        </a>
        <button
          className="language"
          onClick={() => {
            setLocale(locale === "zh" ? "en" : "zh");
            setMessage("");
          }}
        >
          {locale === "zh" ? "English" : "中文"}
        </button>
      </header>
      <main className="creator-page">
        <Catalog locale={locale} />
        <section className="intro">
          <div className="expression" aria-hidden="true">
            ( ◡‿◡ )
          </div>
          <h1>{t.headline}</h1>
          <p>{t.intro}</p>
        </section>
        <section className="access" aria-labelledby="account-title">
          <h2 id="account-title">
            {account ? t.account : mode === "login" ? t.login : t.register}
          </h2>
          {account ? (
            <>
              <DeviceApproval locale={locale}/><p className="welcome">{account.name}</p>
              <p>{account.email}</p>
              <p className="note">{t.unverified}</p>
              {["reviewer", "admin"].includes(account.role) && (
                <Reviews
                  key={account.id + ":review"}
                  locale={locale}
                  accountId={account.id}
                />
              )}
              <UploadPanel
                key={account.id}
                locale={locale}
                accountId={account.id}
              />
              <button disabled={busy} onClick={() => operation("logout", {})}>
                {busy ? t.busy : t.logout}
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const data = {
                  email: String(f.get("email")),
                  password: String(f.get("password")),
                };
                operation(
                  mode,
                  mode === "register"
                    ? { ...data, name: String(f.get("name")) }
                    : data,
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
              <button disabled={busy} type="submit">
                {busy ? t.busy : mode === "login" ? t.login : t.register}
              </button>
              <p className="note recovery">{t.notice}</p>
              <button
                className="switch"
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setMessage("");
                }}
              >
                {mode === "login" ? t.create : t.change}
              </button>
            </form>
          )}
          <p className="status" role="status" aria-live="polite">
            {message}
          </p>
        </section>
      </main>
      <footer>
        <span>Amoji</span>
        <a href="https://github.com/5101good/amoji">{t.opensource}</a>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
