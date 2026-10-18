import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop';
import { SessionStore } from '@deepseek-ai/dsh-session';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { LlmRuntime, LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';

export class RecordingProvider extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  respond?: (request: GenerateOptions, index: number) => AsyncIterable<StreamChunk>;
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.requests.length >= 16) throw new Error('Native probe exceeded its sixteen-request safety budget');
    this.requests.push(request);
    if (this.respond) { yield* this.respond(request, this.requests.length); return; }
    yield* textResponse();
  }
}
export async function* textResponse(): AsyncIterable<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text: 'recorded' };
  yield { type: 'block-end', index: 0, block: { type: 'text', text: 'recorded' } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}
export async function nativeHost(includeRuntimeContext = true, profile?: string) {
  const ctx = new Context();
  const fibers = [ctx.plugin(SystemPrompt, { includeRuntimeContext }), ctx.plugin(SessionStore), ctx.plugin(SessionProjectionRegistry), ctx.plugin(AgentRegistry), ctx.plugin(LlmRuntime), ctx.plugin(ToolRuntime), ctx.plugin(AgentLoop, { agents: [] })];
  // Cordis publishes dependent services during microtask initialization.
  if (profile) fibers.push(ctx.plugin(JsonlSessionPersistence, { root: profile, compression: 'none' }));
  await new Promise<void>(resolve => setImmediate(resolve));
  const events: { event: string; session?: string; seq?: number; rpcId?: string; names?: string[] }[] = [];
  ctx.on('session/event', (session, event) => { if (['turn/start', 'step/start', 'user/message', 'turn/end'].includes(event.type)) events.push({ event: event.type === 'user/message' ? 'admission' : event.type, session: session.id, seq: event.seq }); });
  ctx.on('agent/inbox/claimed', ({ agent, message }) => { events.push({ event: 'claim', session: agent.id, ...('rpcId' in message.source ? { rpcId: String(message.source.rpcId) } : {}) }); });
  ctx.on('system-prompt/assemble', async (_a, c, next) => { const a = await next(); events.push({ event: 'assembly', session: c.agent?.id, names: a.contexts.map(c => c.name) }); return a; });
  ctx.on('agent/pre-step', async (p, next) => { const d = await next(); events.push({ event: 'pre-step', session: p.agent.id }); return d; });
  const provider = new RecordingProvider();
  ctx.on('llm/stream', async function* (options, next) { events.push({ event: 'provider', session: options.sessionId }); yield* next(); });
  ctx.llm.registerAdapter(['amoji-recording'], provider);
  return { ctx, provider, events, create: (id: string) => ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider: 'amoji-recording', model: 'no-network-no-cost' } }),
    close: async () => {
      for (const fiber of fibers.reverse()) await fiber.dispose();
      if (process.env.AMOJI_NATIVE_EVIDENCE) {
        await mkdir(dirname(process.env.AMOJI_NATIVE_EVIDENCE), { recursive: true });
        await appendFile(process.env.AMOJI_NATIVE_EVIDENCE, JSON.stringify({ driver: '@deepseek-ai/dsh-agent-loop@0.1.5-rc.2', cost: 0, networkRequests: 0, events, requests: provider.requests.map(r => ({ session: r.sessionId, model: r.model, messages: r.messages })) }) + '\n');
      }
    } };
}
export const input = (rpcId: string, text = 'hello') => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user', rpcId: rpcId as never } });
