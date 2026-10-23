import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { withValidatedPack } from '../src/packs.js';
import { openStore } from './helpers/store-runtime.js';
import type { BindingContext } from '../src/shared-contract.js';

const context = (turn = 'turn:1'): BindingContext => ({ host: 'dsh', hostInstanceId: 'test', sessionId: 'session-1', turnId: turn });
const classic = JSON.parse(await readFile(new URL('../assets/official-packs/classic.manifest.json', import.meta.url), 'utf8'));
const office = JSON.parse(await readFile(new URL('../assets/official-packs/office.manifest.json', import.meta.url), 'utf8'));

test('built-in packs seed the library; preferred packs order glyph choice', async () => {
  const { store, close } = await openStore();
  try {
    assert.equal(store.list().length, 48);
    assert.deepEqual(store.getSettings().preferred_packs, [classic.pack_id, office.pack_id]);
    const sent = store.express(context(), { act: 'core:thanks' });
    assert.equal(sent.status, 'sent');
    assert.ok(sent.status === 'sent' && classic.expressions.some((e: { asset_id: string }) => e.asset_id === sent.message.revision!.asset_id));
    assert.equal(sent.status === 'sent' && sent.message.glyph_policy, 'prefer');
    const settings = store.getSettings();
    store.updateSettings(settings.version, { ...settings, preferred_packs: [office.pack_id, classic.pack_id] });
    const again = store.express(context('turn:2'), { act: 'core:thanks' });
    assert.ok(again.status === 'sent' && office.expressions.some((e: { asset_id: string }) => e.asset_id === again.message.revision!.asset_id));
  } finally { await close(); }
});

test('AI expressions are checked in RFC order and rejected with reason codes', async () => {
  const { store, close } = await openStore();
  try {
    const reason = (input: Parameters<typeof store.express>[1], turn = 'turn:9') => { const r = store.express(context(turn), input); return r.status === 'rejected' ? r.reason : 'sent'; };
    assert.equal(reason({ act: 'core:approve' }), 'unknown_act');
    assert.equal(reason({ act: 'core:stop' }), 'direction_not_allowed');
    assert.equal(reason({ act: 'core:decide' }), 'invalid_options');
    assert.equal(reason({ act: 'core:ack', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }), 'invalid_options');
    assert.equal(reason({ act: 'core:ack', replies: ['core:ready'] }), 'invalid_replies');
    assert.equal(reason({ act: 'core:ack', rationale: 'x'.repeat(81) }), 'budget_exceeded');
    assert.equal(reason({ act: 'core:thanks', pending_confirmation: true }), 'pending_confirmation');
    assert.equal(reason({ act: 'core:ack' }), 'sent');
    assert.equal(reason({ act: 'core:uncertain' }), 'rate_limited', 'one AI expression per response window by default');
    assert.equal(reason({ act: 'core:decide', options: [{ id: 'keep', label: '保持接口' }, { id: 'break', label: '修改接口' }] }, 'turn:10'), 'sent');
    const settings = store.getSettings();
    store.updateSettings(settings.version, { ...settings, ai_expressions: { ...settings.ai_expressions, max_per_window: 3, families: { ...settings.ai_expressions.families, social: false } } });
    assert.equal(reason({ act: 'core:thanks' }, 'turn:10'), 'family_disabled');
    assert.equal(reason({ act: 'core:encourage' }, 'turn:11'), 'family_disabled');
    const paused = store.getSettings();
    store.updateSettings(paused.version, { ...paused, ai_expressions: { ...paused.ai_expressions, enabled: false } });
    assert.equal(reason({ act: 'core:ack' }, 'turn:12'), 'ai_expressions_paused');
    assert.equal(store.search(context('turn:12'), '谢谢').candidates.length, 0);
  } finally { await close(); }
});

