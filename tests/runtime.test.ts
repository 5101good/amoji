import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './helpers/store-runtime.js';

const turn = (sessionId: string, turnId = '1') => ({ host: 'codex' as const, hostInstanceId: 'local', sessionId, turnId });

test('selection tokens belong to one session and one turn; replays return the original message', async () => {
  const { store, close } = await openStore();
  try {
    const a = turn('a'), b = turn('b');
    const choice = store.search(a, '庆祝').candidates[0]!;
    const reason = (r: ReturnType<typeof store.express>) => r.status === 'rejected' ? r.reason : r.status;
    assert.equal(reason(store.express(b, { selection_token: choice.selection_token })), 'invalid_selection_token');
    assert.equal(reason(store.express(turn('a', '2'), { selection_token: choice.selection_token })), 'invalid_selection_token');
    const first = store.express(a, { selection_token: choice.selection_token });
    assert.ok(first.status === 'sent');
    const again = store.express(a, { selection_token: choice.selection_token });
    assert.ok(again.status === 'sent' && again.message.message_id === first.message.message_id);
    assert.equal(first.message.presentation, 'pending', 'sending never claims the image was shown');
    assert.equal(store.history(b).length, 0);
    assert.equal(store.history(a).length, 1);
  } finally { await close(); }
});

test('a human send is idempotent per request id and cannot be reused for another expression', async () => {
  const { store, close } = await openStore();
  try {
    const context = turn('human');
    const [one, two] = store.list();
    const first = store.receive(context, { ref: one! }, 'click-1');
    assert.equal(first.direction, 'human_to_ai');
    assert.equal(store.receive(context, { ref: one! }, 'click-1').message_id, first.message_id);
    assert.throws(() => store.receive(context, { ref: two! }, 'click-1'), /REQUEST_CONFLICT/);
    assert.equal(store.history(context).length, 1);
  } finally { await close(); }
});

test('selection tokens expire after five minutes, but a consumed token still replays', async t => {
  const { store, close } = await openStore();
  try {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const context = turn('expiry');
    const first = store.search(context, '庆祝').candidates[0]!;
    const expiring = store.search(turn('expiry', '2'), '谢谢').candidates[0]!;
    assert.match(first.selection_token, /^[A-Za-z0-9_-]{32,}$/);
    assert.notEqual(first.selection_token, expiring.selection_token);
    const message = store.express(context, { selection_token: first.selection_token });
    now += 300_000;
    const late = store.express(turn('expiry', '2'), { selection_token: expiring.selection_token });
    assert.equal(late.status === 'rejected' && late.reason, 'invalid_selection_token');
    const replay = store.express(context, { selection_token: first.selection_token });
    assert.ok(message.status === 'sent' && replay.status === 'sent' && replay.message.message_id === message.message.message_id);
  } finally { await close(); }
});
