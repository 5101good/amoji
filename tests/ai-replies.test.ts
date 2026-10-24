import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './helpers/store-runtime.js';

// Natural queries an AI would write when it wants to respond, and the act each should find.
const cases: Array<[string, string, string]> = [
  ['接手用户已授权的任务，我来处理', 'core:claim', 'zh-CN'],
  ['正在核对资料和结果', 'core:working', 'zh-CN'],
  ['需要用户在几个方案里选一个', 'core:decide', 'zh-CN'],
  ['承认是我理解错了并纠正', 'core:misread', 'zh-CN'],
  ['目前证据不足，坦诚表达不确定', 'core:uncertain', 'zh-CN'],
  ['回应用户的感谢，说不客气', 'core:welcome', 'zh-CN'],
  ['the result is ready for you to check', 'core:ready', 'en'],
  ['respect the effort you put in', 'core:recognize', 'en'],
];

test('AI-perspective queries in either language find the matching act in each appearance', async () => {
  const { store, close } = await openStore();
  try {
    const packs = store.listPacks().filter(p => ['Classic', 'Office'].includes(p.name.en!));
    assert.equal(packs.length, 2);
    for (const [index, [query, act, locale]] of cases.entries()) {
      const context = { host: 'dsh' as const, hostInstanceId: 'p', sessionId: `ai-${index}`, turnId: '1' };
      const result = store.search(context, query, 5, locale);
      assert.ok(!JSON.stringify(result).includes('visual'), 'search results carry no media');
      const chosen = result.candidates.find(c => c.act === act);
      assert.ok(chosen, `${query} -> ${result.candidates.map(c => c.act).join(', ')}`);
      const sent = store.express(context, { selection_token: chosen.selection_token, ...(act === 'core:decide' ? { options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } : {}) });
      assert.ok(sent.status === 'sent', JSON.stringify(sent));
      assert.equal(sent.message.direction, 'ai_to_human');
      assert.equal(sent.message.act, act);
      assert.ok(packs.some(p => p.expressions.some(e => e.revision_id === sent.message.revision?.revision_id)));
    }
  } finally { await close(); }
});
