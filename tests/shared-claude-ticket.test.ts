import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedClient, stopSharedService } from '../src/shared-client.js';

// Use the real authenticated HTTP boundary: an unimplemented ticket method must fail here.
test('共享服务签发单次票据，固定真实身份、工具、参数与有效期，保留 API 2 普通客户端', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-claude-ticket-'));
  let client: SharedClient | undefined;
  const abort = new AbortController();
  t.after(async () => {
    abort.abort();
    try { await client?.close(); } finally {
      try {
        const descriptor = JSON.parse(await readFile(join(directory, 'service.json'), 'utf8'));
        await stopSharedService(directory, descriptor.serviceId);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
  const clockFile = join(directory, 'clock.txt');
  await writeFile(clockFile, '0');
  const original = process.env.NODE_OPTIONS;
  const originalClock = process.env.AMOJI_TEST_CLOCK_FILE;
  process.env.NODE_OPTIONS = [original, `--import=${new URL('fixtures/clock-offset.mjs', import.meta.url).href}`].filter(Boolean).join(' ');
  process.env.AMOJI_TEST_CLOCK_FILE = clockFile;
  try { client = await SharedClient.connect({ directory }); } finally {
  if (original === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = original;
  if (originalClock === undefined) delete process.env.AMOJI_TEST_CLOCK_FILE; else process.env.AMOJI_TEST_CLOCK_FILE = originalClock;
  }
  const descriptor = JSON.parse(await readFile(join(directory, 'service.json'), 'utf8'));
  const headers = { Authorization: `Bearer ${descriptor.secret}`, 'x-amoji-service': descriptor.serviceId };
  const connection = await fetch(`${descriptor.origin}/connect`, { headers, signal: abort.signal });
  const reader = connection.body!.getReader();
  const hello = JSON.parse(new TextDecoder().decode((await reader.read()).value).trim());
  const rpc = async (method: string, params: unknown) => {
    const response = await fetch(`${descriptor.origin}/rpc`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'x-amoji-connection': hello.connectionId }, body: JSON.stringify({ method, params }) });
    return { status: response.status, body: await response.json() };
  };
  const invocation = { sessionId: 'claude-session', promptId: '550e8400-e29b-41d4-a716-446655440000', invocationId: 'toolu_1', toolName: 'mcp__plugin_amoji_amoji__amoji_search', argumentsDigest: 'a'.repeat(64) };
  const issued = await rpc('issueClaudeTicket', invocation);
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.match(issued.body.result.ticket, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual((await rpc('issueClaudeTicket', invocation)).body.result, issued.body.result);
  const ticket = issued.body.result.ticket;
  assert.equal((await rpc('issueClaudeTicket', { ...invocation, promptId: 'another-prompt' })).body.code, 'CLAUDE_INVOCATION_CONFLICT');
  assert.equal((await rpc('issueClaudeTicket', { ...invocation, sessionId: '' })).body.code, 'INVALID_ARGUMENT');
  assert.equal((await rpc('issueClaudeTicket', { ...invocation, invocationId: 'toolu_2', agentId: 'forged' })).body.code, 'INVALID_ARGUMENT');
  assert.equal((await rpc('redeemClaudeTicket', { ticket: 'forged', toolName: invocation.toolName, argumentsDigest: invocation.argumentsDigest })).body.code, 'CLAUDE_TICKET_UNAVAILABLE');
  assert.equal((await rpc('redeemClaudeTicket', { ticket, toolName: invocation.toolName, argumentsDigest: 'b'.repeat(64) })).body.code, 'CLAUDE_TICKET_MISMATCH');
  assert.equal((await rpc('redeemClaudeTicket', { ticket, toolName: 'mcp__plugin_amoji_amoji__amoji_emit', argumentsDigest: invocation.argumentsDigest })).body.code, 'CLAUDE_TICKET_MISMATCH');
  assert.equal((await rpc('redeemClaudeTicket', { ticket, toolName: invocation.toolName, argumentsDigest: invocation.argumentsDigest, invocationId: 'wrong' })).body.code, 'CLAUDE_TICKET_MISMATCH');
  const redeemed = await rpc('redeemClaudeTicket', { ticket, toolName: invocation.toolName, argumentsDigest: invocation.argumentsDigest });
  assert.deepEqual(redeemed.body.result, { context: { host: 'claude-code', hostInstanceId: 'local', sessionId: invocation.sessionId, turnId: invocation.promptId }, invocationId: 'toolu_1' });
  assert.equal((await rpc('redeemClaudeTicket', { ticket, toolName: invocation.toolName, argumentsDigest: invocation.argumentsDigest })).body.code, 'CLAUDE_TICKET_CONSUMED');
  assert.equal((await rpc('issueClaudeTicket', invocation)).body.code, 'CLAUDE_TICKET_CONSUMED');
  const expiring = (await rpc('issueClaudeTicket', { ...invocation, invocationId: 'toolu_expiry' })).body.result;
  await writeFile(clockFile, '180000');
  assert.equal((await rpc('redeemClaudeTicket', { ticket: expiring.ticket, toolName: invocation.toolName, argumentsDigest: invocation.argumentsDigest })).body.code, 'CLAUDE_TICKET_EXPIRED');
  assert.equal(client.identity.apiVersion, 2);
  assert.equal(client.identity.databaseVersion, 4);
  assert.ok((client.identity as any).capabilities.includes('claude-hook-tickets-v1'));
  assert.equal((await client.list()).length, 24);
  await rpc('close', {});
});
