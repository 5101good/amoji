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
  const rpc = { history: async () => { calls.push('history'); return [{ message, meta, host: { status: 'observed', requestId: 'amoji:m1' } }]; }, visual: async () => ({ expression: e, primary: 'data:image/png;base64,AAAA', poster: null }), display: async (_s: string, id: string) => { calls.push(id); } } as unknown as import('../src/dsh/contracts.js').DshRpc;
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

test('Picker 按居中/底部锚点和窄 viewport 限高，保留所有入口并清理定位监听', async t => {
  const { JSDOM } = await import('jsdom'); const { createRoot } = await import('react-dom/client'); const { act } = React;
  const { createComponents } = await import('../src/dsh/client.js');
  const dom = new JSDOM('<div id="root"></div>'); const before = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(dom.window, 'innerWidth', { value: 1280, writable: true }); Object.defineProperty(dom.window, 'innerHeight', { value: 720, writable: true });
  const root = createRoot(dom.window.document.getElementById('root')!); t.after(async () => { await act(() => root.unmount()); Object.assign(globalThis, before); dom.window.close(); });
  const rpc = { catalog: async () => [] } as unknown as import('../src/dsh/contracts.js').DshRpc;
  const Picker = createComponents(rpc).Picker;
  await act(() => root.render(React.createElement(Picker, { sessionId: 'zero-text' })));
  const anchor = dom.window.document.querySelector('button')!;
  let box = { left: 645, top: 411.5, bottom: 440, right: 690, width: 45, height: 28.5 };
  anchor.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, toJSON() {} });
  await act(async () => anchor.click());
  const panel = dom.window.document.querySelector<HTMLElement>('[aria-label="Amoji 表情选择"]')!;
  const bounded = () => {
    assert.equal(panel.style.position, 'fixed'); assert.equal(panel.style.boxSizing, 'border-box');
    const maxHeight = parseFloat(panel.style.maxHeight); const left = parseFloat(panel.style.left); const width = parseFloat(panel.style.width);
    const bottom = panel.style.bottom === 'auto' ? undefined : parseFloat(panel.style.bottom);
    const top = bottom === undefined ? parseFloat(panel.style.top) : dom.window.innerHeight - bottom - maxHeight;
    assert.ok(top >= 12, `top ${top}`); assert.ok(top + maxHeight <= dom.window.innerHeight - 12);
    assert.ok(left >= 12); assert.ok(left + width <= dom.window.innerWidth - 12);
    assert.equal(panel.style.overflow, 'hidden');
    assert.ok(panel.querySelector('.amoji-picker-body'), '中央列表独立滚动');
    for (const text of ['管理表情', '搜索', '经典', '办公', '关闭']) assert.ok([...panel.querySelectorAll('button')].some(button => (button.getAttribute('aria-label') ?? button.textContent) === text));
  };
  bounded();
  box = { ...box, top: 675, bottom: 703 }; await act(() => dom.window.dispatchEvent(new dom.window.Event('resize'))); bounded();
  Object.assign(dom.window, { innerWidth: 360, innerHeight: 640 }); box = { ...box, left: 300, right: 345, top: 40, bottom: 68 };
  await act(() => dom.window.dispatchEvent(new dom.window.Event('resize'))); bounded(); assert.equal(panel.style.bottom, 'auto');
  await act(() => [...panel.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '关闭')!.click());
  const previousLeft = panel.style.left; box = { ...box, left: 40 };
  await act(() => dom.window.dispatchEvent(new dom.window.Event('resize'))); assert.equal(panel.style.left, previousLeft);
});

