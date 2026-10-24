import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedClient, stopSharedService } from '../src/shared-client.js';

test('共享建议器只按文字返回可编辑候选，不写草稿或资产，也不冒充模型', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-suggestions-'));
  const client = await SharedClient.connect({ directory });
  t.after(async () => {
    await client.close();
    await stopSharedService(directory, client.identity.serviceId);
    await rm(directory, { recursive: true, force: true });
  });
  assert.ok(client.identity.capabilities?.includes('text-suggestions-v1'));
  const draft = await client.createDraft();
  const expressions = await client.list();
  const suggestion = await client.suggestText('想表达对方做得很棒，真诚感谢', '对方帮我解决难题');
  assert.equal(suggestion.method, 'local-deterministic-v1');
  assert.match(suggestion.notice, /本机.*文字.*未调用模型.*不读取图像.*码位/);
  assert.deepEqual(suggestion.fields, {
    realizes: 'core:thanks', intensity: 2, original_locale: 'zh-CN',
    name: { 'zh-CN': '真诚感谢' },
    semantics: { 'zh-CN': {
      meaning: '想表达对方做得很棒，真诚感谢',
      fallback: '[谢谢你]',
      use_when: ['对方帮我解决难题'],
      avoid_when: ['需要具体事实、承诺或操作说明时'],
    } },
    tags: { 'zh-CN': ['感谢', '认可'] },
  });
  const english = await client.suggestText('Thank you for fixing the build');
  assert.deepEqual([english.fields.realizes, english.fields.original_locale, english.fields.name], ['core:thanks', 'en', { en: 'Thank you' }], 'English intent drafts English semantics');
  assert.deepEqual(await client.getDraft(draft.draft_id), draft, '候选未经采用不得写入草稿');
  assert.deepEqual(await client.list(), expressions, '文字建议不得创建可发送版本');
  assert.equal(JSON.stringify(suggestion).includes('blob'), false);
  assert.equal(JSON.stringify(suggestion).includes('path'), false);
});

test('建议器拒绝空白、越界和非文字输入，不截断最终语义', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-suggestion-bounds-'));
  const client = await SharedClient.connect({ directory });
  t.after(async () => {
    await client.close();
    await stopSharedService(directory, client.identity.serviceId);
    await rm(directory, { recursive: true, force: true });
  });
  await assert.rejects(client.suggestText('   '), /SUGGESTION_INPUT_INVALID/);
  await assert.rejects(client.suggestText('😀'.repeat(241)), /SUGGESTION_INPUT_TOO_LONG/);
  await assert.rejects(client.suggestText('鼓励', 'a'.repeat(65)), /SUGGESTION_INPUT_TOO_LONG/);
  await assert.rejects((client as any).suggestText({ image: 'secret.png' }), /SUGGESTION_INPUT_INVALID/);
  const exactNotes = Array.from({ length: 4 }, (_, index) => String(index).repeat(64));
  const boundary = await client.suggestText('鼓励', exactNotes.join('\r\n'));
  assert.deepEqual(boundary.fields.semantics['zh-CN']!.use_when, exactNotes, '合法的四行 64 code point CRLF 说明必须原样进入语境');
  await assert.rejects((client as any).suggestText('鼓励', null), /SUGGESTION_INPUT_INVALID/);
  const exact = '😀'.repeat(240);
  const suggestion = await client.suggestText(exact);
  assert.equal(suggestion.fields.semantics.en!.meaning, exact, 'emoji-only intent is not Chinese, so the draft is English');
  assert.equal([...suggestion.fields.semantics.en!.meaning].length, 240);
});

test('协作建议能表达进度澄清和控制意图，不误作庆祝或排斥事实询问',async()=>{
 const {suggestText}=await import('../src/suggestions.js');
 for(const [intent,name,act] of [['任务完成多少了，报告进度','进度如何','core:checkin'],['请举个具体例子','举个例子','core:example'],['哪里卡住了','卡在哪里','core:checkin'],['说具体些，我没看懂','说具体些','core:elaborate'],['先等一下，暂停','先等一下','core:hold'],['按已确认的方向继续','继续吧','core:continue'],['方向不对，请重新对齐','方向不对','core:redirect']] as const){
  const value=suggestText(intent);
  assert.deepEqual([value.fields.name['zh-CN'],value.fields.realizes],[name,act],intent);
  assert.equal(value.fields.semantics['zh-CN']!.meaning,intent);
  assert.ok(!value.fields.semantics['zh-CN']!.avoid_when?.includes('需要具体事实、承诺或操作说明时'));
 }
});
