import test from 'node:test';
import assert from 'node:assert/strict';
import { hasExactExpressFirstSequence, isSuccessfulAmojiCall } from './live-tools-policy.mjs';

const completed = tool => ({ type: 'mcp_tool_call', server: 'amoji', tool, status: 'completed', result: { content: [] } });

test('express-first accepts exactly one successful express and pick in order', () => {
  assert.equal(hasExactExpressFirstSequence([completed('amoji_express'), completed('amoji_pick')]), true);
});

test('express-first rejects extra, searched or out-of-order related calls', () => {
  const rejected = [
    ['amoji_pick', 'amoji_express'],
    ['amoji_search', 'amoji_express', 'amoji_pick'],
    ['amoji_express', 'amoji_express', 'amoji_pick'],
    ['amoji_express', 'amoji_pick', 'amoji_pick'],
  ];
  for (const tools of rejected) {
    assert.equal(hasExactExpressFirstSequence(tools.map(completed)), false, tools.join(','));
  }
});

test('shared success predicate rejects another server and failed Amoji results', () => {
  assert.equal(isSuccessfulAmojiCall(completed('amoji_express'), 'amoji_express'), true);
  assert.equal(isSuccessfulAmojiCall({ ...completed('amoji_express'), server: 'other' }, 'amoji_express'), false);
  assert.equal(isSuccessfulAmojiCall({ ...completed('amoji_express'), status: 'failed' }, 'amoji_express'), false);
  assert.equal(isSuccessfulAmojiCall({ ...completed('amoji_express'), error: { message: 'failed' } }, 'amoji_express'), false);
  assert.equal(isSuccessfulAmojiCall({ ...completed('amoji_express'), result: { isError: true, content: [] } }, 'amoji_express'), false);
});
