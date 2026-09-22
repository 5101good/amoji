import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeHost, input } from './helpers/dsh-native.js';
import { CollaborationContext } from '../src/dsh/collaboration-context.js';

test('native driver: both templates and exact one-time input are user snapshots, not system authority', async () => {
  const host = await nativeHost();
  try {
    const adapter = new CollaborationContext(host.ctx, 'profile-test');
    const { agent } = await host.create('session-a');
    adapter.authorize(agent);
    adapter.setRules(agent, [
      { id: 'organize', revision: 'v1', template: 'response-organization@1', config: { layout: 'answer-first' } },
      { id: 'check', revision: 'v1', template: 'completion-self-check@1', config: { evidence: 'required', unknowns: 'explicit' } },
    ]);
    adapter.prepare(agent, 'amoji:one', { id: 'once', revision: 'v1', instruction: 'Explain {{unknown_variable}}', conflictGroup: 'explanation' });
    agent.followup(input('amoji:one'));
    await agent.whenIdle();
    assert.equal(host.provider.requests.length, 1);
    const messages = host.provider.requests[0]!.messages;
    assert.ok(messages.some(m => m.role === 'user' && JSON.stringify(m).includes('Explain {{unknown_variable}}')));
    assert.ok(messages.some(m => m.role === 'user' && JSON.stringify(m).includes('response-organization@1') && JSON.stringify(m).includes('completion-self-check@1')));
    assert.ok(messages.filter(m => m.role === 'system').every(m => !JSON.stringify(m).includes('amoji')));
    assert.equal(adapter.receipt(agent, 'amoji:one').status, 'attached');
    const trace = host.events.map(e => e.event);
    for (const [before, after] of [['turn/start', 'claim'], ['claim', 'assembly'], ['assembly', 'pre-step'], ['pre-step', 'step/start'], ['step/start', 'admission'], ['admission', 'provider']]) assert.ok(trace.indexOf(before!) < trace.indexOf(after!), `${before} precedes ${after}`);
  } finally { await host.close(); }
});

test('native suppression and collision never claim attachment or overwrite another plugin', async () => {
  for (const mode of ['disabled', 'removed', 'collision', 'variable-collision'] as const) {
    const host = await nativeHost(mode !== 'disabled');
    try {
      if (mode === 'removed') host.ctx.on('system-prompt/assemble', async (_a, _c, next) => { const a = await next(); a.contexts = a.contexts.filter(c => c.name !== 'amoji:collaboration'); return a; });
      if (mode === 'collision') host.ctx.systemPrompt.context({ name: 'amoji:collaboration', order: 0, text: 'another plugin retained' });
      if (mode === 'variable-collision') host.ctx.systemPrompt.variable('amoji_collaboration_text', () => 'another variable retained');
      const adapter = new CollaborationContext(host.ctx, 'profile');
      const { agent } = await host.create(`suppressed-${mode}`);
      adapter.authorize(agent);
      adapter.prepare(agent, 'amoji:test', { id: 'one', revision: 'v1', instruction: 'UNIQUE ACTION', conflictGroup: 'explanation' });
      agent.followup(input('amoji:test')); await agent.whenIdle();
      assert.equal(host.provider.requests.length, 1);
      assert.notEqual(adapter.receipt(agent, 'amoji:test').status, 'attached');
      assert.ok(!JSON.stringify(host.provider.requests).includes('UNIQUE ACTION'));
      if (mode === 'collision') assert.ok(JSON.stringify(host.provider.requests).includes('another plugin retained'));
    } finally { await host.close(); }
  }
});

