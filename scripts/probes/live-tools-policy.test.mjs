import test from 'node:test';
import assert from 'node:assert/strict';
import { hasExactEmitFirstSequence, isSuccessfulAmojiCall } from './live-tools-policy.mjs';

const completed = tool => ({ type: 'mcp_tool_call', server: 'amoji', tool, status: 'completed', result: { content: [] } });

test('emit-first accepts exactly one successful search, emit, and pick in order', () => {
  assert.equal(hasExactEmitFirstSequence([
    completed('amoji_search'),
    completed('amoji_emit'),
    completed('amoji_pick'),
  ]), true);
});

test('emit-first rejects extra or out-of-order related calls', () => {
  const rejected = [
    ['amoji_pick', 'amoji_search', 'amoji_emit', 'amoji_pick'],
    ['amoji_search', 'amoji_pick', 'amoji_emit', 'amoji_pick'],
    ['amoji_search', 'amoji_search', 'amoji_emit', 'amoji_pick'],
    ['amoji_search', 'amoji_emit', 'amoji_emit', 'amoji_pick'],
    ['amoji_search', 'amoji_emit', 'amoji_pick', 'amoji_pick'],
  ];
  for (const tools of rejected) {
    assert.equal(hasExactEmitFirstSequence(tools.map(completed)), false, tools.join(','));
  }
});

test('shared success predicate rejects another server and failed Amoji results', () => {
  assert.equal(isSuccessfulAmojiCall(completed('amoji_emit'), 'amoji_emit'), true);
  assert.equal(isSuccessfulAmojiCall({ ...completed('amoji_emit'), server: 'other' }, 'amoji_emit'), false);
  assert.equal(isSuccessfulAmojiCall({ ...completed('amoji_emit'), status: 'failed' }, 'amoji_emit'), false);
  assert.equal(isSuccessfulAmojiCall({ ...completed('amoji_emit'), error: { message: 'failed' } }, 'amoji_emit'), false);
  assert.equal(isSuccessfulAmojiCall({ ...completed('amoji_emit'), result: { isError: true, content: [] } }, 'amoji_emit'), false);
});
