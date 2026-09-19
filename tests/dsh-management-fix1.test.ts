import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { DraftEditor } from '../src/dsh/draft-editor.js';
import { LibraryControls } from '../src/dsh/library-controls.js';
import { Manager } from '../src/dsh/manager.js';
import { createRpc } from '../src/dsh/media.js';
import { SampleCatalog } from '../src/sample-catalog.js';
import type { Draft } from '../src/drafts.js';
const expressions = (await SampleCatalog.load(new URL('../assets/samples/', import.meta.url))).all();
const a = expressions[0]!, b = expressions[1]!;
const base: Draft = { draft_id: 'fix', version: 1, updated_at: 'now', fields: { name: a.name, semantics: a.semantics, rights: a.rights }, visual: a.visual };
async function fixture(t: TestContext) {
  const dom = new JSDOM('<div id="root"></div>');
  const old = { window: globalThis.window, document: globalThis.document, FileReader: globalThis.FileReader };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, FileReader: dom.window.FileReader, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById('root')!);
  t.after(async () => { await React.act(() => root.unmount()); Object.assign(globalThis, old); dom.window.close(); });
  const button = (text: string) => [...dom.window.document.querySelectorAll('button')].find(v => v.textContent === text)!;
  return { dom, root, button };
}
test('fix1 新预览等待时旧load不得授权新图确认', async t => {
  const f = await fixture(t); let version = 1; let deliver!: (v: unknown) => void;
  const rpc: any = { management: async (_s: string, method: string) => {
    if (method === 'saveDraft') return { ...base, version: ++version };
    if (method === 'previewDraft') return version === 2 ? { draft: { ...base, version }, primary: 'data:image/png;base64,AAAA', poster: null } : new Promise(r => { deliver = r; });
  } };
  await React.act(() => f.root.render(React.createElement(DraftEditor, { rpc, sessionId: 's', initial: { ...base, draft_id: 'old-load' }, onCreated() {} })));
  await React.act(async () => f.button('保存并预览').click());
  const old = f.dom.window.document.querySelector('img')!;
  await React.act(async () => f.button('保存并预览').click());
  await React.act(() => old.dispatchEvent(new f.dom.window.Event('load')));
  await React.act(() => deliver({ draft: { ...base, version }, primary: 'data:image/png;base64,BBBB', poster: null }));
  const current = f.dom.window.document.querySelector('img')!;
  assert.notEqual(current, old);
  const checkbox = f.dom.window.document.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  assert.equal(checkbox.disabled, true, '新图没有load，必须不能勾选');
  await React.act(() => current.dispatchEvent(new f.dom.window.Event('load')));
  await React.act(() => checkbox.click());
  assert.equal(f.button('确认加入表情库').disabled, false);
});
test('fix1 条目B读取期间不能操作A详情，失败不出现混合对象', async t => {
  const f = await fixture(t); let reject!: (reason: Error) => void; const mutations: unknown[] = [];
  const rpc: any = { management: async (_s: string, method: string, args: any) => {
    if (method === 'revisionVisual') return { expression: args.ref.asset_id === a.asset_id ? a : b, primary: 'data:image/png;base64,AAAA', poster: null };
    if (method === 'listRevisions') return args.asset_id === a.asset_id ? [a] : new Promise((_r, r) => { reject = r; });
    mutations.push(args);
  } };
  await React.act(async () => f.root.render(React.createElement(LibraryControls, { rpc, sessionId: 's', entries: [a, b].map(expression => ({ expression, origin: 'imported' as const, version: 1, archived: false })), refresh: async () => {}, onDraft() {}, refs: [], setRefs() {} })));
  await React.act(async () => f.button(a.name).click());
  assert.ok(f.button('归档表情'));
  await React.act(async () => f.button(b.name).click());
  assert.equal(!!f.dom.window.document.querySelector('[aria-label="版本与条目操作"]'), false);
  await React.act(() => reject(new Error('版本读取失败')));
  assert.equal(!!f.button('归档表情'), false);
  assert.deepEqual(mutations, []);
  assert.match(f.dom.window.document.body.textContent!, /版本读取失败/);
});
test('fix1 导入TimeoutError和坏成功正文统一UNKNOWN，结构化业务错误保留', async t => {
  const old = globalThis.fetch; t.after(() => { globalThis.fetch = old; });
  const rpc = createRpc({} as any), file = new File(['zip'], 'original.amoji');
  for (const scenario of [async () => { throw new DOMException('timeout', 'TimeoutError'); }, async () => Response.json({}), async () => { throw Object.assign(new Error('reset'), { code: 'ECONNRESET' }); }, async () => Response.json({ result: { pack_id: 'p', added: 1, existing: -1, defaults: [] } })]) {
    globalThis.fetch = scenario;
    await assert.rejects(rpc.importPack('s', file), (error: any) => error.code === 'PACK_OUTCOME_UNKNOWN');
  }
  globalThis.fetch = async () => Response.json({ error: { code: 'PACK_CONFLICT', message: '包冲突', details: { current: { version: 3 } } } }, { status: 400 });
  await assert.rejects(rpc.importPack('s', file), (error: any) => error.code === 'PACK_CONFLICT' && error.current.version === 3);
});
test('fix1 上传保存后ENTRY_CONFLICT续编仍保存本次图片', async t => {
  const f = await fixture(t); let active = { ...base, draft_id: 'retain-image' }; const saves: any[] = [];
  const original = 'aGVsbG8=';
  const rpc: any = { management: async (_s: string, method: string, args: any) => {
    if (method === 'saveDraft') { saves.push(args); active = { ...active, draft_id: args.draft_id, fields: args.fields, version: args.version + 1 }; return active; }
    if (method === 'previewDraft') return { draft: active, primary: `data:image/png;base64,${original}`, poster: null };
    if (method === 'confirmDraft') throw Object.assign(new Error('并发修改'), { code: 'ENTRY_CONFLICT', current: { expression: b, origin: 'local', version: 2 } });
    if (method === 'startRevisionDraft') return { ...base, draft_id: 'new-base', visual: b.visual };
  } };
  await React.act(() => f.root.render(React.createElement(DraftEditor, { rpc, sessionId: 's', initial: active, onCreated() {} })));
  const input = f.dom.window.document.querySelector<HTMLInputElement>('[aria-label="上传表情图片"]')!;
  Object.defineProperty(input, 'files', { value: [new f.dom.window.File(['hello'], 'mine.png')] });
  await React.act(async () => { input.dispatchEvent(new f.dom.window.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 10)); });
  await React.act(async () => f.button('保存并预览').click());
  await React.act(() => f.dom.window.document.querySelector('img')!.dispatchEvent(new f.dom.window.Event('load')));
  await React.act(() => f.dom.window.document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await React.act(async () => f.button('确认加入表情库').click());
  await React.act(async () => f.button('基于当前版本继续，保留本次填写').click());
  await React.act(async () => f.button('保存草稿').click());
  assert.equal(saves[0].upload, original);
  assert.equal(saves.at(-1).draft_id, 'new-base');
  assert.equal(saves.at(-1).upload, original, '新基准草稿必须迁移已保存的本次图片');
});
test('fix1 Manager保存草稿立即更新列表名称且保留编辑输入', async t => {
  const f = await fixture(t); const initial = { ...base, draft_id: 'rename', fields: { ...base.fields, name: '' } };
  const rpc: any = { management: async (_s: string, method: string, args: any) => {
    if (method === 'listEntries' || method === 'listDrafts') return [];
    if (method === 'getSettings') return { version: 1, style: 'neutral', frequency: 'restrained', paused: false };
    if (method === 'createDraft') return initial;
    if (method === 'saveDraft') return { ...initial, version: 2, fields: args.fields };
  } };
  await React.act(async () => f.root.render(React.createElement(Manager, { rpc, sessionId: 's', currentSessionId: 's', open: true, onClose() {}, onChanged() {} })));
  await React.act(() => f.button('创作与草稿').click());
  await React.act(async () => f.button('新建表情').click());
  const name = f.dom.window.document.querySelector<HTMLInputElement>('[aria-label="名称"]')!;
  await React.act(() => { name.value = '我的草稿'; name.dispatchEvent(new f.dom.window.Event('input', { bubbles: true })); });
  await React.act(async () => f.button('保存草稿').click());
  assert.ok(f.button('我的草稿'));
  assert.equal(!!f.button('未命名草稿'), false);
  assert.equal(name.value, '我的草稿');
});

