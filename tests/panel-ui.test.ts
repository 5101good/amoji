import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

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