test('native queue correlation and two session identities cannot consume each other’s instructions', async () => {
  const host = await nativeHost();
  try {
    const adapter = new CollaborationContext(host.ctx, 'profile');
    const a = (await host.create('a')).agent; const b = (await host.create('b')).agent;
    adapter.authorize(a); adapter.authorize(b);
    adapter.prepare(a, 'amoji:second', { id: 'one', revision: 'v1', instruction: 'ONLY SECOND A', conflictGroup: 'explanation' });
    a.followup(input('first')); a.followup(input('amoji:second')); b.followup(input('amoji:second'));
    await Promise.all([a.whenIdle(), b.whenIdle()]);
    const requests = host.provider.requests.filter(r => r.sessionId === 'a');
    assert.equal(requests.length, 2); assert.ok(!JSON.stringify(requests[0]).includes('ONLY SECOND A'));
    assert.ok(JSON.stringify(requests[1]).includes('ONLY SECOND A'));
    assert.ok(!JSON.stringify(host.provider.requests.filter(r => r.sessionId === 'b')).includes('ONLY SECOND A'));
    assert.equal(adapter.receipt(a, 'amoji:second').status, 'attached');
  } finally { await host.close(); }
});

test('cancellation before claim or after assembly before admission produces no attachment', async () => {
  for (const before of [true, false]) {
    const host = await nativeHost();
    try {
      const adapter = new CollaborationContext(host.ctx, 'profile'); const { agent } = await host.create(`cancel-${before}`); adapter.authorize(agent);
      adapter.prepare(agent, 'amoji:cancel', { id: 'one', revision: 'v1', instruction: 'NO DELIVERY', conflictGroup: 'explanation' });
      if (before) { agent.send(input('amoji:cancel'), 'next-turn', false); agent.inbox.clear(); }
      else { host.ctx.on('agent/request', async (p, next) => { const config = await next(); p.agent.cancel({ kind: 'user' } as never); return config; }); agent.followup(input('amoji:cancel')); }
      await agent.whenIdle();
      assert.equal(host.provider.requests.length, 0);
      assert.equal(adapter.receipt(agent, 'amoji:cancel').status, 'cancelled');
      agent.followup(input('after')); await agent.whenIdle();
      assert.notEqual(adapter.receipt(agent, 'amoji:cancel').status, 'attached');
    } finally { await host.close(); }
  }
});

test('toggle at completion and tool continuation cannot add inference; the next real input sees the new state', async () => {
  const { textResponse } = await import('./helpers/dsh-native.js');
  for (const enabled of [false, true]) {
    const host = await nativeHost();
    try {
      const adapter = new CollaborationContext(host.ctx, 'profile'); const { agent } = await host.create(`tools-${enabled}`); adapter.authorize(agent);
      if (enabled) adapter.setRules(agent, [{ id: '{{unknown_variable}}', revision: 'v1', template: 'response-organization@1', config: { layout: 'concise' } }, { id: 'check{{unknown_variable}}', revision: 'v1', template: 'completion-self-check@1', config: { evidence: 'required', unknowns: 'explicit' } }]);
      host.ctx.tools.register({ name: 'probe', description: 'No side effects', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_a, value) => [{ type: 'text', text: String(value) }] }, execute: async () => 'done' });
      host.provider.respond = async function* (_request, n) {
        if (n !== 1) { yield* textResponse(); return; }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id: 'call-probe' as never, name: 'probe', argumentsDelta: '{}' };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-probe' as never, name: 'probe', arguments: '{}' } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
      };
      let assemblies = 0; host.ctx.on('system-prompt/assemble', async (_a, _c, next) => { assemblies++; return next(); });
      host.ctx.on('agent/turn-stopping', async () => { adapter.setRules(agent, []); });
      agent.followup(input('first')); await agent.whenIdle();
      assert.equal(host.provider.requests.length, 2); assert.equal(assemblies, 2);
      if (enabled) {
        const snapshots = agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'plugin');
        assert.equal(snapshots.length, 1, 'tool continuation reuses stable native snapshot');
        assert.ok(JSON.stringify(snapshots).includes('{{unknown_variable}}'));
      }
      agent.followup(input('second')); await agent.whenIdle();
      assert.equal(host.provider.requests.length, 3);
      if (enabled) assert.ok(JSON.stringify(host.provider.requests[2]).includes('Previous Amoji conventions are disabled'));
    } finally { await host.close(); }
  }
});

