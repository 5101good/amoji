const $ = id => document.getElementById(id);
const capability = location.hash.slice(1);
const headers = { Authorization: `Bearer ${capability}`, 'Content-Type': 'application/json' };
let state;
let selected;
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let paused = motionPreference.matches;
let previous = '';
let searchVersion = 0;
const hostLabel = () => state?.host === 'claude-code' ? 'Claude Code' : 'Codex';
const blobs = new Map();
async function api(path, body) {
  const response = await fetch(`/api/${path}`, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '连接失败');
  return data;
}
async function picture(expression, messageId) {
  const image = document.createElement('img');
  image.alt = expression.semantics.fallback;
  const blob = paused && expression.visual.poster ? expression.visual.poster : expression.visual.primary;
  const fallback = reason => {
    const text = document.createElement('div'); text.className = 'placeholder'; text.setAttribute('role', 'alert'); text.textContent = `${expression.semantics.fallback} · ${reason}`;
    image.replaceWith(text);
    if (messageId) void api('ack', { message_id: messageId, presentation: 'fallback' }).catch(() => {});
  };
  image.onerror = () => fallback('浏览器无法解码图片');
  image.onload = () => { if (messageId) void api('ack', { message_id: messageId, presentation: 'rendered' }).catch(() => {}); };
  try {
    if (!blobs.has(blob.sha256)) {
      const response = await fetch(`/blobs/${blob.sha256}`, { headers });
      if (!response.ok) {
        let reason = '素材不可用';
        try { reason = (await response.json()).error || reason; } catch {}
        throw new Error(reason);
      }
      blobs.set(blob.sha256, URL.createObjectURL(await response.blob()));
    }
    image.src = blobs.get(blob.sha256);
  } catch (error) { setTimeout(() => fallback(error instanceof Error ? error.message : '素材不可用'), 0); }
  return image;
}
function text(tag, value, className) { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; }
function definition(expression) {
  const details = document.createElement('details');
  details.append(text('summary', '查看完整固定语义与版本'), text('pre', JSON.stringify({ asset_id: expression.asset_id, revision_id: expression.revision_id, name: expression.name, semantics: expression.semantics }, null, 2)));
  return details;
}
function preview() {
  $('preview').replaceChildren();
  if (!selected) { $('preview').append(text('p', '选一个表情，看看它想表达什么。')); }
  else {
    $('preview').append(text('h2', selected.name), text('p', selected.semantics.meaning));
    if (selected.semantics.tone) $('preview').append(text('p', selected.semantics.tone, 'avoid'));
    if (selected.semantics.use_when?.length) $('preview').append(text('p', `适用于：${selected.semantics.use_when.join('；')}`, 'avoid'));
    if (selected.semantics.avoid_when?.length) $('preview').append(text('p', `不适用于：${selected.semantics.avoid_when.join('；')}`, 'avoid'));
    $('preview').append(definition(selected));
  }
  $('send').disabled = !selected || !state?.pending_pick;
  $('cancel').disabled = !state?.pending_pick;
  for (const button of $('catalog').children) button.setAttribute('aria-pressed', String(button.dataset.revision === selected?.revision_id));
}
async function render() {
  const label = state.session_id.slice(-8);
  document.title = `Amoji · ${label}`;
  $('session').textContent = label;
  const host = hostLabel();
  $('session').title = `${host} 会话 ${state.session_id}`;
  $('send').textContent = `发送到 ${host}`;
  $('history-hint').textContent = `此 ${host} 会话的表情记录保存在本机，重新打开后仍可查看。`;
  const skill = state.host === 'claude-code' ? '/amoji:amoji' : '/amoji';
  $('connection').textContent = state.pending_pick ? `已关联 ${host} · ${label}，正在等待你选择` : `已关联 ${host} · ${label}。在会话中调用 ${skill} 可再次选择。`;
  await applySearch();
  $('messages').replaceChildren();
  if (!state.messages.length) $('messages').append(text('p', '还没有表情。\n一点心意，从这里开始。', 'empty'));
  for (const message of state.messages) {
    const article = document.createElement('article'); article.className = 'message';
    article.append(text('span', message.direction === 'human_to_ai' ? '你 → AI' : 'AI → 你', 'direction'), await picture(message.revision, message.message_id), text('p', message.revision.semantics.meaning), text('small', message.message_id.slice(0, 8)));
    article.append(definition(message.revision));
    $('messages').append(article);
  }
  preview();
}
async function buildCatalog(expressions) {
  const fragment = document.createDocumentFragment();
  for (const expression of expressions) {
    const button = document.createElement('button'); button.className = 'sticker'; button.dataset.revision = expression.revision_id; button.setAttribute('aria-pressed', 'false');
    button.append(await picture(expression), text('span', expression.name, 'name'));
    button.onclick = () => { selected = expression; preview(); };
    fragment.append(button);
  }
  return fragment;
}
async function applySearch(event) {
  event?.preventDefault();
  const version = ++searchVersion;
  const query = $('search').value;
  try {
    const expressions = query.trim() ? (await api(`search?query=${encodeURIComponent(query)}&limit=5`)).expressions : state.expressions;
    if (version !== searchVersion) return;
    const fragment = await buildCatalog(expressions);
    if (version !== searchVersion) return;
    const nextSelected = selected && expressions.some(expression => expression.asset_id === selected.asset_id && expression.revision_id === selected.revision_id) ? selected : undefined;
    selected = nextSelected;
    $('catalog').replaceChildren(fragment);
    $('search-status').textContent = query.trim() ? (expressions.length ? `找到 ${expressions.length} 个候选。` : '没有合适的表情，可以继续用文字表达。') : `当前可选 ${expressions.length} 个表情。`;
    preview();
  } catch (error) {
    if (version !== searchVersion) return;
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
addEventListener('pagehide', () => { for (const url of blobs.values()) URL.revokeObjectURL(url); });
