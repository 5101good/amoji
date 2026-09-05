import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexContext } from '../src/codex-context.js';

test('仅从实际 MCP 元数据绑定会话和回合', () => {
  const meta = { threadId: 'thread-a', 'x-codex-turn-metadata': { thread_id: 'thread-a', session_id: 'thread-a', turn_id: 'turn-1' } };
  assert.deepEqual(codexContext(meta), { host: 'codex', sessionId: 'thread-a', turnId: 'turn-1' });
  assert.throws(() => codexContext({ session_id: 'guessed-by-model', turn_id: '1' }), /上下文/);
  assert.throws(() => codexContext({ ...meta, threadId: 'thread-b' }), /不一致/);
  assert.throws(() => codexContext({ ...meta, 'x-codex-turn-metadata': { thread_id: 'thread-a' } }), /上下文/);
});
