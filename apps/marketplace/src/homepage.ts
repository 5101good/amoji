import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerShell } from "../web/server-shell";
import { catalogPage } from "./catalog-page";
const MAX_SUMMARY_BYTES = 512 * 1024;
async function boundedText(
  response: Response,
  maximum: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw Error("EMPTY_RESPONSE");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw Error("RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export async function homepage(
  template: Response,
  catalog: Response,
  workspace = false,
  query = "",
  locale: "zh" | "en" = "zh",
): Promise<Response> {
  if (!template.ok) {
    await catalog.body?.cancel();
    throw Error("TEMPLATE_UNAVAILABLE");
  }
  const [source, json] = await Promise.all([
    boundedText(template, 64 * 1024),
    boundedText(catalog, MAX_SUMMARY_BYTES),
  ]);
  // Hash only the trusted build template, before inserting any catalog content.
  const css = /<style data-amoji-base>([\s\S]*?)<\/style>/.exec(source)?.[1];
  const styleHash = css
    ? btoa(
        String.fromCharCode(
          ...new Uint8Array(
            await crypto.subtle.digest("SHA-256", new TextEncoder().encode(css)),
          ),
        ),
      )
    : null;
  let status = catalog.status;
  let data: ReturnType<typeof catalogPage> = { packs: [], cursor: null };
  if (catalog.ok) {
    try {
      data = catalogPage(JSON.parse(json));
    } catch {
      status = 503;
    }
  }
  const failed = status !== 200;
  const placeholder = '<div id="root"></div>';
  if (!source.includes(placeholder)) throw Error("INVALID_TEMPLATE");
  // Keep untrusted catalog data inert and outside the React root.
  const bootstrap = failed
    ? ""
    : `<div id="catalog-bootstrap" hidden>${escape(JSON.stringify(data))}</div>`;
  const shell =
    '<div id="root">' +
    renderToStaticMarkup(
      React.createElement(ServerShell, {
        data,
        workspace,
        failed,
        query,
        locale,
      }),
    ) +
    "</div>";
  return new Response(
    source
      .replace('lang="zh-CN"', locale === "en" ? 'lang="en"' : 'lang="zh-CN"')
      .replace(
        "Amoji · 表情市场",
        locale === "en" ? "Amoji · Expression marketplace" : "Amoji · 表情市场",
      )
      .replace(placeholder, () => shell + bootstrap),
    {
      status,
      headers: {
        ...(catalog.headers.has("retry-after")
          ? { "retry-after": catalog.headers.get("retry-after")! }
          : {}),
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          `default-src 'self'; script-src 'self'; style-src 'self'${styleHash ? ` 'sha256-${styleHash}'` : ""}; connect-src 'self' https://5e76b121867f4d57af8fb17fd0afbcfb.r2.cloudflarestorage.com; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "x-frame-options": "DENY",
      },
    },
  );
}
