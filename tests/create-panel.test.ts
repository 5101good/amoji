import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { SharedClient, stopSharedService } from '../src/shared-client.js';
import { ConnectedRuntime } from '../src/adapter-runtime.js';
import { PanelServer } from '../src/panel-server.js';

async function eventually(predicate: () => boolean) {
  for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('等待真实面板操作超时');
}

test('真实面板DOM上传、保存恢复、字段与媒体错误保留、预览返回修改、确认后选择发送同一版本', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-create-dom-'));
  const client = await SharedClient.connect({ directory });
  const panel = await PanelServer.start(new ConnectedRuntime(client), async () => {});
  const context = { host: 'codex' as const, sessionId: 'create-dom-target', turnId: '1' };
  const pending = panel.pick(context, new AbortController().signal);
  void pending.catch(() => {});
  const url = new URL(panel.url(context));
  const nativeFetch = globalThis.fetch;
  const dom = new JSDOM(await (await nativeFetch(url)).text(), { url: url.href, runScripts: 'outside-only' });
  const globals = globalThis as Record<string, unknown>;
  const names = ['document', 'location', 'matchMedia', 'fetch', 'addEventListener', 'setInterval', 'FileReader'];
  const previous = new Map(names.map(name => [name, globals[name]]));
  t.after(async () => {
    dom.window.close(); for (const name of names) previous.get(name) === undefined ? delete globals[name] : globals[name] = previous.get(name);
    await panel.close(); await client.close(); await stopSharedService(directory, client.identity.serviceId); await rm(directory, { recursive: true, force: true });
  });
  Object.assign(globals, {
    document: dom.window.document, location: dom.window.location, FileReader: dom.window.FileReader,
    fetch: (input: string, options?: RequestInit) => nativeFetch(new URL(input, url), options),
    matchMedia: () => ({ matches: true, addEventListener: () => {} }), addEventListener: () => {}, setInterval: () => 0,
  });
  await import(`${new URL('../web/panel.js', import.meta.url).href}?create=${Date.now()}`);
  const doc = dom.window.document;
  const button = (id: string) => doc.querySelector<HTMLButtonElement>(`#${id}`)!;
  const input = (id: string) => doc.querySelector<HTMLInputElement>(`#${id}`)!;
  assert.ok(button('new-draft'), '面板必须提供创建入口');
  button('new-draft').click();
  await eventually(() => !doc.querySelector<HTMLFieldSetElement>('#draft-fields')!.disabled);
  input('draft-name').value = '😀'.repeat(48);
  assert.equal(input('draft-name').hasAttribute('maxlength'), false, '不能用UTF16 maxlength截断合法名称');
  input('draft-meaning').value = '  ';
  input('draft-fallback').value = '为努力鼓掌';
  input('draft-tone').value = '真诚认可';
  input('draft-use').value = '对方完成一小步';
  const source = (await client.list()).find(e => e.visual.animated)!;
  const bytes = await readFile(await client.blobPath(source.visual.primary.sha256));
  const file = new dom.window.File([new Uint8Array(bytes)], 'my-animation.gif', { type: 'image/gif' });
  Object.defineProperty(input('draft-file'), 'files', { configurable: true, value: [file] });
  input('draft-file').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  button('preview-draft').click();
  await eventually(() => doc.querySelector('#draft-status')!.textContent!.includes('INVALID_SCHEMA'));
  assert.equal(input('draft-meaning').value, '  ');
  assert.equal(input('draft-file').files![0]!.name, 'my-animation.gif');
  assert.equal((await client.list()).length, 3);
  input('draft-meaning').value = '认可持续投入与小小进步';
  button('save-draft').click();
  await eventually(() => doc.querySelector('#draft-status')!.textContent!.includes('草稿已保存'));
  const saved = (await client.listDrafts())[0]!;
  assert.equal(saved.fields.name, '😀'.repeat(48));
  const bad = new dom.window.File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' });
  Object.defineProperty(input('draft-file'), 'files', { configurable: true, value: [bad] });
  input('draft-file').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  button('preview-draft').click();
  await eventually(() => doc.querySelector('#draft-status')!.textContent!.includes('MEDIA_UNSUPPORTED'));
  assert.equal(input('draft-meaning').value, '认可持续投入与小小进步');
  button('restore-draft').click();
  await eventually(() => input('draft-file').value === '' && doc.querySelector('#draft-status')!.textContent!.includes('已恢复'));
  button('preview-draft').click();
  await eventually(() => !button('confirm-draft').disabled && !!doc.querySelector('#draft-preview img'));
  assert.match(doc.querySelector('#draft-preview')!.textContent!, /认可持续投入与小小进步/);
  const posterUrl = doc.querySelector<HTMLImageElement>('#draft-preview img')!.src;
  assert.ok(button('draft-motion'), '确认前应能够检查上传动图的实际播放');
  button('draft-motion').click();
  await eventually(() => doc.querySelector<HTMLImageElement>('#draft-preview img')!.src !== posterUrl);
  assert.equal(button('draft-motion').textContent, '暂停预览动图');
  button('draft-motion').click();
  await eventually(() => doc.querySelector<HTMLImageElement>('#draft-preview img')!.src === posterUrl);
  assert.match(doc.querySelector('#session')!.getAttribute('title')!, /create-dom-target/);
  assert.equal((await client.list()).length, 3);
  button('back-draft').click();
  assert.equal(button('confirm-draft').disabled, true);
  input('draft-name').value = '新建鼓励';
  button('preview-draft').click();
  await eventually(() => !button('confirm-draft').disabled);
  button('confirm-draft').click();
  await eventually(() => doc.querySelector('#draft-status')!.textContent!.includes('已加入共享库') && doc.querySelectorAll('#catalog .sticker').length === 4);
  const created = (await client.list()).find(e => e.name === '新建鼓励')!;
  assert.ok(created);
  button('send').click();
  const message = await pending;
  assert.deepEqual(message.revision, created);
  assert.equal(message.revision.semantics.meaning, '认可持续投入与小小进步');
  await eventually(() => doc.querySelector('#status')!.textContent!.includes('已提交固定语义') && doc.querySelector('#connection')!.textContent!.includes('可再次选择'));
});
