const $ = id => document.getElementById(id);
const capability = location.hash.slice(1);
const headers = { Authorization: `Bearer ${capability}`, 'Content-Type': 'application/json' };
let state;
let selected;
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let paused = motionPreference.matches;
let previous = '';
let searchVersion = 0;
let renderVersion = 0;
let disposed = false;
const hostLabel = (snapshot = state) => snapshot?.host === 'claude-code' ? 'Claude Code' : 'Codex';
const blobs = new Map();
const blobLoads = new Map();
const objectUrls = new Set();
async function api(path, body) {
  const response = await fetch(`/api/${path}`, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '连接失败');
  return data;
}
async function blobUrl(blob) {
  if (disposed) throw new Error('页面已关闭');
  const cached = blobs.get(blob.sha256);
  if (cached) return cached;
  let load = blobLoads.get(blob.sha256);
  if (!load) {
    const controller = new AbortController();
    const promise = (async () => {
      const response = await fetch(`/blobs/${blob.sha256}`, { headers, signal: controller.signal });
      if (!response.ok) {
        let reason = '素材不可用';
        try { reason = (await response.json()).error || reason; } catch {}
        throw new Error(reason);
      }
      const data = await response.blob();
      if (disposed) throw new Error('页面已关闭');
      const url = URL.createObjectURL(data);
      objectUrls.add(url);
      if (disposed) {
        objectUrls.delete(url);
        URL.revokeObjectURL(url);
        throw new Error('页面已关闭');
      }
      blobs.set(blob.sha256, url);
      return url;
    })();
    load = { controller, promise };
    blobLoads.set(blob.sha256, load);
  }
  try { return await load.promise; }
  finally { if (blobLoads.get(blob.sha256) === load) blobLoads.delete(blob.sha256); }
}
function beginRender() {
  const version = ++renderVersion;
  const receipts = [];
  let committed = false;
  const current = () => !disposed && version === renderVersion;
  return {
    current,
    report(effect) {
      if (!current()) return;
      if (committed) effect(); else receipts.push(effect);
    },
    commit() {
      if (!current()) return false;
      committed = true;
      for (const effect of receipts.splice(0)) effect();
      return true;
    },
  };
}
async function picture(expression, messageId, pausedSnapshot = paused, lifecycle = { current: () => !disposed, report: effect => effect() }) {
  const image = document.createElement('img');
  let output = image;
  image.alt = expression.semantics.fallback;
  const blob = pausedSnapshot && expression.visual.poster ? expression.visual.poster : expression.visual.primary;
  let reported = false;
  const report = presentation => {
    if (reported || !messageId || !lifecycle.current()) return;
    reported = true;
    lifecycle.report(() => { if (lifecycle.current()) void api('ack', { message_id: messageId, presentation }).catch(() => {}); });
  };
  const fallback = reason => {
    if (!lifecycle.current()) return;
    const text = document.createElement('div'); text.className = 'placeholder'; text.setAttribute('role', 'alert'); text.textContent = `${expression.semantics.fallback} · ${reason}`;
    if (image.parentNode) image.replaceWith(text); else output = text;
    report('fallback');
  };
  image.onerror = () => fallback('浏览器无法解码图片');
  image.onload = () => report('rendered');
  try {
    const url = await blobUrl(blob);
    if (lifecycle.current()) image.src = url;
  } catch (error) { fallback(error instanceof Error ? error.message : '素材不可用'); }
  return output;
}
function text(tag, value, className) { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; }
function definition(expression) {
  const details = document.createElement('details');
  details.append(text('summary', '查看完整固定语义与版本'), text('pre', JSON.stringify({ asset_id: expression.asset_id, revision_id: expression.revision_id, name: expression.name, semantics: expression.semantics }, null, 2)));
  return details;
}
function preview(snapshot = state) {
  $('preview').replaceChildren();
  if (!selected) { $('preview').append(text('p', '选一个表情，看看它想表达什么。')); }
  else {
    $('preview').append(text('h2', selected.name), text('p', selected.semantics.meaning));
    if (selected.semantics.tone) $('preview').append(text('p', selected.semantics.tone, 'avoid'));
    if (selected.semantics.use_when?.length) $('preview').append(text('p', `适用于：${selected.semantics.use_when.join('；')}`, 'avoid'));
    if (selected.semantics.avoid_when?.length) $('preview').append(text('p', `不适用于：${selected.semantics.avoid_when.join('；')}`, 'avoid'));
    $('preview').append(definition(selected));
  }
  $('send').disabled = !selected || !snapshot?.pending_pick;
  $('cancel').disabled = !snapshot?.pending_pick;
  for (const button of $('catalog').children) button.setAttribute('aria-pressed', String(button.dataset.revision === selected?.revision_id));
}
async function render() {
  const snapshot = state;
  const pausedSnapshot = paused;
  const round = beginRender();
  await applySearch(undefined, snapshot, pausedSnapshot, round.current);
  const history = document.createDocumentFragment();
  if (!snapshot.messages.length) history.append(text('p', '还没有表情。\n一点心意，从这里开始。', 'empty'));
  for (const message of snapshot.messages) {
    const article = document.createElement('article'); article.className = 'message';
    article.append(text('span', message.direction === 'human_to_ai' ? '你 → AI' : 'AI → 你', 'direction'), await picture(message.revision, message.message_id, pausedSnapshot, round), text('p', message.revision.semantics.meaning), text('small', message.message_id.slice(0, 8)));
    article.append(definition(message.revision));
    history.append(article);
  }
  if (!round.current()) return;
  const label = snapshot.session_id.slice(-8);
  document.title = `Amoji · ${label}`;
  $('session').textContent = label;
  const host = hostLabel(snapshot);
  $('session').title = `${host} 会话 ${snapshot.session_id}`;
  $('send').textContent = `发送到 ${host}`;
  $('history-hint').textContent = `此 ${host} 会话的表情记录保存在本机，重新打开后仍可查看。`;
  const skill = snapshot.host === 'claude-code' ? '/amoji:amoji' : '/amoji';
  $('connection').textContent = snapshot.pending_pick ? `已关联 ${host} · ${label}，正在等待你选择` : `已关联 ${host} · ${label}。在会话中调用 ${skill} 可再次选择。`;
  $('messages').replaceChildren(history);
  preview(snapshot);
  round.commit();
}
async function buildCatalog(expressions, pausedSnapshot, current) {
  const fragment = document.createDocumentFragment();
  for (const expression of expressions) {
    const button = document.createElement('button'); button.className = 'sticker'; button.dataset.revision = expression.revision_id; button.setAttribute('aria-pressed', 'false');
    button.append(await picture(expression, undefined, pausedSnapshot, { current, report: effect => effect() }), text('span', expression.name, 'name'));
    button.onclick = () => { selected = expression; preview(); };
    fragment.append(button);
  }
  return fragment;
}
async function applySearch(event, snapshot = state, pausedSnapshot = paused, parentCurrent = () => !disposed) {
  event?.preventDefault();
  const version = ++searchVersion;
  const query = $('search').value;
  try {
    const expressions = query.trim() ? (await api(`search?query=${encodeURIComponent(query)}&limit=5`)).expressions : snapshot.expressions;
    if (version !== searchVersion || !parentCurrent()) return;
    const fragment = await buildCatalog(expressions, pausedSnapshot, () => version === searchVersion && parentCurrent());
    if (version !== searchVersion || !parentCurrent()) return;
    const nextSelected = selected && expressions.some(expression => expression.asset_id === selected.asset_id && expression.revision_id === selected.revision_id) ? selected : undefined;
    selected = nextSelected;
    $('catalog').replaceChildren(fragment);
    $('search-status').textContent = query.trim() ? (expressions.length ? `找到 ${expressions.length} 个候选。` : '没有合适的表情，可以继续用文字表达。') : `当前可选 ${expressions.length} 个表情。`;
    preview(snapshot);
  } catch (error) {
    if (version !== searchVersion || !parentCurrent()) return;
    $('search-status').textContent = error.message;
  }
}
async function refresh() {
  try {
    state = await api('state');
    $('connection').classList.remove('disconnected');
    // Presentation receipts do not rebuild loaded images or restart animation.
    const comparable = JSON.stringify({ ...state, messages: state.messages.map(({ presentation, ...rest }) => rest) });
    if (comparable !== previous) { previous = comparable; await render(); }
  } catch (error) { $('connection').textContent = `连接已断开：${error.message}`; $('connection').classList.add('disconnected'); $('send').disabled = true; $('cancel').disabled = true; }
}
function setPaused(next) {
  if (paused === next) return;
  paused = next;
  $('motion').textContent = paused ? '播放动图' : '暂停动图';
  $('motion').setAttribute('aria-pressed', String(paused));
  if (state) void render();
}
$('motion').onclick = () => setPaused(!paused);
motionPreference.addEventListener?.('change', event => { if (event.matches) setPaused(true); });
$('motion').textContent = paused ? '播放动图' : '暂停动图';
$('motion').setAttribute('aria-pressed', String(paused));
$('search-form').onsubmit = event => { void applySearch(event); };
$('clear-search').onclick = () => { $('search').value = ''; void applySearch(); };
$('send').onclick = async () => {
  if (!selected || !state?.pending_pick) return;
  $('send').disabled = true;
  try { await api('select', { pick_id: state.pending_pick, asset_id: selected.asset_id, revision_id: selected.revision_id }); $('status').textContent = `已提交固定语义，等待 ${hostLabel()} 处理。`; await refresh(); }
  catch (error) { $('status').textContent = error.message; await refresh(); }
};
$('cancel').onclick = async () => { try { await api('cancel', { pick_id: state.pending_pick }); $('status').textContent = '已取消选择。'; await refresh(); } catch (error) { $('status').textContent = error.message; } };
await refresh();
setInterval(() => { void refresh(); }, 1000);
addEventListener('pagehide', event => {
  if (event.persisted) return;
  disposed = true;
  renderVersion += 1;
  searchVersion += 1;
  for (const load of blobLoads.values()) load.controller.abort();
  blobLoads.clear();
  blobs.clear();
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
});
addEventListener('pageshow', event => { if (event.persisted && state && !disposed) void render(); });
