import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  REGISTRY, actGloss, backchannelEligible, interruptEligible, lookupLocale, expressionText,
  validatePack, validateExpression, validateMessage, validatePreferences, validateRegistry,
} from '../src/protocol/index.js';

const classic = JSON.parse(await readFile(new URL('../assets/official-packs/classic.manifest.json', import.meta.url), 'utf8'));
const message = { kind: 'amoji.message', amoji: '0.1', registry_revision: REGISTRY.revision, message_id: '10000000-0000-4000-8000-000000000001', glyph_policy: 'keep', mode: 'turn', created_at: '2026-10-22T00:00:00Z' };

test('the registry is valid, closed and has no approval act', () => {
  validateRegistry(REGISTRY);
  assert.equal(REGISTRY.acts.length, 33);
  assert.ok(!REGISTRY.acts.some(a => /approve|allow|yes/.test(a.act)));
  assert.deepEqual(REGISTRY.acts.filter(a => a.authority === 'reduce').map(a => a.act), ['core:hold', 'core:stop']);
  assert.equal(actGloss('core:clarify', 'a2h', 'zh-Hant-TW').locale, 'en', 'no cross-script fallback from zh-Hant to zh-CN');
  assert.equal(actGloss('core:clarify', 'h2a', 'zh-CN').text, '没看懂，请换种说法');
});

test('language lookup truncates subtags but never crosses scripts', () => {
  assert.equal(lookupLocale(['zh-CN', 'en'], 'zh-Hant-TW', 'en'), 'en');
  assert.equal(lookupLocale(['zh', 'en'], 'zh-Hant-TW', 'en'), 'zh');
  assert.equal(lookupLocale(['zh-CN', 'en'], 'EN-us'), 'en');
  assert.equal(lookupLocale(['fr'], 'de', 'en'), undefined);
  const text = expressionText(classic.expressions[0], 'en-GB');
  assert.equal(text.locale, 'en');
  assert.equal(expressionText(classic.expressions[0], 'ja').locale, 'zh-CN', 'falls back to the original language');
});

test('correction signals are human, non-social acts; interrupts only reduce', () => {
  assert.equal(backchannelEligible('core:disagree'), true);
  assert.equal(backchannelEligible('core:thanks'), false);
  assert.equal(backchannelEligible('core:ready'), false, 'AI-only acts never interject');
  assert.equal(interruptEligible('core:stop'), true);
  assert.equal(interruptEligible('core:redirect'), false);
});

test('official packs validate; registry-only fields and incomplete languages are rejected', () => {
  validatePack(classic);
  const e = structuredClone(classic.expressions[0]);
  validateExpression(e);
  assert.throws(() => validateExpression({ ...e, authority: 'reduce' }), /只能由码位注册表定义/);
  assert.throws(() => validateExpression({ ...e, realizes: 'core:approve' }), /不在注册表/);
  assert.throws(() => validateExpression({ ...e, directions: ['a2h'], realizes: 'core:stop' }), /方向必须是码位允许方向的子集/);
  const untranslated = structuredClone(e); delete untranslated.semantics.en.translation;
  assert.throws(() => validateExpression(untranslated), /translation/);
  const partial = structuredClone(classic); delete partial.expressions[3].semantics.en;
  assert.throws(() => validatePack(partial), /缺少语言 en/);
  const decomposed = structuredClone(e); decomposed.name['zh-CN'] = 'é';
  assert.throws(() => validateExpression(decomposed), /NFC/);
  const unbound = structuredClone(classic); unbound.bindings[0].effects = ['20000000-0000-4000-8000-000000000009'];
  assert.throws(() => validatePack(unbound), /不在本包内/);
});

test('messages follow direction, mode and decision rules', () => {
  validateMessage({ ...message, from: { role: 'human' }, act: 'core:concern', note: '空数组会越界', mode: 'backchannel', sent_during: 'turn:3' });
  assert.throws(() => validateMessage({ ...message, from: { role: 'human' }, act: 'core:thanks', mode: 'backchannel', sent_during: 'x' }), /非关系类/);
  assert.throws(() => validateMessage({ ...message, from: { role: 'ai' }, glyph_policy: 'prefer', act: 'core:stop' }), /不允许此方向/);
  assert.throws(() => validateMessage({ ...message, from: { role: 'ai' }, glyph_policy: 'prefer', act: 'core:decide' }), /options/);
  validateMessage({ ...message, from: { role: 'ai' }, glyph_policy: 'prefer', act: 'core:decide', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  assert.throws(() => validateMessage({ ...message, from: { role: 'ai' }, glyph_policy: 'prefer', act: 'core:ack', note: '附言只属于人' }), /must NOT be valid/);
});

test('preferences keep quick entries sendable by people', () => {
  const preferences = { kind: 'amoji.preferences', amoji: '0.1', preferred_packs: [], quick_entries: ['core:clarify'], ai_expressions: { enabled: true, max_per_window: 1, families: { grounding: true, steering: true, progress: true, epistemic: true, social: false } }, reduce_motion: 'system' };
  validatePreferences(preferences);
  assert.throws(() => validatePreferences({ ...preferences, quick_entries: ['core:ready'] }), /快捷入口/);
  assert.throws(() => validatePreferences({ ...preferences, ai_expressions: { ...preferences.ai_expressions, max_per_window: 9 } }));
});
