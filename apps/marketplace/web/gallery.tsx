import React, { useEffect, useRef, useState } from "react";
import type { CatalogPage } from "../src/catalog-page";
import { Icon, type Locale } from "./ui";
import { exhibit } from "./exhibit";
import { useArtworkDepth, useSceneProgress } from "./motion";
import { narrative } from "./copy";
export function Brand() {
  return (
    <a className="brand" href="/" aria-label="Amoji">
      <img src="/art/brand.webp" alt="Amoji" width="127" height="44" />
    </a>
  );
}
export function Hero({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  const [selected, setSelected] = useState(0);
  const artworkRef = useArtworkDepth();
  const sceneRef = useSceneProgress("departure");
  const encounterRef = useSceneProgress("arrival");
  const copy = narrative[locale];
  const example = exhibit[selected];
  const words = example[locale];
  return (
    <section
      className="market-hero"
      aria-label={zh ? "认识 AI 原生表情" : "Meet AI-native expressions"}
    >
      <div className="hero-scene" ref={sceneRef}>
        <div className="hero-artwork" ref={artworkRef}>
          <div className="hero-orbit orbit-back" aria-hidden="true" />
          <img
            className="hero-sculpture"
            src="/art/expression-future.webp"
            alt=""
            width="1536"
            height="1024"
            fetchPriority="high"
          />
          <div className="hero-glass glass-far" aria-hidden="true" />
          <div className="hero-glass glass-near" aria-hidden="true">
            <span className="glass-engraving">Amoji</span>
          </div>
          <div className="hero-light" aria-hidden="true" />
          <div className="hero-copy">
            <p className="hero-kicker">
              <span aria-hidden="true" />
              {copy.kicker}
            </p>
            <h1 lang={zh ? "zh-CN" : "en"}>
              <span>{copy.title[0]}</span>
              <span>{copy.title[1]}</span>
            </h1>
            <p className="hero-description">{copy.description}</p>
            <div className="hero-actions">
              <a className="hero-cta" href="#collections">
                {copy.discover}
                <span>
                  <Icon name="arrow" size={22} />
                </span>
              </a>
              <a className="hero-explore" href="#expression-language">
                {copy.explore}
                <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
          <div className="artwork-caption">
            <span>{copy.caption}</span>
            <span>{zh ? "Amoji 原创视觉" : "An Amoji original"}</span>
          </div>
        </div>
      </div>
      <section className="human-premise" aria-labelledby="premise-title">
        <div className="premise-rule" aria-hidden="true">
          <span />
        </div>
        <h2 id="premise-title">{copy.premise}</h2>
        <div className="premise-copy">
          <p>{copy.premiseBody}</p>
          <p>{copy.premiseEnd}</p>
        </div>
      </section>
      <section
        className="expression-language"
        id="expression-language"
        aria-labelledby="language-title"
        ref={encounterRef}
      >
        <div className="exhibit-heading">
          <h2 id="language-title">
            <span>{copy.encounterTitle[0]}</span>
            <span>{copy.encounterTitle[1]}</span>
          </h2>
          <p>{copy.encounterBody}</p>
        </div>
        <div className="semantic-orbit" aria-hidden="true" />
        <div className="expression-exhibit">
          <div
            className="semantic-bridge"
            key={example.id + "bridge"}
            aria-hidden="true"
          >
            <span />
          </div>

          <div className="exhibit-stage" data-expression={example.id}>
            <span className="exhibit-label">
              {zh ? "你看到的表情" : "What you see"}
            </span>
            <img
              key={example.id}
              src={`/art/${example.id}.webp`}
              alt={words.name}
              width="260"
              height="260"
              loading="lazy"
            />
            <div className="exhibit-caption">
              <span>{words.name}</span>
              <span>{zh ? "经典系列" : "Classic collection"}</span>
            </div>
          </div>
          <div
            className="exhibit-meaning"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="meaning-heading">
              <span className="meaning-symbol" aria-hidden="true">
                <Icon name="text" size={18} />
              </span>
              <span>{zh ? "AI 读到的含义" : "What AI reads"}</span>
            </div>
            <p
              key={example.id + locale}
              className="meaning-quote"
              lang={zh ? "zh-CN" : "en"}
            >
              {words.meaning}
            </p>
            <p className="meaning-tone">{words.tone}</p>
            <div className="meaning-footnote">
              <span className="semantic-dot" aria-hidden="true" />
              {zh
                ? "固定文字语义，无需识图"
                : "Fixed text meaning. No image recognition."}
            </div>
          </div>
          <div
            className="exhibit-picker"
            role="group"
            aria-label={zh ? "试着换一个表情" : "Try another expression"}
          >
            <p>{zh ? "此刻，你想说什么？" : "What would you like to say?"}</p>
            <div className="exhibit-options">
              {exhibit.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected === i}
                  aria-label={(zh ? "预览：" : "Preview: ") + item[locale].name}
                  onClick={() => setSelected(i)}
                >
                  <img
                    src={`/art/${item.id}.webp`}
                    width="46"
                    height="46"
                    alt=""
                  />
                  <span>{item[locale].name}</span>
                </button>
              ))}
            </div>
            <span className="exhibit-credit">
              {zh ? "Amoji 原创系列" : "Amoji Originals"}
            </span>
          </div>
        </div>
      </section>
    </section>
  );
}
function CoverImage({ src }: { src: string }) {
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <img
      loading="lazy"
      decoding="async"
      src={src + (attempt ? `?retry=${attempt}` : "")}
      alt=""
      width="200"
      height="200"
      onError={(e) => {
        if (attempt < 2)
          timer.current = setTimeout(
            () => setAttempt(attempt + 1),
            attempt === 0 ? 1000 : 3000,
          );
        else e.currentTarget.hidden = true;
      }}
    />
  );
}
export function PackCard({
  row,
  locale,
  index = 0,
}: {
  row: CatalogPage["packs"][number];
  locale: Locale;
  index?: number;
}) {
  const url = `/packs/${row.pack_id}/releases/${row.release_id}`;
  const zh = locale === "zh";
  return (
    <article className="catalog-row">
      <a
        className={`pack-art mat-${index % 4}`}
        href={url}
        tabIndex={-1}
        aria-hidden="true"
      >
        <Icon name="smile" size={76} />
        {row.cover && (
          <CoverImage
            src={`/v1/packs/${row.pack_id}/releases/${row.release_id}/cover`}
          />
        )}
        <span className="art-corner">
          <Icon name="arrow" size={18} />
        </span>
      </a>
      <div className="pack-info">
        <div className="pack-meta">
          <span>
            {row.manifest.scenario[0] ||
              (zh ? "表达与协作" : "Expression & collaboration")}
          </span>
          {row.expression_count != null && (
            <span>
              {row.expression_count} {zh ? "个表情" : "expressions"}
            </span>
          )}
        </div>
        <h3>
          <a href={url}>{row.manifest.name}</a>
        </h3>
        {row.manifest.description && (
          <p className="pack-description">{row.manifest.description}</p>
        )}
        <div className="pack-footer">
          <span className="author">
            <span className="avatar" aria-hidden="true">
              {Array.from(row.author)[0] ?? "A"}
            </span>
            {row.author}
          </span>
          {!!row.action_count && (
            <span className="action-badge">
              {zh ? "含协作提示" : "With guidance"}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