test('fix1 真实共享服务冲突续编保留上传图片hash并完成新版本确认', async t => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { startSharedService } = await import('../src/shared-service.js');
  const { SharedClient } = await import('../src/shared-client.js');
  const { ConnectedRuntime } = await import('../src/adapter-runtime.js');
  const { management } = await import('../src/dsh/host-management.js');
  const directory = await mkdtemp(join(tmpdir(), 'amoji-d4-fix1-'));
  const service = await startSharedService(directory, new URL('../assets/samples/', import.meta.url));
  const client = await SharedClient.connect({ directory });
  t.after(async () => { await client.close(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  const originalBytes = await readFile(new URL(`../assets/samples/blobs/${a.visual.primary.sha256}`, import.meta.url));
  const myBytes = await readFile(new URL(`../assets/samples/blobs/${b.visual.primary.sha256}`, import.meta.url));
  const seed = await client.createDraft();
  const saved = await client.saveDraft(seed.draft_id, seed.version, base.fields, originalBytes.toString('base64'));
  const personal = await client.confirmDraft(saved.draft_id, saved.version);
  const entry = await client.getEntry(personal.asset_id);
  const editing = await client.startRevisionDraft({ asset_id: personal.asset_id, revision_id: personal.revision_id }, entry.version);
  const f = await fixture(t); const runtime = new ConnectedRuntime(client);
  const rpc: any = { management: (_session: string, method: string, args: unknown) => management(runtime, method, args) };
  let created: typeof personal | undefined;
  await React.act(() => f.root.render(React.createElement(DraftEditor, { rpc, sessionId: 'fixture', initial: editing, onCreated(value) { created = value; } })));
  const input = f.dom.window.document.querySelector<HTMLInputElement>('[aria-label="上传表情图片"]')!;
  Object.defineProperty(input, 'files', { value: [new f.dom.window.File([myBytes], 'my-picture.png')] });
  await React.act(async () => { input.dispatchEvent(new f.dom.window.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 10)); });
  const waitFor = async (ready: () => boolean) => {
    for (let attempt = 0; attempt < 100 && !ready(); attempt++) await React.act(async () => { await new Promise(r => setTimeout(r, 10)); });
    assert.ok(ready(), '异步UI操作在期限内完成');
  };
  await React.act(() => f.button('保存并预览').click());
  await waitFor(() => !!f.dom.window.document.querySelector('img'));
  const concurrent = await client.startRevisionDraft({ asset_id: personal.asset_id, revision_id: personal.revision_id }, entry.version);
  const competing = await client.saveDraft(concurrent.draft_id, concurrent.version, { ...base.fields, name: '其他客户端更新' });
  await client.confirmDraft(competing.draft_id, competing.version);
  await React.act(() => f.dom.window.document.querySelector('img')!.dispatchEvent(new f.dom.window.Event('load')));
  await React.act(() => f.dom.window.document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await React.act(() => f.button('确认加入表情库').click());
  await waitFor(() => !!f.button('基于当前版本继续，保留本次填写'));
  await React.act(() => f.button('基于当前版本继续，保留本次填写').click());
  await waitFor(() => /本次填写仍保留/.test(f.dom.window.document.body.textContent!));
  await React.act(() => f.button('保存并预览').click());
  await waitFor(() => !!f.dom.window.document.querySelector('img'));
  await React.act(() => f.dom.window.document.querySelector('img')!.dispatchEvent(new f.dom.window.Event('load')));
  await React.act(() => f.dom.window.document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await React.act(() => f.button('确认加入表情库').click());
  await waitFor(() => !!created);
  assert.equal(created!.visual.primary.sha256, b.visual.primary.sha256);
  assert.equal(created!.asset_id, personal.asset_id);
  assert.notEqual(created!.revision_id, personal.revision_id);
});
