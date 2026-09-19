import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { apply, type ClientPort } from '../src/dsh/client.js';

test('原生用户 renderer 包装保留原组件全部 props、locale，卸载恢复且不用 history dock', () => {
  const core = new SlotCore();
  core.register({ name: 'root', children: {
    'conversation.input.left': { kind: 'list', scope: 'session' },
    'conversation.composer.dock': { kind: 'list', scope: 'session' },
    'conversation.chat.node': { kind: 'keyed', scope: 'session' },
    'tool.call.toolview': { kind: 'keyed', scope: 'session' },
  } } as never, () => null);
  const Original = (props: any) => React.createElement('p', {}, `${props.node.data.content}|${props.attachment}|${props.reference}|${props.t}`);
  core.register({ name: 'conversation.chat.node', key: 'user', locale: 'chat' } as never, Original);
  const cleanup: Array<() => void> = [];
  const ctx = { slots: { register: core.register.bind(core), entries: core.entries.bind(core), subscribe: core.subscribe.bind(core), inject: (_key: string, factory: () => () => void) => factory() }, effect(factory: () => () => void) { cleanup.push(factory()); }, connection: { rpc: { call: async () => ({ ok: true, value: [] }) } } } as unknown as ClientPort;
  apply(ctx);
  const entry = core.entriesOfSlot('conversation.chat.node')[0]!;
  assert.notEqual(entry.component, Original, '必须在原生 user 行包装');
  assert.equal(entry.locale, 'chat');
  const props = { sessionId: 's', node: { data: { content: '文字', source: { kind: 'user', rpcId: 'normal' } } }, attachment: '附件', reference: '引用', t: '词典' };
  assert.equal(renderToStaticMarkup(React.createElement(entry.component as any, props)), '<p>文字|附件|引用|词典</p>');
  assert.equal(core.entriesOfSlot('conversation.composer.dock').length, 0);
  cleanup.forEach(fn => fn());
  assert.equal(core.entriesOfSlot('conversation.chat.node')[0]!.component, Original);
});

test('原生用户行按 rpcId 加图，普通消息不查库；只在正确图像 load 后写回执', async t => {
  const { JSDOM } = await import('jsdom'); const { createRoot } = await import('react-dom/client'); const { act } = React;
  const { SampleCatalog } = await import('../src/sample-catalog.js');
  const { visualMeta } = await import('../src/dsh/host.js');
  const dom = new JSDOM('<div id="root"></div>'); const before = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById('root')!);
  t.after(async () => { await act(() => root.unmount()); Object.assign(globalThis, before); dom.window.close(); });
  const e = (await SampleCatalog.load(new URL('../assets/samples/', import.meta.url))).all()[0]!;
  const message = { message_id: 'm1', direction: 'human_to_ai', revision: e } as import('../src/sample-runtime.js').SampleMessage;
  const meta = visualMeta(message); const calls: string[] = [];
  const rpc = { history: async () => { calls.push('history'); return [{ message, meta, host: { status: 'observed' } }]; }, visual: async () => ({ expression: e, primary: 'data:image/png;base64,AAAA', poster: null }), display: async (_s: string, id: string) => { calls.push(id); } } as unknown as import('../src/dsh/contracts.js').DshRpc;
  const core = new SlotCore(); core.register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } } } as never, () => null);
  core.register({ name: 'conversation.chat.node', key: 'user' } as never, (props: any) => React.createElement('p', {}, props.node.data.content));
  const { mountUserMessages } = await import('../src/dsh/messages.js');
  const release = mountUserMessages(core as unknown as ClientPort['slots'], rpc); t.after(release);
  const View = core.entriesOfSlot('conversation.chat.node')[0]!.component as React.ComponentType<any>;
  const render = (sessionId: string, rpcId: string) => root.render(React.createElement(View, { sessionId, node: { data: { content: '固定语义', source: { kind: 'user', rpcId } } } }));
  await act(async () => { render('s1', 'ordinary'); }); assert.deepEqual(calls, []);
  await act(async () => { render('s1', 'amoji:m1'); });
  assert.equal(dom.window.document.querySelector('p')!.textContent, '固定语义');
  const img = dom.window.document.querySelector('img')!; assert.ok(img); assert.deepEqual(calls, ['history']);
  await act(() => img.dispatchEvent(new dom.window.Event('load'))); assert.deepEqual(calls, ['history', 'm1']);
  await act(() => render('s2', 'ordinary'));
  await act(() => img.dispatchEvent(new dom.window.Event('load'))); assert.deepEqual(calls, ['history', 'm1']);
});

