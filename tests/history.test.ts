import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryStore } from '../src/library-store.js';
import { SharedClient, stopSharedService } from '../src/shared-client.js';
import { SEEDS } from './helpers/store-runtime.js';

test('human and AI messages survive a restart with their exact revisions, isolated per session', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const context = { host: 'codex' as const, hostInstanceId: 'local', sessionId: 'a', turnId: '1' };
  let store = await LibraryStore.open(directory, SEEDS);
  const expression = store.list().find(e => e.realizes === 'core:clarify')!;
  const human = store.receive(context, { ref: expression, note: '第三步' }, 'click-1');
  const ai = store.express(context, { act: 'core:ack' });
  assert.equal(ai.status, 'sent');
  store.close();
  store = await LibraryStore.open(directory, SEEDS);
  t.after(() => store.close());
  const restored = store.history(context);
  assert.deepEqual(restored.map(m => m.message_id), [human.message_id, ai.status === 'sent' ? ai.message.message_id : '']);
  assert.deepEqual(restored[0], human);
  assert.equal(store.history({ ...context, sessionId: 'b' }).length, 0);
  assert.equal(store.receive(context, { ref: expression, note: '第三步' }, 'click-1').message_id, human.message_id, 'retries after a restart return the original message');
});

test('two clients of one service see the same new messages and presentation receipts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-history-readers-'));
  const first = await SharedClient.connect({ directory });
  const second = await SharedClient.connect({ directory });
  t.after(async () => { await first.close(); await second.close(); await stopSharedService(directory, first.identity.serviceId); await rm(directory, { recursive: true, force: true }); });
  const context = { host: 'codex' as const, sessionId: 'same-thread', turnId: '1' };
  const [a, b] = [await first.bind(context), await second.bind(context)];
  assert.deepEqual(await second.history(b), []);
  const message = await first.receive(a, { act: 'core:thanks' }, 'click');
  assert.deepEqual(await second.history(b), [message]);
  assert.equal(message.revision?.realizes, 'core:thanks', 'an act alone is drawn with the preferred pack glyph');
  await second.presentation(b, message.message_id, 'rendered');
  assert.equal((await first.history(a))[0]!.presentation, 'rendered');
});
