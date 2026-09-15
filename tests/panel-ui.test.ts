import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

async function eventually(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('等待 DOM 异步提交超时');
}

test('面板真实 DOM 以同一版本封面响应减少动态效果、显式播放暂停，并准确呈现图片解码失败', async t => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../assets/samples/manifest.json', import.meta.url), 'utf8'));
  const expression = manifest.expressions.find((value: { visual: { animated: boolean } }) => value.visual.animated)!;
  const message = { message_id: 'message-motion', direction: 'ai_to_human', revision: expression, presentation: 'pending' };
  const state = { host: 'codex', session_id: 'thread-motion', turn_id: 'turn-1', pending_pick: null, expressions: [expression], messages: [message] };
  const requested: string[] = [];
  const acknowledgements: unknown[] = [];
  let motionListener: ((event: { matches: boolean }) => void) | undefined;
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const value = String(input); requested.push(value);
    if (value.startsWith('/api/state')) return Response.json(state);
    if (value.startsWith('/api/ack')) { acknowledgements.push(JSON.parse(String(init?.body))); return Response.json({ ok: true }); }
    if (value.startsWith('/blobs/')) return new Response(new Blob(['real-image-bytes']), { status: 200 });
    return Response.json({ ok: true });
  };
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:43123/#motion-capability', runScripts: 'outside-only' });
  const globals = globalThis as Record<string, unknown>;
  const names = ['document', 'location', 'matchMedia', 'fetch', 'addEventListener', 'setInterval'];
  const original = new Map(names.map(name => [name, globals[name]]));
  t.after(() => { dom.window.close(); for (const name of names) original.get(name) === undefined ? delete globals[name] : globals[name] = original.get(name); });
  Object.assign(globals, {
    document: dom.window.document, location: dom.window.location, fetch: fakeFetch, addEventListener: () => {}, setInterval: () => 0,
    matchMedia: () => ({ matches: true, addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => { motionListener = listener; } }),
  });
  await import(`${new URL('../web/panel.js', import.meta.url).href}?motion=${Date.now()}`);
  await eventually(() => dom.window.document.querySelectorAll('img').length === 2);
  assert.equal(dom.window.document.querySelector<HTMLButtonElement>('#motion')!.textContent, '播放动图');
  assert.ok(requested.some(value => value === `/blobs/${expression.visual.poster.sha256}`));
  assert.equal(requested.some(value => value === `/blobs/${expression.visual.primary.sha256}`), false);

  dom.window.document.querySelector<HTMLButtonElement>('#motion')!.click();
  await eventually(() => requested.some(value => value === `/blobs/${expression.visual.primary.sha256}`));
  assert.equal(dom.window.document.querySelector<HTMLButtonElement>('#motion')!.textContent, '暂停动图');
  const beforeReducedRender = dom.window.document.querySelector<HTMLImageElement>('#messages img');
  motionListener?.({ matches: true });
  await eventually(() => dom.window.document.querySelector<HTMLButtonElement>('#motion')!.textContent === '播放动图' && dom.window.document.querySelector<HTMLImageElement>('#messages img') !== beforeReducedRender);

  const historyImage = dom.window.document.querySelector<HTMLImageElement>('#messages img')!;
  historyImage.dispatchEvent(new dom.window.Event('error'));
  await eventually(() => !!dom.window.document.querySelector('#messages [role=alert]'));
  assert.match(dom.window.document.querySelector('#messages [role=alert]')!.textContent!, new RegExp(expression.semantics.fallback.replace(/[\[\]]/g, '\\$&')));
  assert.match(dom.window.document.querySelector('#messages [role=alert]')!.textContent!, /浏览器无法解码图片/);
  assert.deepEqual(acknowledgements.at(-1), { message_id: 'message-motion', presentation: 'fallback' });
  await new Promise(resolve => setTimeout(resolve, 20));
});