test('real JSONL cold resume reconciles original rpcId, while copy/fork/import/clear never inherit authorization', async () => {
  const { mkdtemp, cp, rm } = await import('node:fs/promises'); const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const { loadProfileIdentity } = await import('../src/dsh/profile-identity.js');
  const { SessionId, SessionLogOffset } = await import('@deepseek-ai/dsh-session/types');
  const profile = await mkdtemp(join(tmpdir(), 'amoji-native-')); const copy = `${profile}-copy`;
  let first: Awaited<ReturnType<typeof nativeHost>> | undefined; let resumed: Awaited<ReturnType<typeof nativeHost>> | undefined;
  try {
    const identity = await loadProfileIdentity(profile);
    first = await nativeHost(true, join(profile, 'sessions'));
    const adapter = new CollaborationContext(first.ctx, identity.id);
    const { agent } = await first.create('resume'); adapter.authorize(agent);
    adapter.setRules(agent, [{ id: 'organize', revision: 'v1', template: 'response-organization@1', config: { layout: 'answer-first' } }]);
    adapter.prepare(agent, 'amoji:observed', { id: 'once', revision: 'v1', instruction: 'ONCE ONLY', conflictGroup: 'explanation' });
    adapter.prepare(agent, 'amoji:uncertain', { id: 'uncertain', revision: 'v1', instruction: 'NEVER RETRY', conflictGroup: 'explanation' });
    const saved = adapter.checkpoint(agent); // Crash-window checkpoint predates native claim/admission.
    agent.followup(input('amoji:observed')); await agent.whenIdle();
    const seed = agent.session.snapshotEvents();
    await first.ctx.sessions.flush(agent.session); await first.close(); first = undefined;
    assert.equal((await loadProfileIdentity(profile)).id, identity.id);
    await cp(profile, copy, { recursive: true }); const copiedIdentity = await loadProfileIdentity(copy);
    assert.notEqual(copiedIdentity.id, identity.id); assert.equal(copiedIdentity.status, 'copy-reset');
    resumed = await nativeHost(true, join(profile, 'sessions'));
    const live = (await resumed.ctx.agents.resume({ resumeSessionId: SessionId('resume'), agentOptions: { provider: 'amoji-recording', model: 'no-network-no-cost' } })).agent;
    const restored = new CollaborationContext(resumed.ctx, identity.id);
    assert.equal(restored.restore(live, saved), true);
    assert.equal(restored.receipt(live, 'amoji:observed').status, 'attached');
    assert.equal(restored.receipt(live, 'amoji:uncertain').status, 'unknown');
    assert.equal(resumed.provider.requests.length, 0);
    live.followup(input('after-restart')); await live.whenIdle();
    assert.equal(resumed.provider.requests.length, 1);
    const newSnapshots = live.session.snapshotEvents().slice(seed.length).filter(e => e.type === 'user/message' && e.data.source.kind === 'plugin');
    assert.ok(!JSON.stringify(newSnapshots).includes('ONCE ONLY')); assert.ok(!JSON.stringify(newSnapshots).includes('NEVER RETRY'));
    const wrongProfile = new CollaborationContext(resumed.ctx, copiedIdentity.id); assert.equal(wrongProfile.restore(live, saved), false); wrongProfile.dispose();
    const fork = (await resumed.ctx.agents.create({ sessionId: SessionId('fork'), seed, meta: { parentSession: SessionId('resume'), isSeeded: true }, inheritedEventCount: SessionLogOffset(seed.length), agentOptions: { provider: 'amoji-recording', model: 'no-network-no-cost' } })).agent;
    assert.equal(restored.restore(fork, saved), false);
    const imported = (await resumed.ctx.agents.create({ sessionId: SessionId('import'), seed, agentOptions: { provider: 'amoji-recording', model: 'no-network-no-cost' } })).agent;
    assert.equal(restored.restore(imported, saved), false);
    const cleared = (await resumed.create('cleared')).agent;
    assert.equal(restored.restore(cleared, saved), false);
    assert.equal(restored.receipt(fork, 'amoji:observed').status, 'unsupported');
    assert.equal(restored.receipt(imported, 'amoji:observed').status, 'unsupported');
  } finally { if (first) await first.close(); if (resumed) await resumed.close(); await rm(profile, { recursive: true, force: true }); await rm(copy, { recursive: true, force: true }); }
});