test('pressure-sensitive acts never share a window with a decision', async () => {
  const { store, close } = await openStore();
  try {
    const settings = store.getSettings();
    store.updateSettings(settings.version, { ...settings, ai_expressions: { ...settings.ai_expressions, max_per_window: 3 } });
    assert.equal(store.express(context(), { act: 'core:decide', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }).status, 'sent');
    const blocked = store.express(context(), { act: 'core:encourage' });
    assert.equal(blocked.status === 'rejected' && blocked.reason, 'pending_confirmation');
  } finally { await close(); }
});

test('search tokens bind to one window and replay idempotently', async () => {
  const { store, close } = await openStore();
  try {
    const result = store.search(context(), 'thank you', 3, 'en');
    assert.ok(result.candidates.length > 0, 'English queries match English semantics');
    const candidate = result.candidates[0]!;
    assert.equal(candidate.locale, 'en');
    const first = store.express(context(), { selection_token: candidate.selection_token });
    assert.equal(first.status, 'sent');
    const replay = store.express(context(), { selection_token: candidate.selection_token });
    assert.ok(first.status === 'sent' && replay.status === 'sent' && replay.message.message_id === first.message.message_id);
    assert.equal(first.status === 'sent' && first.message.glyph_policy, 'keep');
    const other = store.express(context('turn:2'), { selection_token: store.search(context('turn:1'), '谢谢').candidates[0]!.selection_token });
    assert.equal(other.status === 'rejected' && other.reason, 'invalid_selection_token');
  } finally { await close(); }
});

test('human expressions carry notes, anchors and modes; signals promote instead of expiring', async () => {
  const { store, close } = await openStore();
  try {
    const concern = classic.expressions.find((e: { realizes: string }) => e.realizes === 'core:clarify');
    const ref = { asset_id: concern.asset_id, revision_id: concern.revision_id };
    const message = store.receive(context(), { ref, note: '第 3 步看不懂', anchor: { message_id: 'host-msg-1', exact: '把 reducer 提升到上下文层' } }, 'request-1');
    assert.equal(message.act, 'core:clarify');
    assert.equal(message.glyph_policy, 'keep');
    assert.equal(store.receive(context(), { ref, note: '第 3 步看不懂', anchor: { message_id: 'host-msg-1', exact: '把 reducer 提升到上下文层' } }, 'request-1').message_id, message.message_id);
    assert.throws(() => store.receive(context(), { ref, note: '不同附言' }, 'request-1'), /REQUEST_CONFLICT/);
    assert.throws(() => store.receive(context(), { act: 'core:thanks', mode: 'backchannel', sent_during: 'turn:1' }, 'r2'), /MODE_NOT_ALLOWED/);
    assert.throws(() => store.receive(context(), { act: 'core:ready' }, 'r3'), /DIRECTION_NOT_ALLOWED/);
    const first = store.receive(context(), { act: 'core:redirect', mode: 'backchannel', sent_during: 'turn:1' }, 'r4');
    const second = store.receive(context(), { act: 'core:redirect', mode: 'backchannel', sent_during: 'turn:1' }, 'r5');
    assert.ok(store.history(context()).find(m => m.message_id === first.message_id)!.retracted_at, 'an undelivered signal of the same act is coalesced');
    assert.equal(second.signal, 'queued');
    const promoted = store.signal(context(), second.message_id, 'promoted');
    assert.equal(promoted.signal, 'promoted');
    assert.equal(promoted.mode, 'turn');
    const stop = store.receive(context(), { act: 'core:stop', mode: 'interrupt', sent_during: 'turn:1' }, 'r6');
    assert.equal(store.applied(context(), stop.message_id).applied, true);
    assert.ok(store.retract(context(), message.message_id).retracted_at);
  } finally { await close(); }
});