test('面板真实 DOM 在服务端素材缺失时保留原 fallback 与明确失败原因', async t => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../assets/samples/manifest.json', import.meta.url), 'utf8'));
  const expression = manifest.expressions[0];
  const state = { host: 'codex', session_id: 'thread-missing', turn_id: 'turn-1', pending_pick: null, expressions: [], messages: [{ message_id: 'message-missing', direction: 'human_to_ai', revision: expression, presentation: 'pending' }] };
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:43123/#missing-capability', runScripts: 'outside-only' });
  const globals = globalThis as Record<string, unknown>;
  const names = ['document', 'location', 'matchMedia', 'fetch', 'addEventListener', 'setInterval'];
  const original = new Map(names.map(name => [name, globals[name]]));
  t.after(() => { dom.window.close(); for (const name of names) original.get(name) === undefined ? delete globals[name] : globals[name] = original.get(name); });
  Object.assign(globals, {
    document: dom.window.document, location: dom.window.location, matchMedia: () => ({ matches: false, addEventListener: () => {} }), addEventListener: () => {}, setInterval: () => 0,
    fetch: async (input: string | URL | Request) => String(input).startsWith('/api/state') ? Response.json(state) : String(input).startsWith('/blobs/') ? Response.json({ error: 'BLOB_MISSING：保留素材缺失' }, { status: 404 }) : Response.json({ ok: true }),
  });
  await import(`${new URL('../web/panel.js', import.meta.url).href}?missing=${Date.now()}`);
  await eventually(() => !!dom.window.document.querySelector('#messages [role=alert]'));
  const fallback = dom.window.document.querySelector('#messages [role=alert]')!.textContent!;
  assert.match(fallback, new RegExp(expression.semantics.fallback.replace(/[\[\]]/g, '\\$&')));
  assert.match(fallback, /BLOB_MISSING：保留素材缺失/);
});

