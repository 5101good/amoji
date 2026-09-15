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
const hostLabel = (snapshot = state) => snapshot?.host === 'claude-code' ? 'Claude Code' : snapshot?.host === 'dsh' ? 'dsh' : 'Codex';
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
  $('connection').textContent = snapshot.pending_pick ? `已关联 ${host} · ${label}，正在等待你选择` : (snapshot.host === 'dsh' ? `已关联 dsh · ${label}。创建后返回 dsh 表情选择器，点击“显示全部”刷新并发送。` : `已关联 ${host} · ${label}。在会话中调用 ${skill} 可再次选择。`);
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
motionPreference.addEventListener?.('change', event => { if (event.matches) { setPaused(true); pauseDraftPreview(); } });
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
let draft;
let uploadFile;
let previewed;
let draftBusy = false;
let draftPreviewGeneration = 0;
let draftPreviewPaused = true;
function draftControls() {
  $('draft-fields').disabled = !draft || draftBusy || !!previewed || !!draft.confirmed;
  $('new-draft').disabled = draftBusy;
  $('restore-draft').disabled = draftBusy || !$('draft-list').value;
  $('save-draft').disabled = !draft || draftBusy || !!previewed || !!draft.confirmed;
  $('preview-draft').disabled = $('save-draft').disabled;
  $('confirm-draft').disabled = !previewed || draftBusy;
  $('back-draft').disabled = !previewed || draftBusy;
}
async function draftOperation(operation) {
  if (draftBusy) return;
  draftBusy = true; draftControls(); $('draft-status').textContent = '正在处理…';
  try { await operation(); }
  catch (error) { $('draft-status').textContent = error.message; }
  finally { draftBusy = false; draftControls(); }
}
async function draftList() {
  const { drafts } = await api('drafts');
  $('draft-list').replaceChildren(...drafts.map(item => { const option = document.createElement('option'); option.value = item.draft_id; option.textContent = item.fields.name || '未命名草稿'; return option; }));
  if (draft && drafts.some(item => item.draft_id === draft.draft_id)) $('draft-list').value = draft.draft_id;
  draftControls();
}
function loadDraft(value) {
  draft = value; uploadFile = undefined; previewed = undefined;
  const fields = draft.fields;
  for (const [id, value] of Object.entries({ name: fields.name, locale: fields.semantics.locale, meaning: fields.semantics.meaning, fallback: fields.semantics.fallback, tone: fields.semantics.tone, use: fields.semantics.use_when?.join('\n'), avoid: fields.semantics.avoid_when?.join('\n'), license: fields.rights.license, creator: fields.rights.creator, source: fields.rights.source })) $('draft-' + id).value = value ?? '';
  $('draft-file').value = ''; $('draft-preview').hidden = true; draftControls();
}
function draftInput() {
  const semantics = { locale: $('draft-locale').value, meaning: $('draft-meaning').value, fallback: $('draft-fallback').value };
  if ($('draft-tone').value !== '') semantics.tone = $('draft-tone').value;
  if ($('draft-use').value !== '') semantics.use_when = $('draft-use').value.split('\n');
  if ($('draft-avoid').value !== '') semantics.avoid_when = $('draft-avoid').value.split('\n');
  const rights = { license: $('draft-license').value };
  if ($('draft-creator').value !== '') rights.creator = $('draft-creator').value;
  if ($('draft-source').value !== '') rights.source = $('draft-source').value;
  return { name: $('draft-name').value, semantics, rights, ...(draft.fields.tags === undefined ? {} : { tags: draft.fields.tags }) };
}
async function saveDraft() {
  let upload;
  if (uploadFile) {
    if (uploadFile.size > 10 * 1024 * 1024) throw new Error('MEDIA_LIMIT_EXCEEDED：单个素材最多 10 MiB');
    upload = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error('无法读取上传文件'));
      reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(uploadFile);
    });
  }
  draft = await api('draft/save', { draft_id: draft.draft_id, version: draft.version, fields: draftInput(), ...(upload === undefined ? {} : { upload }) });
  uploadFile = undefined;
  await draftList();
}
$('new-draft').onclick = () => draftOperation(async () => { loadDraft(await api('draft/create', {})); await draftList(); $('draft-status').textContent = '已建立本机草稿，请上传素材并填写语义。'; });
$('restore-draft').onclick = () => draftOperation(async () => { loadDraft(await api('draft/get', { draft_id: $('draft-list').value })); $('draft-status').textContent = '已恢复上次保存的草稿。'; });
$('draft-list').onchange = draftControls;
$('draft-file').onchange = () => { uploadFile = $('draft-file').files[0]; };
$('draft-form').onsubmit = event => event.preventDefault();
$('save-draft').onclick = () => draftOperation(async () => { await saveDraft(); $('draft-status').textContent = '草稿已保存，尚未加入可发送的共享库。'; });
$('preview-draft').onclick = () => draftOperation(async () => {
  await saveDraft();
  const checked = await api('draft/preview', { draft_id: draft.draft_id, version: draft.version });
  previewed = checked; draftPreviewPaused = true;
  try { await renderDraftPreview(); } catch (error) { previewed = undefined; throw error; }
  $('draft-status').textContent = '预览不会发送。请检查图文，确认后加入共享库，或返回修改。';
});
async function renderDraftPreview() {
  const checked = previewed;
  if (!checked) return;
  const generation = ++draftPreviewGeneration;
  const current = () => !disposed && generation === draftPreviewGeneration && previewed === checked;
  const visual = await picture({ ...checked.fields, visual: checked.visual }, undefined, draftPreviewPaused, { current, report: effect => effect() });
  if (!current()) return;
  if (visual.getAttribute('role') === 'alert') throw new Error(visual.textContent);
  visual.addEventListener('error', () => { if (current()) { previewed = undefined; $('draft-status').textContent = '浏览器无法显示预览，请检查素材后重试。'; draftControls(); } });
  $('draft-preview').replaceChildren(visual, text('h2', checked.fields.name), text('pre', JSON.stringify({ semantics: checked.fields.semantics, rights: checked.fields.rights }, null, 2)), text('p', '请确认此图像与固定语义相符。'));
  if (checked.visual.animated) {
    const motion = text('button', draftPreviewPaused ? '播放预览动图' : '暂停预览动图');
    motion.type = 'button'; motion.id = 'draft-motion'; motion.setAttribute('aria-pressed', String(draftPreviewPaused));
    motion.onclick = () => { draftPreviewPaused = !draftPreviewPaused; void renderDraftPreview().catch(error => { previewed = undefined; $('draft-status').textContent = error.message; draftControls(); }); };
    $('draft-preview').append(motion);
  }
  $('draft-preview').hidden = false;
}
function pauseDraftPreview() {
  if (previewed) { draftPreviewPaused = true; void renderDraftPreview().catch(error => { previewed = undefined; $('draft-status').textContent = error.message; draftControls(); }); }
}
$('back-draft').onclick = () => { previewed = undefined; $('draft-preview').hidden = true; draftControls(); };
$('confirm-draft').onclick = () => draftOperation(async () => {
  const expression = await api('draft/confirm', { draft_id: previewed.draft_id, version: previewed.version });
  draft.confirmed = { asset_id: expression.asset_id, revision_id: expression.revision_id }; previewed = undefined;
  $('search').value = ''; selected = expression; await refresh(); await draftList();
  $('draft-status').textContent = state?.host === 'dsh' ? '已加入共享库。返回 dsh 表情选择器，点击“显示全部”刷新后发送。' : '已加入共享库并选中。点击发送按钮，发送到页面标明的会话。';
});
await refresh();
if (state?.creation_available) { $('creator').hidden = false; try { await draftList(); } catch (error) { $('draft-status').textContent = error.message; } }
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