test('暂停动图替换图像节点，迟到旧图 load 不得为新封面写回执', async t => {
  const { JSDOM } = await import('jsdom'); const { createRoot } = await import('react-dom/client'); const { act } = React;
  const { SampleCatalog } = await import('../src/sample-catalog.js'); const { visualMeta } = await import('../src/dsh/host.js'); const { AmojiImage } = await import('../src/dsh/media.js');
  const dom = new JSDOM('<div id="root"></div>'); const before = { window: globalThis.window, document: globalThis.document }; Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById('root')!); t.after(async () => { await act(() => root.unmount()); Object.assign(globalThis, before); dom.window.close(); });
  const e = (await SampleCatalog.load(new URL('../assets/samples/', import.meta.url))).all().find(e => e.visual.animated)!;
  const meta = visualMeta({ message_id: 'animated', revision: e } as any); const receipts: string[] = [];
  const rpc = { visual: async () => ({ expression: e, primary: 'data:image/gif;base64,AAAA', poster: 'data:image/png;base64,BBBB' }), display: async (_s: string, _m: string, hash: string) => { receipts.push(hash); } } as any;
  await act(async () => root.render(React.createElement(AmojiImage, { rpc, sessionId: 's', refValue: e, meta })));
  const animated = dom.window.document.querySelector('img')!;
  await act(() => dom.window.document.querySelector('button')!.click());
  const poster = dom.window.document.querySelector('img')!;
  assert.notEqual(animated, poster);
  await act(() => animated.dispatchEvent(new dom.window.Event('load'))); assert.deepEqual(receipts, []);
  await act(() => poster.dispatchEvent(new dom.window.Event('load'))); assert.deepEqual(receipts, [meta.posterHash]);
});

test('真实 SlotRegistry 等待声明、随 owner collapse 清理并重新注入', async () => {
  const { SlotCore: Registry } = await import(new URL('../.cache/dsh-source/slots.mjs', import.meta.url).href);
  const slots = new Registry(); const cleanups: Array<() => void> = [];
  const ctx = { slots, effect(factory: () => () => void) { cleanups.push(factory()); }, connection: { rpc: { call: async () => ({ ok: true, value: [] }) } } } as ClientPort;
  apply(ctx); assert.equal(slots.entries('conversation.input.left').length, 0);
  const mount = () => slots.register({ name: 'root', children: { 'conversation.input.left': { kind: 'list', scope: 'session' }, 'conversation.chat.node': { kind: 'keyed', scope: 'session' }, 'tool.call.toolview': { kind: 'keyed', scope: 'session' } } }, () => null);
  const first = mount();
  const original = () => null;
  slots.register({ name: 'conversation.chat.node', key: 'user' }, original);
  await Promise.resolve();
  assert.equal(slots.entries('conversation.input.left').length, 1);
  assert.notEqual(slots.entriesOfSlot('conversation.chat.node')[0].component, original);
  first(); assert.equal(slots.entries('tool.call.toolview').length, 0);
  const second = mount(); assert.equal(slots.entries('tool.call.toolview').length, 1);
  cleanups.forEach(fn => fn()); assert.equal(slots.entries('conversation.input.left').length, 0);
  second(); const third = mount(); assert.equal(slots.entries('tool.call.toolview').length, 0); third();
});
