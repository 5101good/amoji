import { catalogPage } from './catalog-page';
const MAX_SUMMARY_BYTES = 512 * 1024;
async function boundedText(response: Response, maximum: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw Error('EMPTY_RESPONSE');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw Error('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function homepage(template: Response, catalog: Response): Promise<Response> {
  if (!catalog.ok) { await template.body?.cancel(); return catalog; }
  if (!template.ok) { await catalog.body?.cancel(); throw Error('TEMPLATE_UNAVAILABLE'); }
  const [source, json] = await Promise.all([boundedText(template, 64 * 1024), boundedText(catalog, MAX_SUMMARY_BYTES)]);
  const data = catalogPage(JSON.parse(json));
  const placeholder = '<div id="root"></div>';
  if (!source.includes(placeholder)) throw Error('INVALID_TEMPLATE');
  const rows = data.packs.map(row => `<article class="catalog-row"><h3><a href="/packs/${row.pack_id}/releases/${row.release_id}">${escape(row.manifest.name)}</a></h3><p>${escape(row.manifest.description ?? '')}</p><p>${escape(row.manifest.scenario.join(' · '))} · ${escape(row.author)} · 版本 ${row.manifest.version}</p></article>`).join('');
  // Inert text, outside the React root. Never embed user content in a script.
  const bootstrap = `<div id="catalog-bootstrap" hidden>${escape(JSON.stringify(data))}</div>`;
  const filters = [['q', '关键词'], ['scenario', '场景'], ['locale', '语义语言'], ['style', '画风']].map(([name, label]) => `<label>${label}<input name="${name}" maxlength="256" disabled></label>`).join('');
  const shell = `<div id="root"><header><a class="brand" href="/">amoji<span>表情市场</span></a><button class="language" disabled>English</button></header><main class="creator-page"><section class="creator catalog"><h2>发现场景包</h2><form class="market-filters">${filters}<label>协作动作<select disabled><option>全部</option></select></label><button disabled>搜索</button></form><p role="status">${data.packs.length ? '' : '没有匹配的公开内容。'}</p>${rows}${data.cursor ? '<button disabled>加载更多</button>' : ''}</section></main></div>`;
  return new Response(source.replace(placeholder, shell + bootstrap), {
    headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://5e76b121867f4d57af8fb17fd0afbcfb.r2.cloudflarestorage.com; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'DENY',
    },
  });
}
