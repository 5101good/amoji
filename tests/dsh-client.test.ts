import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SampleCatalog } from '../src/sample-catalog.js';
import type { ClientPort } from '../src/dsh/client.js';
import type { VisualMeta, RpcResult } from '../src/dsh/contracts.js';
const require = createRequire(import.meta.url);
interface SlotCorePort {
  register(options: object, component: unknown): () => void;
  entriesOfSlot(key: string): Array<{ component: React.ComponentType<{ sessionId: string; block?: { meta: VisualMeta } }>; options: { key?: string } }>;
}
const source = new URL('../.cache/dsh-source/slots.mjs', import.meta.url).href;
const { SlotCore } = await import(source) as { SlotCore: new () => SlotCorePort };
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('真实 loader 产物与基线 SlotCore：挂载三槽、图片事件、动画封面、选择与会话切换', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', runScripts: 'outside-only' });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let unmount = async () => {};
  t.after(async () => { await unmount(); Object.assign(globalThis, previous); dom.window.close(); });
  let module: { apply(ctx: ClientPort): void } | undefined;
  const requests: Array<{ endpoint: string; payload: Record<string, unknown> }> = [];
  const shared: string[] = [];
  Object.assign(dom.window, { __ModuleLoader__: { load(value: { id: string; factory(require: (id: string) => unknown): unknown }) { assert.equal(value.id, '@amoji/dsh'); module = value.factory(id => { shared.push(id); assert.equal(id, 'react'); return require(id); }) as typeof module; } } });
  dom.window.eval(await readFile(new URL('../adapters/dsh/client.js', import.meta.url), 'utf8'));
  assert.ok(module); assert.deepEqual([...new Set(shared)], ['react']);
  const catalog = await SampleCatalog.load(new URL('../assets/samples/', import.meta.url)); const expressions = catalog.all(); const e = expressions.find(e => e.visual.animated)!;
  const data = async (blob: { sha256: string; mime: string }) => `data:${blob.mime};base64,${(await readFile(new URL(`../assets/samples/blobs/${blob.sha256}`, import.meta.url))).toString('base64')}`;
  const visual = { expression: e, primary: await data(e.visual.primary), poster: e.visual.poster ? await data(e.visual.poster) : null };
  const meta: VisualMeta = { kind: 'amoji', messageId: 'message-a', ref: { asset_id: e.asset_id, revision_id: e.revision_id }, visualHash: e.visual.primary.sha256, posterHash: e.visual.poster?.sha256 ?? null, alt: e.semantics.fallback };
  const slots = new SlotCore(); slots.register({ name: 'root', children: { 'conversation.input.left': { kind: 'list', scope: 'session' }, 'conversation.composer.dock': { kind: 'list', scope: 'session' }, 'tool.call.toolview': { kind: 'keyed', scope: 'session' } } }, () => null);
  const disposers: Array<() => void> = [];
  const ctx: ClientPort = { slots, effect(factory) { disposers.push(factory()); }, connection: { rpc: { async call(_channel, endpoint, raw): Promise<RpcResult<unknown>> {
    const payload = raw as Record<string, unknown>; requests.push({ endpoint, payload });
    const result = endpoint.endsWith('/catalog') ? [e] : endpoint.endsWith('/search') ? (payload.query === '完全不存在' ? [] : [e]) : endpoint.endsWith('/visual') ? visual : endpoint.endsWith('/history') ? [] : endpoint.endsWith('/submit') ? { host: { status: 'accepted' } } : null;
    return { ok: true, value: result };
  } } } };
  module.apply(ctx);
  assert.equal(slots.entriesOfSlot('tool.call.toolview')[0]!.options.key, 'amoji_emit');
  assert.equal(slots.entriesOfSlot('conversation.composer.dock').length, 1);
  const root = createRoot(dom.window.document.getElementById('root')!); unmount = async () => { await act(() => root.unmount()); };
  const Tool = slots.entriesOfSlot('tool.call.toolview')[0]!.component;
  await act(async () => { root.render(React.createElement(Tool, { sessionId: 'session-a', block: { meta } })); await settle(); });
  let img = dom.window.document.querySelector('img')!; assert.ok(img); assert.equal(img.src, visual.poster ?? visual.primary); assert.equal(img.alt, meta.alt);
  await act(async () => { img.dispatchEvent(new dom.window.Event('load')); await settle(); });
  const receipt = requests.find(r => r.endpoint === 'amoji/display')!; assert.equal(receipt.payload.sessionId, 'session-a'); assert.equal(receipt.payload.messageId, 'message-a'); assert.equal(receipt.payload.hash, meta.posterHash ?? meta.visualHash);
  const play = [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === '播放动图'); assert.ok(play);
  await act(() => play.click()); img = dom.window.document.querySelector('img')!; assert.equal(img.src, visual.primary);
  await act(async () => { img.dispatchEvent(new dom.window.Event('error')); await settle(); });
  assert.match(dom.window.document.body.textContent!, /图片加载失败/); assert.ok(requests.some(r => r.payload.state === 'failed' && r.payload.hash === meta.visualHash));
  const Picker = slots.entriesOfSlot('conversation.input.left')[0]!.component;
  await act(() => root.render(React.createElement(Picker, { sessionId: 'session-a' })));
  await act(async () => { (dom.window.document.querySelector('button') as HTMLButtonElement).click(); await settle(); });
  const search = dom.window.document.querySelector<HTMLInputElement>('[aria-label="搜索表情"]')!; assert.ok(search);
  const setSearch = async (value: string) => act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(search, value); search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await settle(); });
  await setSearch('刚完成的进展');
  await act(async () => { dom.window.document.querySelector<HTMLFormElement>('[aria-label="搜索 Amoji"]')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await settle(); });
  const searchRequest = requests.find(r => r.endpoint === 'amoji/search')!; assert.equal(searchRequest.payload.sessionId, 'session-a'); assert.equal(searchRequest.payload.query, '刚完成的进展'); assert.equal(searchRequest.payload.limit, 5);
  const choose = [...dom.window.document.querySelectorAll('button')].find(b => b.textContent?.includes(e.name)); assert.ok(choose);
  await act(() => choose.click());
  const preview = dom.window.document.querySelector('[aria-label="固定语义与精确版本"]')!; assert.match(preview.textContent!, new RegExp(e.semantics.meaning)); assert.match(preview.textContent!, new RegExp(e.semantics.avoid_when![0]!)); assert.match(preview.textContent!, new RegExp(e.revision_id));
  const send = [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === '发送所选表情')!;
  await act(async () => { send.click(); await settle(); }); assert.equal(requests.find(r => r.endpoint === 'amoji/submit')!.payload.sessionId, 'session-a');
  await setSearch('完全不存在');
  await act(async () => { dom.window.document.querySelector<HTMLFormElement>('[aria-label="搜索 Amoji"]')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await settle(); });
  assert.match(dom.window.document.body.textContent!, /没有合适的表情/); assert.equal(dom.window.document.querySelector('[aria-label="固定语义与精确版本"]'), null);
  await act(() => root.render(React.createElement(Picker, { sessionId: 'session-b' })));
  assert.equal(dom.window.document.querySelector('[aria-label="Amoji 表情选择"]'), null);
  assert.equal(requests.some(r => r.endpoint === 'amoji/submit' && r.payload.sessionId === 'session-b'), false);
  disposers.pop()!();
  for (const key of ['conversation.input.left', 'conversation.composer.dock', 'tool.call.toolview']) assert.equal(slots.entriesOfSlot(key).length, 0);
  module.apply(ctx); // The same ids and keyed cell are reusable after unload.
  assert.equal(slots.entriesOfSlot('tool.call.toolview').length, 1);
  disposers.pop()!();
  const order: string[] = [];
  const failing: ClientPort = { ...ctx, slots: { register(options, component) {
    if (options.name === 'tool.call.toolview') throw new Error('third registration failed');
    const dispose = slots.register(options, component);
    return () => { order.push(options.name); dispose(); };
  } } };
  assert.throws(() => module!.apply(failing), /third registration failed/);
  assert.deepEqual(order, ['conversation.composer.dock', 'conversation.input.left']);
  module.apply(ctx); assert.equal(slots.entriesOfSlot('tool.call.toolview').length, 1); disposers.pop()!();
});

