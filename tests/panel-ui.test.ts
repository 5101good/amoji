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