test('a decision is answered once and never becomes an approval', async () => {
  const { store, close } = await openStore();
  try {
    const sent = store.express(context(), { act: 'core:decide', options: [{ id: 'keep-api', label: '保持接口' }, { id: 'break-api', label: '修改接口' }] });
    assert.equal(sent.status, 'sent');
    const id = sent.status === 'sent' ? sent.message.message_id : '';
    assert.equal(store.choose(context(), id, 'keep-api').choice!.label, '保持接口');
    assert.equal(store.choose(context(), id, 'keep-api').choice!.option, 'keep-api');
    assert.throws(() => store.choose(context(), id, 'break-api'), /ALREADY_CHOSEN/);
    assert.throws(() => store.retract(context(), id), /NOT_SENDER/);
  } finally { await close(); }
});

test('effects bind to expressions and session rules stay within two', async () => {
  const { store, close } = await openStore();
  try {
    const confused = classic.expressions.find((e: { realizes: string }) => e.realizes === 'core:clarify');
    const choices = store.effectChoices(context(), confused);
    assert.deepEqual(choices.map(c => c.effect.kind), ['context']);
    const sent = store.receive(context(), { ref: { asset_id: confused.asset_id, revision_id: confused.revision_id }, effect: choices[0]!.selection }, 'with-effect');
    assert.equal(sent.effect_intent?.status, 'prepared');
    const rules = store.ruleChoices(context());
    const answerFirst = rules.find(r => r.effect.kind === 'template' && r.effect.template === 'response-organization@1')!;
    const checkpoint = { version: 1, profile: 'test', session: 'session-1', createdAt: 0, rules: [], intents: [] } as const;
    const enabled = store.changeRules(context(), { kind: 'enable', generation: 0, selection: answerFirst.selection, checkpoint: { ...checkpoint, rules: [], intents: [] } });
    assert.equal(enabled.rules.filter(r => r.enabled).length, 1);
    const example = rules.find(r => r.effect.kind === 'context' && r.effect.conflict_group === 'response-organization')!;
    assert.throws(() => store.changeRules(context(), { kind: 'enable', generation: enabled.generation, selection: example.selection, checkpoint: { ...checkpoint, rules: [], intents: [] } }), /RULE_CONFLICT/);
  } finally { await close(); }
});

test('drafts create a multilingual expression; personal packs export and re-import', async () => {
  const { store, close } = await openStore([]);
  try {
    const draft = store.createDraft('en');
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 200, g: 120, b: 40, alpha: 1 } } }).png().toBuffer();
    const fields = { ...draft.fields, realizes: 'core:thanks', name: { en: 'Thanks!' }, semantics: { en: { meaning: 'Thank you for the help just now.', fallback: '[thanks]' } }, text_locale: null };
    const saved = await store.saveDraft(draft.draft_id, 1, fields, png.toString('base64'));
    await assert.rejects(store.saveDraft(draft.draft_id, 2, { ...fields, realizes: 'core:approve' }).then(d => store.previewDraft(d.draft_id, d.version)), /不在注册表/);
    const current = store.getDraft(draft.draft_id);
    const fixed = await store.saveDraft(draft.draft_id, current.version, fields);
    const expression = await store.confirmDraft(draft.draft_id, fixed.version);
    assert.equal(saved.visual?.primary.mime, 'image/png');
    assert.equal(expression.visual.text_locale, null);
    assert.equal(store.getEntry(expression.asset_id).origin, 'local');
    const packDraft = store.createPackDraft([expression], 'Mine');
    const pack = await store.confirmPackDraft(packDraft.draft_id, 1);
    assert.deepEqual(pack.locales, ['en']);
    const bytes = await store.exportRelease(pack.release_id);
    await withValidatedPack(bytes, async validated => { assert.equal(validated.manifest.release_id, pack.release_id); });
    const other = await openStore([]);
    try {
      const imported = await other.store.importPack(bytes);
      assert.equal(imported.added, 1);
      assert.equal(other.store.getEntry(expression.asset_id).pack_id, pack.pack_id);
      await assert.rejects(other.store.importPack(await readFile(new URL('../assets/official-packs/classic.amoji', import.meta.url)).then(b => { const tampered = Buffer.from(b); tampered[2000]! ^= 1; return tampered; })));
    } finally { await other.close(); }
  } finally { await close(); }
});
