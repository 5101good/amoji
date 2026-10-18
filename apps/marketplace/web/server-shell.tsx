import { narrative } from "./copy";
import React from "react";
import type { CatalogPage } from "../src/catalog-page";
import { Hero, PackCard } from "./gallery";
import { Icon, type Locale } from "./ui";
import { SiteHeader } from "./shell";
// Uses the same presentation primitives as the interactive gallery. No private data.
export function ServerShell({
  data,
  workspace = false,
  failed = false,
  query = "",
  locale = "zh",
}: {
  data: CatalogPage;
  workspace?: boolean;
  failed?: boolean;
  query?: string;
  locale?: Locale;
}) {
  const zh = locale === "zh";
  return (
    <>
      <SiteHeader
        locale={locale}
        view={workspace ? "studio" : "discover"}
        actions={
          <>
            <button className="language quiet" disabled>
              {zh ? "EN" : "中文"}
            </button>
            <button className="small" disabled>
              {zh ? "登录" : "Sign in"}
            </button>
          </>
        }
      />
      <main id="main" className="market-main">
        {workspace ? (
          <p role="status" className="loading-state">
            {zh ? "正在加载工作台…" : "Loading workspace…"}
          </p>
        ) : (
          <>
            <Hero locale={locale} />
            <section className="catalog" id="collections">
              <div className="collection-heading">
                <div>
                  <span className="section-index">
                    {narrative[locale].collection}
                  </span>
                  <h2>{narrative[locale].collectionTitle}</h2>
                  <p>{narrative[locale].collectionBody}</p>
                </div>
                <a className="text-link" href="/?view=studio">
                  <Icon name="plus" size={18} />
                  {zh ? "分享表情包" : "Share a pack"}
                </a>
              </div>
              <form className="catalog-search">
                <div className="search-bar">
                  <Icon name="search" />
                  <input
                    aria-label={zh ? "关键词" : "Keywords"}
                    placeholder={
                      zh
                        ? "搜索表情或场景…"
                        : "Search expressions or situations…"
                    }
                    defaultValue={new URLSearchParams(query).get("q") ?? ""}
                    disabled
                  />
                  <button disabled>{zh ? "搜索" : "Search"}</button>
                </div>
                <button className="secondary filter-toggle" disabled>
                  <Icon name="filter" />
                  {zh ? "筛选" : "Filters"}
                </button>
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
                  {zh
                    ? `已展示 ${data.packs.length} 份`
                    : `Showing ${data.packs.length}`}
                </span>
              </div>
              {failed && (
                <p className="notice error" role="status">
                  {zh
                    ? "暂时无法获取内容，请重试。"
                    : "Unable to load content. Please retry."}
                </p>
              )}
              <div className="pack-grid">
                {data.packs.map((row, index) => (
                  <PackCard
                    key={row.release_id}
                    row={row}
                    index={index}
                    locale={locale}
                  />
                ))}
              </div>
              {!failed && !data.packs.length && (
                <p className="empty-state">
                  {zh
                    ? "这里，等着第一份表达。"
                    : "The first expression is on its way."}
                </p>
              )}
              {data.cursor && (
                <div className="load-more">
                  <button className="secondary" disabled>
                    {zh ? "加载更多" : "Load more"}
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