test('真实面板 DOM 可搜索、预览完整语义、显示空状态并保持固定会话目标', async t => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../assets/samples/manifest.json', import.meta.url), 'utf8'));
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:43123/#panel-capability', runScripts: 'outside-only' });
  const state = { host: 'codex', session_id: 'thread-fixed-target', turn_id: 'turn-1', pending_pick: 'pick-1', expressions: manifest.expressions, messages: [] };
  const requested: string[] = [];
  const fakeFetch = async (input: string | URL | Request) => {
    const value = String(input); requested.push(value);
    if (value.startsWith('/api/state')) return Response.json(state);
    if (value.startsWith('/api/search')) {
      const query = new URL(value, dom.window.location.href).searchParams.get('query');
      const expressions = query === '温暖 支持' ? [manifest.expressions[2]] : [];
      return Response.json({ expressions });
    }
    if (value.startsWith('/blobs/')) return new Response(new Blob(['image']), { status: 200 });
    return Response.json({ ok: true });
  };
  const globals = globalThis as Record<string, unknown>;
  const names = ['document', 'location', 'matchMedia', 'fetch', 'addEventListener', 'setInterval'];
  const original = new Map(names.map(name => [name, globals[name]]));
  t.after(() => {
    dom.window.close();
    for (const name of names) {
      if (original.get(name) === undefined) delete globals[name];
      else globals[name] = original.get(name);
    }
  });
  Object.assign(globals, {
    document: dom.window.document,
    location: dom.window.location,
    matchMedia: () => ({ matches: false }),
    fetch: fakeFetch,
    addEventListener: () => {},
    setInterval: () => 0,
  });
  await import(`${new URL('../web/panel.js', import.meta.url).href}?dom=${Date.now()}`);
  assert.match(dom.window.document.querySelector('#connection')!.textContent!, /Codex.*d-target/);
  assert.equal(dom.window.document.querySelector('#session')!.getAttribute('title'), 'Codex 会话 thread-fixed-target');
  assert.equal(dom.window.document.querySelector<HTMLButtonElement>('#send')!.textContent, '发送到 Codex');

  const input = dom.window.document.querySelector<HTMLInputElement>('#search')!;
  input.value = '温暖 支持';
  dom.window.document.querySelector<HTMLFormElement>('#search-form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.querySelectorAll('#catalog .sticker').length, 1);
  dom.window.document.querySelector<HTMLButtonElement>('#catalog .sticker')!.click();
  assert.match(dom.window.document.querySelector('#preview')!.textContent!, /支持你的努力/);
  assert.match(dom.window.document.querySelector('#preview')!.textContent!, /用表情代替具体帮助或必要解释/);
  assert.match(dom.window.document.querySelector('#preview details pre')!.textContent!, /30000000-0000-4000-8000-000000000003/);

  input.value = '完全不存在';
  dom.window.document.querySelector<HTMLFormElement>('#search-form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.querySelectorAll('#catalog .sticker').length, 0);
  assert.match(dom.window.document.querySelector('#search-status')!.textContent!, /没有合适的表情/);
  assert.match(dom.window.document.querySelector('#connection')!.textContent!, /d-target/);
  assert.equal(dom.window.document.querySelector('#session')!.getAttribute('title'), 'Codex 会话 thread-fixed-target');
  assert.ok(requested.some(value => value.includes(encodeURIComponent('温暖 支持'))));
});

test('面板搜索反序完成时只一次提交最新 DOM、状态与选择', async t => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../assets/samples/manifest.json', import.meta.url), 'utf8'));
  const [celebrate, awkward] = manifest.expressions;
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:43123/#race-capability', runScripts: 'outside-only' });
  const state = { host: 'codex', session_id: 'thread-race', turn_id: 'turn-1', pending_pick: 'pick-race', expressions: [], messages: [] };
  let releaseCelebrate!: () => void; let celebrateRequested!: () => void;
  const celebrateGate = new Promise<void>(resolve => { releaseCelebrate = resolve; });
  const celebrateStarted = new Promise<void>(resolve => { celebrateRequested = resolve; });
  const selections: unknown[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const value = String(input);
    if (value.startsWith('/api/state')) return Response.json(state);
    if (value.startsWith('/api/search')) {
      const query = new URL(value, dom.window.location.href).searchParams.get('query');
      return Response.json({ expressions: query === '庆祝' ? [celebrate] : [awkward] });
    }
    if (value === `/blobs/${celebrate.visual.primary.sha256}`) { celebrateRequested(); await celebrateGate; return new Response(new Blob(['celebrate']), { status: 200 }); }
    if (value.startsWith('/blobs/')) return new Response(new Blob(['awkward']), { status: 200 });
    if (value.startsWith('/api/select')) { selections.push(JSON.parse(String(init?.body))); return Response.json({ ok: true }); }
    return Response.json({ ok: true });
  };
  const globals = globalThis as Record<string, unknown>;
  const names = ['document', 'location', 'matchMedia', 'fetch', 'addEventListener', 'setInterval'];
  const original = new Map(names.map(name => [name, globals[name]]));
  t.after(() => {
    dom.window.close();
    for (const name of names) {
      if (original.get(name) === undefined) delete globals[name];
      else globals[name] = original.get(name);
    }
  });
  Object.assign(globals, { document: dom.window.document, location: dom.window.location, matchMedia: () => ({ matches: false }), fetch: fakeFetch, addEventListener: () => {}, setInterval: () => 0 });
  await import(`${new URL('../web/panel.js', import.meta.url).href}?race=${Date.now()}`);
  const input = dom.window.document.querySelector<HTMLInputElement>('#search')!;
  const submit = (query: string) => { input.value = query; dom.window.document.querySelector<HTMLFormElement>('#search-form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); };
  submit('庆祝'); await celebrateStarted;
  submit('自嘲'); await eventually(() => dom.window.document.querySelectorAll('#catalog .name').length === 1);
  assert.deepEqual([...dom.window.document.querySelectorAll('#catalog .name')].map(node => node.textContent), ['挠头苦笑']);
  assert.match(dom.window.document.querySelector('#search-status')!.textContent!, /找到 1 个候选/);
  dom.window.document.querySelector<HTMLButtonElement>('#catalog .sticker')!.click();
  releaseCelebrate(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual([...dom.window.document.querySelectorAll('#catalog .name')].map(node => node.textContent), ['挠头苦笑']);
  assert.match(dom.window.document.querySelector('#search-status')!.textContent!, /找到 1 个候选/);
  assert.match(dom.window.document.querySelector('#preview')!.textContent!, /面对自己无伤大雅的小失误/);
  assert.equal(dom.window.document.querySelector<HTMLButtonElement>('#catalog .sticker')!.getAttribute('aria-pressed'), 'true');
  dom.window.document.querySelector<HTMLButtonElement>('#send')!.click(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(selections, [{ pick_id: 'pick-race', asset_id: awkward.asset_id, revision_id: awkward.revision_id }]);
});

for (const scenario of [
  { name: '播放后立即暂停', reduced: true, slow: 'primary', final: 'poster' },
  { name: '暂停后立即播放', reduced: false, slow: 'poster', final: 'primary' },
] as const) test(`面板${scenario.name}时只原子提交最新一轮历史`, async t => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../assets/samples/manifest.json', import.meta.url), 'utf8'));
  const expression = manifest.expressions.find((value: { visual: { animated: boolean } }) => value.visual.animated)!;
  const state = { host: 'codex', session_id: `thread-${scenario.slow}`, turn_id: 'turn-1', pending_pick: null, expressions: [], messages: [{ message_id: `message-${scenario.slow}`, direction: 'ai_to_human', revision: expression, presentation: 'pending' }] };
  const slowDigest = expression.visual[scenario.slow].sha256;
  let releaseSlow!: () => void;
  let slowStarted!: () => void;
  const slowGate = new Promise<void>(resolve => { releaseSlow = resolve; });
  const slowRequest = new Promise<void>(resolve => { slowStarted = resolve; });
  let delaySlow = false;
  const fakeFetch = async (input: string | URL | Request) => {
    const value = String(input);
    if (value.startsWith('/api/state')) return Response.json(state);
    if (value === `/blobs/${slowDigest}` && delaySlow) { slowStarted(); await slowGate; }
    if (value.startsWith('/blobs/')) return { ok: true, blob: async () => ({ digest: value.slice('/blobs/'.length) }) } as unknown as Response;
    return Response.json({ ok: true });
  };
  const dom = new JSDOM(html, { url: `http://127.0.0.1:43123/#race-${scenario.slow}`, runScripts: 'outside-only' });
  const globals = globalThis as Record<string, unknown>;
  const names = ['document', 'location', 'matchMedia', 'fetch', 'addEventListener', 'setInterval'];
  const original = new Map(names.map(name => [name, globals[name]]));
  const originalCreateObjectURL = URL.createObjectURL;
  t.after(() => {
    dom.window.close(); URL.createObjectURL = originalCreateObjectURL;
    for (const name of names) original.get(name) === undefined ? delete globals[name] : globals[name] = original.get(name);
  });
  URL.createObjectURL = (blob: Blob) => `blob:${(blob as unknown as { digest: string }).digest}`;
  Object.assign(globals, { document: dom.window.document, location: dom.window.location, matchMedia: () => ({ matches: scenario.reduced, addEventListener: () => {} }), fetch: fakeFetch, addEventListener: () => {}, setInterval: () => 0 });
  await import(`${new URL('../web/panel.js', import.meta.url).href}?render-race=${scenario.slow}-${Date.now()}`);
  await eventually(() => dom.window.document.querySelectorAll('#messages article').length === 1);

  delaySlow = true;
  const motion = dom.window.document.querySelector<HTMLButtonElement>('#motion')!;
  motion.click();
  await slowRequest;
  motion.click();
  const finalDigest = expression.visual[scenario.final].sha256;
  await eventually(() => dom.window.document.querySelector<HTMLImageElement>('#messages img')?.src === `blob:${finalDigest}`);
  releaseSlow();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(dom.window.document.querySelectorAll('#messages article').length, 1);
  assert.equal(dom.window.document.querySelectorAll('#messages img').length, 1);
  assert.equal(dom.window.document.querySelector<HTMLImageElement>('#messages img')!.src, `blob:${finalDigest}`);
});

test('面板共享同摘要加载并在 bfcache 恢复后重绘，最终回收全部对象 URL', async t => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../assets/samples/manifest.json', import.meta.url), 'utf8'));
  const expression = manifest.expressions.find((value: { visual: { animated: boolean } }) => value.visual.animated)!;
  const other = manifest.expressions.find((value: { visual: { animated: boolean } }) => !value.visual.animated)!;
  const state = { host: 'codex', session_id: 'thread-cache', turn_id: 'turn-1', pending_pick: null, expressions: [], messages: [{ message_id: 'message-cache', direction: 'ai_to_human', revision: expression, presentation: 'pending' }] };
  const mainDigest = expression.visual.primary.sha256;
  const fetchCounts = new Map<string, number>();
  let releaseMain!: () => void;
  let mainStarted!: () => void;
  let releaseOther!: () => void;
  let otherStarted!: () => void;
  const mainGate = new Promise<void>(resolve => { releaseMain = resolve; });
  const mainRequest = new Promise<void>(resolve => { mainStarted = resolve; });
  const otherGate = new Promise<void>(resolve => { releaseOther = resolve; });
  const otherRequest = new Promise<void>(resolve => { otherStarted = resolve; });
  const listeners = new Map<string, (event: { persisted: boolean }) => void>();
  let intervalCallback!: () => void;
  const created: string[] = [];
  const revoked: string[] = [];
  let delayMain = false;
  const fakeFetch = async (input: string | URL | Request) => {
    const value = String(input);
    if (value.startsWith('/api/state')) return Response.json(state);
    if (value.startsWith('/blobs/')) {
      const digest = value.slice('/blobs/'.length);
      fetchCounts.set(digest, (fetchCounts.get(digest) ?? 0) + 1);
      if (digest === mainDigest && delayMain) { mainStarted(); await mainGate; }
      if (digest === other.visual.primary.sha256) { otherStarted(); await otherGate; }
      return { ok: true, blob: async () => ({ digest }) } as unknown as Response;
    }
    return Response.json({ ok: true });
  };
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:43123/#cache-capability', runScripts: 'outside-only' });
  const globals = globalThis as Record<string, unknown>;
  const names = ['document', 'location', 'matchMedia', 'fetch', 'addEventListener', 'setInterval'];
  const original = new Map(names.map(name => [name, globals[name]]));
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  t.after(() => {
    dom.window.close(); URL.createObjectURL = originalCreateObjectURL; URL.revokeObjectURL = originalRevokeObjectURL;
    for (const name of names) original.get(name) === undefined ? delete globals[name] : globals[name] = original.get(name);
  });
  URL.createObjectURL = (blob: Blob) => { const url = `blob:${(blob as unknown as { digest: string }).digest}:${created.length}`; created.push(url); return url; };
  URL.revokeObjectURL = url => { revoked.push(url); };
  Object.assign(globals, {
    document: dom.window.document, location: dom.window.location, matchMedia: () => ({ matches: true, addEventListener: () => {} }), fetch: fakeFetch, setInterval: (callback: () => void) => { intervalCallback = callback; return 0; },
    addEventListener: (type: string, listener: (event: { persisted: boolean }) => void) => { listeners.set(type, listener); },
  });
  await import(`${new URL('../web/panel.js', import.meta.url).href}?cache=${Date.now()}`);
  await eventually(() => dom.window.document.querySelectorAll('#messages article').length === 1);

  delayMain = true;
  const motion = dom.window.document.querySelector<HTMLButtonElement>('#motion')!;
  motion.click();
  await mainRequest;
  motion.click();
  motion.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetchCounts.get(mainDigest), 1);
  releaseMain();
  await eventually(() => dom.window.document.querySelector<HTMLImageElement>('#messages img')?.src.startsWith(`blob:${mainDigest}:`) === true);

  listeners.get('pagehide')!({ persisted: true });
  assert.deepEqual(revoked, []);
  dom.window.document.querySelector('#messages')!.replaceChildren();
  listeners.get('pageshow')!({ persisted: true });
  await eventually(() => dom.window.document.querySelectorAll('#messages article').length === 1);
  assert.equal(fetchCounts.get(mainDigest), 1);

  state.messages.push({ message_id: 'message-dispose', direction: 'human_to_ai', revision: other, presentation: 'pending' });
  intervalCallback();
  await otherRequest;
  listeners.get('pagehide')!({ persisted: false });
  releaseOther();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(created.some(url => url.includes(other.visual.primary.sha256)), false);
  assert.deepEqual(new Set(revoked), new Set(created));
  assert.equal(revoked.length, created.length);
});
