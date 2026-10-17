// Isolated test child: terminate after durable assembly, without normal agent teardown.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeHost, input } from './dsh-native.js';
import { CollaborationContext } from '../../src/dsh/collaboration-context.js';
import { loadProfileIdentity } from '../../src/dsh/profile-identity.js';
const profile = process.argv[2];
if (!profile) throw new Error('An isolated test profile is required');
const identity = await loadProfileIdentity(profile);
const host = await nativeHost(true, join(profile, 'sessions'));
const adapter = new CollaborationContext(host.ctx, identity.id);
const { agent } = await host.create('bound-crash');
adapter.authorize(agent);
adapter.prepare(agent, 'amoji:crash', { id: 'one', revision: 'v1', instruction: 'NEVER RESEND', conflictGroup: 'explanation' });
host.ctx.on('agent/request', async (_payload, next) => {
  await next();
  await host.ctx.sessions.flush(agent.session);
  await writeFile(join(profile, 'checkpoint.json'), JSON.stringify({ checkpoint: adapter.checkpoint(agent), requests: host.provider.requests.length, events: agent.session.snapshotEvents() }), { mode: 0o600 });
  process.exit(0); // Deliberately omit close(): the durable log retains its unadmitted open step.
});
agent.followup(input('amoji:crash'));
await agent.whenIdle();
throw new Error('The controlled crash boundary was not reached');