test('Picker 真正 pending 时切换：取消旧请求、隔离 busy/status，History 不读取跨会话旧行', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', runScripts: 'outside-only' });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let module!: typeof import('../src/dsh/client.js');
  Object.assign(dom.window, { __ModuleLoader__: { load(value: { factory(require: (id: string) => unknown): unknown }) { module = value.factory(id => require(id)) as typeof module; } } });
  dom.window.eval(await readFile(new URL('../adapters/dsh/client.js', import.meta.url), 'utf8'));
  const root = createRoot(dom.window.document.getElementById('root')!);
  t.after(async () => { await act(() => root.unmount()); Object.assign(globalThis, previous); dom.window.close(); });
  const [e, other] = (await SampleCatalog.load(new URL('../assets/samples/', import.meta.url))).all(); assert.ok(e && other);
  const meta: VisualMeta = { kind: 'amoji', messageId: 'history-a', ref: { asset_id: e.asset_id, revision_id: e.revision_id }, visualHash: e.visual.primary.sha256, posterHash: e.visual.poster?.sha256 ?? null, alt: e.semantics.fallback };
  const row: import('../src/dsh/contracts.js').HistoryEntry = { meta, host: null, message: { message_id: meta.messageId, binding_id: 'a', direction: 'human_to_ai', created_at: '', revision: e, delivery: 'pending', presentation: 'pending' } };
  const submits = new Map<string, { signal?: AbortSignal; finish(value: import('../src/dsh/contracts.js').HistoryEntry): void }>();
  const searches = new Map<string, { signal?: AbortSignal; finish(value: import('../src/sample-catalog.js').Expression[]): void }>();
  const reads: Array<{ sessionId: string; messageId?: string }> = [];
  let finishHistoryB!: (value: import('../src/dsh/contracts.js').HistoryEntry[]) => void;
  const rpc: import('../src/dsh/contracts.js').DshRpc = {
    catalog: async () => [e],
    search: (sessionId, _query, _limit, signal) => new Promise(resolve => searches.set(sessionId, { signal, finish: resolve })),
    submit: (sessionId, _ref, _requestId, signal) => new Promise(resolve => submits.set(sessionId, { signal, finish: resolve })),
    history: async sessionId => sessionId === 'session-a' ? [row] : new Promise(resolve => { finishHistoryB = resolve; }),
    visual: async (sessionId, _ref, messageId) => { reads.push({ sessionId, messageId }); return { expression: e, primary: 'data:image/png;base64,AA==', poster: null }; },
    display: async () => {},
  };
  const { Picker, History } = module.createComponents(rpc);
  const button = (label: string) => { const value = [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === label); assert.ok(value, label); return value; };
  const openChoose = async () => {
    await act(async () => { button('表情').click(); await settle(); });
    assert.equal(button(e.name).disabled, false);
    await act(() => button(e.name).click());
  };
  await act(() => root.render(React.createElement(Picker, { sessionId: 'session-a' }))); await openChoose();
  await act(() => button('发送所选表情').click()); assert.ok(submits.has('session-a'));
  await act(() => root.render(React.createElement(Picker, { sessionId: 'session-b' })));
  assert.equal(submits.get('session-a')!.signal!.aborted, true);
  await openChoose(); await act(() => button('发送所选表情').click()); assert.ok(submits.has('session-b'));
  await act(async () => { submits.get('session-a')!.finish({ ...row, host: { status: 'accepted', requestId: 'old' } }); await settle(); });
  assert.equal(button('发送中…').disabled, true); assert.doesNotMatch(dom.window.document.querySelector('[role="status"]')!.textContent!, /已接收|已观察/);
  await act(async () => { submits.get('session-b')!.finish({ ...row, host: { status: 'accepted', requestId: 'new' } }); await settle(); });
  assert.match(dom.window.document.querySelector('[role="status"]')!.textContent!, /已接收入队/);
  const search = dom.window.document.querySelector<HTMLInputElement>('[aria-label="搜索表情"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(search, '自嘲'); search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await settle(); });
  await act(() => dom.window.document.querySelector<HTMLFormElement>('[aria-label="搜索 Amoji"]')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.ok(searches.has('session-b'));
  await act(() => root.render(React.createElement(Picker, { sessionId: 'session-a' })));
  assert.equal(searches.get('session-b')!.signal!.aborted, true);
  await act(async () => { searches.get('session-b')!.finish([other]); await settle(); });
  await openChoose(); assert.equal([...dom.window.document.querySelectorAll('button')].some(value => value.textContent === other.name), false);
  await act(async () => { root.render(React.createElement(History, { sessionId: 'session-a' })); await settle(); });
  assert.ok(reads.some(value => value.sessionId === 'session-a' && value.messageId === 'history-a'));
  await act(() => root.render(React.createElement(History, { sessionId: 'session-b' })));
  assert.equal(dom.window.document.querySelector('img'), null);
  assert.equal(reads.some(value => value.sessionId === 'session-b' && value.messageId === 'history-a'), false);
  await act(async () => { finishHistoryB([]); await settle(); });
});
