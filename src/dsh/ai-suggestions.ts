import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm/message';
import { fail, nonempty, object } from '../shared-contract.js';
import { SUGGESTION_INSTRUCTIONS as instructions, parseSuggestedFields as parseFields, textInput, type SuggestedFields } from '../application/text-suggestions.js';

export type SuggestionLlm = Pick<LlmRuntime, 'listProviders' | 'listModels' | 'resolveModelInfo' | 'stream'>;
export interface SuggestionModel { provider: string; model: string; name: string }
export interface SuggestionModels { models: SuggestionModel[]; current: {provider: string; model: string} | null }
export interface AiTextSuggestion {
  method: 'dsh-llm-v1';
  notice: string;
  fields: SuggestedFields;
}
/** Host-only, one-shot text generation: no session history, tools, media, or core mutation. */
export class AiSuggestions {
  private readonly active = new Set<string>();
  constructor(private readonly llm: SuggestionLlm | undefined, private readonly timeoutMs = 45_000) {}
  private service(): SuggestionLlm { if (!this.llm) fail('SUGGESTION_UNAVAILABLE', 'dsh 模型能力不可用，请检查模型配置。'); return this.llm; }
  async models(signal: AbortSignal): Promise<SuggestionModel[]> {
    signal.throwIfAborted(); const llm = this.service();
    const results = await Promise.allSettled(llm.listProviders().map(p => llm.listModels(p.id)));
    signal.throwIfAborted();
    const models = results.flatMap(r => r.status === 'fulfilled' ? r.value : []).filter(m => !m.inputModalities || m.inputModalities.includes('text'));
    return [...new Map(models.map(m => [JSON.stringify([m.provider, m.id]), { provider: m.provider, model: m.id, name: m.name }])).values()];
  }
  async suggest(sessionId: string, raw: unknown, outer: AbortSignal): Promise<AiTextSuggestion> {
    if (this.active.has(sessionId)) fail('SUGGESTION_BUSY', '当前会话正在生成建议，请稍候。');
    const args = object(raw, ['intent', 'provider', 'model', 'locale'], ['intent', 'provider', 'model']);
    const intent = textInput(args.intent, '文字意图', 240);
    const locale = args.locale === undefined ? 'zh-CN' : textInput(args.locale, '语言', 35);
    const provider = nonempty(args.provider); const model = nonempty(args.model);
    const llm = this.service(); const controller = new AbortController();
    const signal = AbortSignal.any([outer, controller.signal]);
    this.active.add(sessionId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(Object.assign(new Error('SUGGESTION_CANCELLED: 已取消生成，草稿保持不变。'), { code: 'SUGGESTION_CANCELLED' }));
        if (outer.aborted) onAbort(); else outer.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => { reject(Object.assign(new Error('SUGGESTION_TIMEOUT: AI 生成超时，未自动重试。'), { code: 'SUGGESTION_TIMEOUT' })); controller.abort(); }, this.timeoutMs);
      });
      const generate = async (): Promise<AiTextSuggestion> => {
        signal.throwIfAborted();
        const selected = (await this.models(signal)).find(m => m.provider === provider && m.model === model);
        if (!selected) fail('SUGGESTION_MODEL_UNAVAILABLE', '所选模型已不可用，请刷新模型列表后重新选择。');
        const info = await llm.resolveModelInfo(provider, model, signal);
        const off = info.reasoning?.efforts.find(e => /^(off|none)$/i.test(e.id));
        let text = ''; let finished = false;
        signal.throwIfAborted();
        for await (const chunk of llm.stream({ provider, model, ...(off ? { reasoningEffort: off.id } : {}), maxTokens: 1200, system: instructions,
          messages: [createUserMessage({ content: [{ type: 'text', text: JSON.stringify({ intent, locale }) }], source: { kind: 'user' } })], signal })) {
          signal.throwIfAborted();
          if (finished) fail('SUGGESTION_OUTPUT_INVALID', 'AI 返回了异常的响应。');
          if (chunk.type === 'text-delta') { text += chunk.text; if (Buffer.byteLength(text) > 16_384) fail('SUGGESTION_OUTPUT_INVALID', 'AI 返回内容过长，未写入草稿。'); }
          if (chunk.type === 'finish') {
            if (chunk.reason.kind !== 'stop') fail('SUGGESTION_GENERATION_FAILED', chunk.reason.kind === 'max-tokens' ? 'AI 输出被截断，未写入草稿。可重新生成或手动填写。' : 'AI 生成失败，请检查所选模型的连接与配置，或手动填写。');
            finished = true;
          }
        }
        if (!finished) fail('SUGGESTION_GENERATION_FAILED', 'AI 响应中断，未写入草稿。');
        return { method: 'dsh-llm-v1', notice: `由 ${selected.name}（${provider} / ${model}）生成文字建议；未读取图片。请修改并确认。`, fields: parseFields(text, locale) };
      };
      return await Promise.race([cancelled, generate()]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code?.startsWith('SUGGESTION_')) throw error;
      if (outer.aborted) fail('SUGGESTION_CANCELLED', '已取消生成，草稿保持不变。');
      // Provider exceptions can contain URLs or credentials; never reflect raw errors into UI.
      return fail('SUGGESTION_GENERATION_FAILED', 'AI 生成失败，请检查所选模型的连接与配置，或手动填写。');
    } finally { clearTimeout(timer); if (onAbort) outer.removeEventListener('abort', onAbort); controller.abort(); this.active.delete(sessionId); }
  }
}

/** Mirrors dsh's public modelSelection projection, including an unconsumed selection. */
export function conversationModel(events: readonly import('./contracts.js').DshEvent[]): {provider: string; model: string} | null {
  type Selection = {provider: string; model: string; reasoningEffort?: string};
  let pending: Selection | null = null, last: Selection | null = null;
  const selection = (raw: unknown): Selection | null => {
    if (!raw || typeof raw !== 'object') return null;
    const v = raw as Selection;
    return typeof v.provider === 'string' && typeof v.model === 'string' ? {provider:v.provider,model:v.model,...(v.reasoningEffort===undefined?{}:{reasoningEffort:String(v.reasoningEffort)})} : null;
  };
  for (const event of events) {
    if (event.type === 'model/selection') pending = selection(event.data);
    if (event.type === 'request/header') {
      last = selection((event.data as {header?:{config?:unknown}})?.header?.config);
      if (last && pending && last.provider === pending.provider && last.model === pending.model && last.reasoningEffort === pending.reasoningEffort) pending = null;
    }
  }
  const current = pending ?? last;
  return current ? {provider:current.provider,model:current.model} : null;
}