test('native same-ID replacement cannot restore a cleared history, and old agent objects lose authority', async () => {
  const host = await nativeHost();
  try {
    const adapter = new CollaborationContext(host.ctx, 'profile');
    const original = await host.create('same-id'); adapter.authorize(original.agent);
    adapter.setRules(original.agent, [{ id: 'rule', revision: 'v1', template: 'response-organization@1', config: { layout: 'concise' } }]);
    original.agent.followup(input('before-clear')); await original.agent.whenIdle();
    const saved = adapter.checkpoint(original.agent);
    await original.dispose();
    const cleared = await host.create('same-id');
    assert.equal(adapter.restore(cleared.agent, saved), false);
    assert.equal(adapter.receipt(original.agent, 'before-clear').status, 'unsupported');
    cleared.agent.followup(input('after-clear')); await cleared.agent.whenIdle();
    assert.ok(!JSON.stringify(host.provider.requests.at(-1)).includes('amoji.collaboration'));
  } finally { await host.close(); }
});

test('a later reused rpcId cannot prove admission in an earlier turn whose user input was removed', async () => {
  const host = await nativeHost();
  try {
    const adapter = new CollaborationContext(host.ctx, 'profile'); const { agent } = await host.create('admission-boundary'); adapter.authorize(agent);
    adapter.prepare(agent, 'amoji:same', { id: 'once', revision: 'v1', instruction: 'EXACT TURN ONLY', conflictGroup: 'explanation' });
    let first = true;
    host.ctx.on('agent/pre-step', async (_p, next) => { const result = await next(); if (first && result.kind === 'enter') { first = false; return { ...result, messages: result.messages.filter(m => m.source.kind !== 'user') }; } return result; });
    agent.followup(input('amoji:same')); await agent.whenIdle();
    assert.notEqual(adapter.receipt(agent, 'amoji:same').status, 'attached');
    assert.equal(host.provider.requests.length, 0, 'a removed human input cannot leave an Amoji-only request');
    agent.followup(input('amoji:same')); await agent.whenIdle();
    assert.notEqual(adapter.receipt(agent, 'amoji:same').status, 'attached');
  } finally { await host.close(); }
});

test('admission guard retains other plugins when removing an unadmitted one-time action', async () => {
  const host = await nativeHost();
  try {
    host.ctx.systemPrompt.context({ name: 'other:context', order: 0, text: 'OTHER CONTEXT REMAINS' });
    host.ctx.on('agent/pre-step', async (_p, next) => { const d = await next(); return d.kind === 'enter' ? { ...d, messages: d.messages.filter(m => m.source.kind !== 'user').map(m => ({ ...m, content: [...m.content, { type: 'text' as const, text: 'EXTRA PLUGIN TEXT' }] })) } : d; });
    const adapter = new CollaborationContext(host.ctx, 'profile'); const { agent } = await host.create('other-context'); adapter.authorize(agent);
    adapter.prepare(agent, 'amoji:filtered', { id: 'once', revision: 'v1', instruction: 'MUST NOT APPLY', conflictGroup: 'explanation' });
    agent.followup(input('amoji:filtered')); await agent.whenIdle();
    assert.equal(host.provider.requests.length, 1);
    assert.ok(JSON.stringify(host.provider.requests).includes('OTHER CONTEXT REMAINS'));
    assert.ok(JSON.stringify(host.provider.requests).includes('EXTRA PLUGIN TEXT'));
    assert.ok(!JSON.stringify(host.provider.requests).includes('MUST NOT APPLY'));
  } finally { await host.close(); }
});