test('核实后的用户表情只替换精确投影文本，原附件引用与额外文字保留，元数据移入详情', async t => {
  const { JSDOM } = await import('jsdom'); const { createRoot } = await import('react-dom/client'); const { act } = React;
  const { SampleCatalog } = await import('../src/sample-catalog.js'); const { modelProjection } = await import('../src/projection.js');
  const { visualMeta } = await import('../src/dsh/host.js'); const { mountUserMessages } = await import('../src/dsh/messages.js');
  const dom = new JSDOM('<div id="root"></div>'); const before = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById('root')!); t.after(async () => { await act(() => root.unmount()); Object.assign(globalThis, before); dom.window.close(); });
  const e = (await SampleCatalog.load(new URL('../assets/samples/', import.meta.url))).all()[0]!;
  const message = { message_id: 'confirmed', direction: 'human_to_ai', revision: e } as any; const meta = visualMeta(message);
  const row = { message, meta, host: { status: 'observed', requestId: 'amoji:confirmed', seq: 12 } };
  const rpc = { history: async () => [row], visual: async () => ({ expression: e, primary: 'data:image/png;base64,AAAA', poster: null }) } as any;
  const core = new SlotCore(); core.register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } } } as never, () => null);
  core.register({ name: 'conversation.chat.node', key: 'user' } as never, (props: any) => React.createElement('p', { 'data-native': true }, props.node.data.content.map((block: any) => block.type === 'text' ? block.text : '附件.pdf').join('|') + '|' + props.node.data.referenceLabels.join(',') + '|' + props.node.data.skillNames.join(',') + '|' + props.marker));
  const release = mountUserMessages(core as unknown as ClientPort['slots'], rpc); t.after(release);
  const View = core.entriesOfSlot('conversation.chat.node')[0]!.component as React.ComponentType<any>;
  const content = [{ type: 'text', text: modelProjection(e) }, { type: 'text', text: '另外写给你的话' }, { type: 'file', file: { name: '附件.pdf' } }]; const original = JSON.stringify(content);
  const render = (rpcId: string, seq = 12) => root.render(React.createElement(View, { sessionId: 's', marker: '宿主交互', node: { data: { seq, content, source: { kind: 'user', rpcId }, referenceLabels: ['文件引用'], skillNames: ['技能引用'] } } }));
  await act(async () => render('amoji:confirmed'));
  const native = dom.window.document.querySelector('[data-native]')!.textContent!;
  assert.ok(!native.includes(e.name)); assert.ok(!native.includes(e.semantics.meaning)); assert.doesNotMatch(native, /asset_id|revision_id/);
  assert.match(native, /另外写给你的话\|附件.pdf\|文件引用\|技能引用\|宿主交互/);
  assert.ok(dom.window.document.querySelector('img'));
  assert.ok(dom.window.document.querySelector('details')!.textContent!.includes(e.revision_id));
  assert.equal(JSON.stringify(content), original, '不得修改宿主持久消息内容');
  const { expressionMessageText } = await import('../src/dsh/expression-message.js');
  const contextual = [{ type: 'text', text: expressionMessageText(e) }];
  await act(async () => root.render(React.createElement(View, { sessionId: 's', marker: '宿主交互', node: { data: { seq: 12, content: contextual, source: { kind: 'user', rpcId: 'amoji:confirmed' }, referenceLabels: [], skillNames: [] } } })));
  assert.ok(!dom.window.document.querySelector('[data-native]'), '纯表情不重复原生文字气泡');
  assert.ok(dom.window.document.querySelector('details')!.textContent!.includes(e.semantics.meaning));
  assert.equal(contextual[0]!.text, expressionMessageText(e));
  await act(async () => render('amoji:unverified'));
  assert.ok(dom.window.document.querySelector('[data-native]')!.textContent!.includes('asset_id'));
  await act(async () => render('amoji:confirmed', 99));
  assert.ok(dom.window.document.querySelector('[data-native]')!.textContent!.includes('asset_id'), '错配原生行不能替换内容');
});

test('settled AI 表情错误展示原始失败并给文字fallback，不能继续显示等待', async () => {
  const { createComponents } = await import('../src/dsh/client.js');
  const Tool = createComponents({} as any).ToolView;
  const html = renderToStaticMarkup(React.createElement(Tool, { sessionId: 's', block: { kind: 'tool-result', isError: true, error: { name: 'Error', code: 'SELECTION_UNAVAILABLE' }, content: [{ type: 'text', text: 'SELECTION_UNAVAILABLE：选择凭据不存在，请重新检索' }] } } as any));
  assert.match(html, /SELECTION_UNAVAILABLE/); assert.match(html, /选择凭据不存在/); assert.match(html, /文字回应/); assert.doesNotMatch(html, /等待/);
  const settled = renderToStaticMarkup(React.createElement(Tool, { sessionId: 's', block: { kind: 'tool-result', isError: false, content: [{ type: 'text', text: '固定文字结果' }] } } as any));
  assert.match(settled, /固定文字结果/); assert.doesNotMatch(settled, /等待/);
  const codeOnly = renderToStaticMarkup(React.createElement(Tool, { sessionId: 's', block: { kind: 'tool-result', isError: true, error: { code: 'TURN_LIMIT' } } }));
  assert.match(codeOnly, /TURN_LIMIT/); assert.doesNotMatch(codeOnly, /等待/);
});
