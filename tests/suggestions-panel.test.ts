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
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('等待建议面板操作超时');
}

test('真实面板DOM把建议保持为待选，支持修改采用、放弃、过期取消，并在故障后手工确认', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-suggestion-dom-'));
  const client = await SharedClient.connect({ directory });
  const panel = await PanelServer.start(new ConnectedRuntime(client), async () => {});
  const context = { host: 'codex' as const, sessionId: 'suggestion-dom-target', turnId: '1' };
  const url = new URL(panel.url(context));
  const nativeFetch = globalThis.fetch;
  const dom = new JSDOM(await (await nativeFetch(url)).text(), { url: url.href, runScripts: 'outside-only' });
  const globals = globalThis as Record<string, unknown>;
  const names = ['document', 'location', 'matchMedia', 'fetch', 'addEventListener', 'setInterval', 'FileReader'];
  const previous = new Map(names.map(name => [name, globals[name]]));
  let deferredSuggestion: { release(): void } | undefined;
  let deferredSave: { release(): void } | undefined;
  let failSuggestion = false;
  let obscureNextSave = false;
  let suggestionRequests = 0;
  let saveRequests = 0;
  Object.assign(globals, {
    document: dom.window.document,
    location: dom.window.location,
    FileReader: dom.window.FileReader,
    matchMedia: () => ({ matches: true, addEventListener: () => {} }),
    addEventListener: () => {},
    setInterval: () => 0,
    fetch: async (input: string, options?: RequestInit) => {
      if (input === '/api/suggest') {
        suggestionRequests++;
        if (failSuggestion) throw new TypeError('模拟建议服务不可用');
        if (deferredSuggestion) await new Promise<void>(resolve => { deferredSuggestion!.release = resolve; });
      }
      if (input === '/api/draft/save') {
        saveRequests++;
        if (deferredSave) await new Promise<void>(resolve => { deferredSave!.release = resolve; });
        const response = await nativeFetch(new URL(input, url), options);
        if (obscureNextSave) { obscureNextSave = false; throw new TypeError('模拟保存响应丢失'); }
        return response;
      }
      return nativeFetch(new URL(input, url), options);
    },
  });
  t.after(async () => {
    dom.window.close();
    for (const name of names) previous.get(name) === undefined ? delete globals[name] : globals[name] = previous.get(name);
    await panel.close();
    await client.close();
    await stopSharedService(directory, client.identity.serviceId);
    await rm(directory, { recursive: true, force: true });
  });
  await import(`${new URL('../web/panel.js', import.meta.url).href}?suggestions=${Date.now()}`);
  const doc = dom.window.document;
  const button = (id: string) => doc.querySelector<HTMLButtonElement>(`#${id}`)!;
  const input = (id: string) => doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
  button('new-draft').click();
  await eventually(() => !doc.querySelector<HTMLFieldSetElement>('#draft-fields')!.disabled);
  assert.ok(doc.querySelector('#suggestion-workbench'));
  assert.match(doc.querySelector('#suggestion-capability')!.textContent!, /本机文字规则.*未调用模型.*不读取图像/);

  input('suggestion-intent').value = '想真诚感谢对方';
  deferredSuggestion = { release() {} };
  button('request-suggestion').click();
  await eventually(() => suggestionRequests === 1);
  input('draft-meaning').value = '我正在手工填写';
  input('draft-meaning').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  deferredSuggestion.release();
  await eventually(() => !button('request-suggestion').disabled);
  assert.equal(doc.querySelector<HTMLElement>('#suggestion-result')!.hidden, true, '编辑后的迟到结果不得覆盖当前工作');
  assert.equal(input('draft-meaning').value, '我正在手工填写');

  deferredSuggestion = undefined;
  button('request-suggestion').click();
  await eventually(() => !doc.querySelector<HTMLElement>('#suggestion-result')!.hidden);
  assert.equal(input('draft-meaning').value, '我正在手工填写', '显示候选本身不得写入草稿表单');
  input('suggestion-result-meaning').value = '由我修改后的感谢含义';
  input('suggestion-result-tone').value = '克制而真诚';
  button('apply-suggestion').click();
  assert.equal(input('draft-meaning').value, '由我修改后的感谢含义');
  assert.equal(input('draft-tone').value, '克制而真诚');
  assert.equal((await client.getDraft((await client.listDrafts())[0]!.draft_id)).fields.semantics.meaning, '', '采用只更新待保存表单');

  input('suggestion-intent').value = '想鼓励对方';
  button('request-suggestion').click();
  await eventually(() => !doc.querySelector<HTMLElement>('#suggestion-result')!.hidden);
  button('reject-suggestion').click();
  assert.equal(doc.querySelector<HTMLElement>('#suggestion-result')!.hidden, true);
  assert.equal(input('draft-meaning').value, '由我修改后的感谢含义', '拒绝候选不撤销用户已有内容');

  button('request-suggestion').click();
  await eventually(() => !doc.querySelector<HTMLElement>('#suggestion-result')!.hidden);
  const activeDraftId = (await client.listDrafts())[0]!.draft_id;
  const versionBeforeSave = (await client.getDraft(activeDraftId)).version;
  button('save-draft').click();
  await eventually(() => doc.querySelector('#draft-status')!.textContent!.includes('草稿已保存'));
  assert.equal((await client.getDraft(activeDraftId)).version, versionBeforeSave + 1);
  assert.equal(doc.querySelector<HTMLElement>('#suggestion-result')!.hidden, true, '候选显示后保存成功必须使旧版本候选失效');
  assert.equal(button('apply-suggestion').disabled, true);

  deferredSuggestion = { release() {} };
  deferredSave = { release() {} };
  const requestsBeforeRace = suggestionRequests;
  const savesBeforeRace = saveRequests;
  button('request-suggestion').click();
  await eventually(() => suggestionRequests === requestsBeforeRace + 1);
  button('save-draft').click();
  await eventually(() => saveRequests === savesBeforeRace + 1);
  deferredSuggestion.release();
  await eventually(() => !doc.querySelector<HTMLElement>('#suggestion-result')!.hidden);
  assert.equal(button('apply-suggestion').disabled, true, '并发保存期间不得采用绑定旧版本的候选');
  const meaningBeforeForcedApply = input('draft-meaning').value;
  button('apply-suggestion').disabled = false;
  button('apply-suggestion').click();
  assert.equal(input('draft-meaning').value, meaningBeforeForcedApply, '采用处理器必须独立复核候选与当前草稿上下文');
  deferredSave.release();
  await eventually(() => doc.querySelector('#draft-status')!.textContent!.includes('草稿已保存'));
  assert.equal(doc.querySelector<HTMLElement>('#suggestion-result')!.hidden, true, '建议先返回、保存后返回时旧候选也必须失效');
  deferredSuggestion = undefined;
  deferredSave = undefined;

  button('request-suggestion').click();
  await eventually(() => !doc.querySelector<HTMLElement>('#suggestion-result')!.hidden);
  const versionBeforeUnknownSave = (await client.getDraft(activeDraftId)).version;
  obscureNextSave = true;
  button('save-draft').click();
  await eventually(() => doc.querySelector('#draft-status')!.textContent!.includes('DRAFT_OUTCOME_UNKNOWN'));
  assert.equal((await client.getDraft(activeDraftId)).version, versionBeforeUnknownSave + 1, '保存响应虽丢失，服务端已产生新版本');
  assert.equal(button('apply-suggestion').disabled, true, '保存结果待核对期间不得采用候选');
  button('save-draft').click();
  await eventually(() => doc.querySelector('#draft-status')!.textContent!.includes('草稿已保存'));
  assert.equal(doc.querySelector<HTMLElement>('#suggestion-result')!.hidden, true, '核对保存成功取得新版本后必须使旧候选失效');

  deferredSuggestion = { release() {} };
  const cancelRequest = suggestionRequests;
  button('request-suggestion').click();
  await eventually(() => suggestionRequests === cancelRequest + 1);
  button('cancel-suggestion').click();
  deferredSuggestion.release();
  await eventually(() => !button('request-suggestion').disabled);
  assert.equal(doc.querySelector<HTMLElement>('#suggestion-result')!.hidden, true);

  deferredSuggestion = { release() {} };
  input('suggestion-intent').value = '切换草稿前的旧请求';
  const switchRequest = suggestionRequests;
  button('request-suggestion').click();
  await eventually(() => suggestionRequests === switchRequest + 1);
  button('new-draft').click();
  await eventually(() => doc.querySelectorAll('#draft-list option').length === 2);
  deferredSuggestion.release();
  await eventually(() => !button('request-suggestion').disabled);
  assert.equal(doc.querySelector<HTMLElement>('#suggestion-result')!.hidden, true, '切换草稿后旧结果不得进入新草稿');

  deferredSuggestion = undefined;
  failSuggestion = true;
  input('suggestion-intent').value = '故障时仍手工完成';
  input('draft-meaning').value = '切换后的手工内容';
  button('request-suggestion').click();
  await eventually(() => doc.querySelector('#suggestion-status')!.textContent!.includes('建议不可用'));
  assert.equal(input('draft-meaning').value, '切换后的手工内容');

  input('draft-name').value = '手工完成';
  input('draft-meaning').value = '建议不可用时仍然保留并确认我的含义';
  input('draft-fallback').value = '手工完成';
  input('draft-tone').value = '平静';
  input('draft-use').value = '建议服务不可用时';
  input('draft-avoid').value = '需要精确操作说明时';
  input('draft-license').value = '仅供个人使用';
  const source = (await client.list())[0]!;
  const bytes = await readFile(await client.blobPath(source.visual.primary.sha256));
  const file = new dom.window.File([new Uint8Array(bytes)], 'manual.png', { type: source.visual.primary.mime });
  Object.defineProperty(input('draft-file'), 'files', { configurable: true, value: [file] });
  input('draft-file').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  button('preview-draft').click();
  await eventually(() => !!doc.querySelector('#draft-preview img'));
  doc.querySelector<HTMLImageElement>('#draft-preview img')!.dispatchEvent(new dom.window.Event('load'));
  await eventually(() => !button('confirm-draft').disabled);
  button('confirm-draft').click();
  await eventually(() => doc.querySelector('#draft-status')!.textContent!.includes('已加入共享库'));
  const created = (await client.list()).find(item => item.name === '手工完成')!;
  assert.equal(created.semantics.meaning, '建议不可用时仍然保留并确认我的含义');
});