test('a stale prepared checkpoint reconstructs attachment from original rpcId and native sections without resending', async () => {
  const host = await nativeHost();
  try {
    let adapter = new CollaborationContext(host.ctx, 'profile'); const { agent } = await host.create('stale-checkpoint'); adapter.authorize(agent);
    agent.followup(input('warmup')); await agent.whenIdle();
    adapter.prepare(agent, 'amoji:stale', { id: 'one', revision: 'v1', instruction: 'ORIGINAL RPC', conflictGroup: 'explanation' });
    const saved = adapter.checkpoint(agent);
    agent.followup(input('amoji:stale')); await agent.whenIdle();
    adapter.dispose(); adapter = new CollaborationContext(host.ctx, 'profile');
    assert.equal(adapter.restore(agent, saved), true);
    assert.equal(adapter.receipt(agent, 'amoji:stale').status, 'attached');
    assert.equal(host.provider.requests.length, 2);
  } finally { await host.close(); }
});

test('a restored bound checkpoint with no native admission remains unknown', async () => {
  const host = await nativeHost();
  try {
    let adapter = new CollaborationContext(host.ctx, 'profile'); const { agent } = await host.create('bound-checkpoint'); adapter.authorize(agent);
    adapter.prepare(agent, 'amoji:bound', { id: 'one', revision: 'v1', instruction: 'NOT ADMITTED', conflictGroup: 'explanation' });
    let status: string | undefined;
    host.ctx.on('agent/request', async (_p, next) => {
      const config = await next(); const saved = adapter.checkpoint(agent); adapter.dispose(); adapter = new CollaborationContext(host.ctx, 'profile');
      assert.equal(adapter.restore(agent, saved), true); status = adapter.receipt(agent, 'amoji:bound').status; agent.cancel({ kind: 'user' }); return config;
    });
    agent.followup(input('amoji:bound')); await agent.whenIdle();
    assert.equal(status, 'unknown'); assert.equal(host.provider.requests.length, 0);
  } finally { await host.close(); }
});

test('actual process exit after assembly cold-resumes native JSONL without admission or automatic resend', async () => {
  const { mkdtemp, readFile, rm, appendFile } = await import('node:fs/promises'); const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url'); const { SessionId } = await import('@deepseek-ai/dsh-session/types');
  const { loadProfileIdentity } = await import('../src/dsh/profile-identity.js');
  const profile = await mkdtemp(join(tmpdir(), 'amoji-crash-'));
  let host: Awaited<ReturnType<typeof nativeHost>> | undefined;
  try {
    const identity = await loadProfileIdentity(profile);
    await promisify(execFile)(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./helpers/dsh-crash-child.ts', import.meta.url)), profile], { timeout: 10000 });
    const saved = JSON.parse(await readFile(join(profile, 'checkpoint.json'), 'utf8'));
    assert.equal(saved.requests, 0);
    assert.equal((await loadProfileIdentity(profile)).id, identity.id);
    host = await nativeHost(true, join(profile, 'sessions'));
    const { agent } = await host.ctx.agents.resume({ resumeSessionId: SessionId('bound-crash'), agentOptions: { provider: 'amoji-recording', model: 'no-network-no-cost' } });
    const adapter = new CollaborationContext(host.ctx, identity.id);
    assert.equal(adapter.restore(agent, saved.checkpoint), true);
    assert.equal(adapter.receipt(agent, 'amoji:crash').status, 'unknown');
    if (process.env.AMOJI_NATIVE_EVIDENCE) await appendFile(process.env.AMOJI_NATIVE_EVIDENCE, JSON.stringify({ kind: 'actual-child-process-exit', providerRequestsAtExit: saved.requests, nativeEventsAtExit: saved.events, restoredReceipt: adapter.receipt(agent, 'amoji:crash') }) + '\n');
    assert.equal(host.provider.requests.length, 0);
    assert.ok(!agent.session.snapshotEvents().some(e => e.type === 'user/message' && e.data.source.kind === 'user'));
    agent.followup(input('a-new-user-request')); await agent.whenIdle();
    assert.equal(host.provider.requests.length, 1);
    assert.ok(!JSON.stringify(host.provider.requests).includes('NEVER RESEND'));
  } finally { if (host) await host.close(); await rm(profile, { recursive: true, force: true }); }
});
