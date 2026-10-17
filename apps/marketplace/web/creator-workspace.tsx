import React, { Component, Suspense, lazy } from "react";

// Archive tools and schema validators load only after sign-in.
const UploadPanel = lazy(() => import("./upload").then(m => ({ default: m.UploadPanel })));
const words = {
  zh: {
    busy: "正在处理…",
    failed: "创作者工作台暂时无法加载。请刷新页面重试，仍可浏览市场或退出登录。",
    reload: "刷新页面",
  },
  en: {
    busy: "Working…",
    failed: "Creator workspace could not load. Reload to try again. You can still browse the market or sign out.",
    reload: "Reload page",
  },
};
type Props = { locale: "zh" | "en"; accountId: string };

class CreatorBoundary extends Component<{ locale: Props["locale"]; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    const t = words[this.props.locale];
    return <section>
      <p className="note" role="alert">{t.failed}</p>
      {/* Reload also recovers stale deployment chunks and React.lazy's cached rejection. */}
      <button type="button" onClick={() => window.location.reload()}>{t.reload}</button>
    </section>;
  }
}

export function CreatorWorkspace(props: Props) {
  return <CreatorBoundary key={props.accountId} locale={props.locale}>
    <Suspense fallback={<p className="note" role="status">{words[props.locale].busy}</p>}>
      <UploadPanel {...props} />
    </Suspense>
  </CreatorBoundary>;
}
