import React from "react";
import { Brand } from "./gallery";
import { Icon, type Locale } from "./ui";

export function SiteHeader({
  locale,
  view = "discover",
  canReview = false,
  actions,
}: {
  locale: Locale;
  view?: string;
  canReview?: boolean;
  actions: React.ReactNode;
}) {
  const zh = locale === "zh";
  const nav = [
    {
      id: "discover",
      href: "/",
      label: zh ? "发现表情" : "Discover",
      icon: "grid" as const,
    },
    {
      id: "studio",
      href: "/?view=studio",
      label: zh ? "创作工作台" : "Creator studio",
      icon: "plus" as const,
    },
    ...(canReview
      ? [
          {
            id: "review",
            href: "/?view=review",
            label: zh ? "内容审核" : "Review",
            icon: "check" as const,
          },
        ]
      : []),
  ];
  return (
    <header className="topbar">
      <Brand />
      <nav
        className="primary-nav"
        aria-label={zh ? "主导航" : "Main navigation"}
      >
        {nav.map((n) => (
          <a
            key={n.id}
            href={n.href}
            aria-current={view === n.id ? "page" : undefined}
          >
            <Icon name={n.icon} size={17} />
            <span>{n.label}</span>
          </a>
        ))}
      </nav>
      <div className="header-actions">{actions}</div>
    </header>
  );
}
