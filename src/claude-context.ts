import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { amojiTools, amojiPickTool } from './mcp-server.js';
import { fail, nonempty, type ClaudeHookInvocation } from './shared-contract.js';

export const CLAUDE_TICKET_FIELD = '_amoji_ticket';
export const CLAUDE_TOOL_PREFIX = 'mcp__plugin_amoji_amoji__';
const ajv = new Ajv2020();
const validators = new Map([...amojiTools, amojiPickTool].map(tool => [tool.name, ajv.compile(tool.inputSchema)]));

/** The reserved field is removed before validation and hashing, never forwarded to core. */
export function claudeArguments(name: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ARGUMENT', '无效工具参数');
  const args = Object.fromEntries(Object.entries(value).filter(([key]) => key !== CLAUDE_TICKET_FIELD));
  const validate = validators.get(name);
  if (!validate?.(args)) fail('INVALID_ARGUMENT', '无效工具参数；不接受语义覆盖或目标会话');
  return args;
}

export function argumentsDigest(args: Record<string, unknown>): string {
  // All accepted schemas contain only primitive values; object property order is irrelevant.
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b, 'en'))));
  return createHash('sha256').update(canonical).digest('hex');
}

/** This function is called only by the command Hook reading Claude's stdin envelope. */
export function claudeHookContext(value: unknown): { invocation: ClaudeHookInvocation; args: Record<string, unknown> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('CLAUDE_CONTEXT_UNAVAILABLE', 'Hook 输入不是对象');
  const input = value as Record<string, unknown>;
  if (input.hook_event_name !== 'PreToolUse') fail('CLAUDE_CONTEXT_UNAVAILABLE', '需要 PreToolUse Hook');
  if (input.agent_id !== undefined || input.agent_type !== undefined) fail('CLAUDE_SUBAGENT_UNSUPPORTED', 'v0.1 只支持默认主会话；子代理或自定义 agent 不会投递到父会话');
  for (const field of ['session_id', 'prompt_id', 'tool_use_id']) {
    if (typeof input[field] !== 'string' || !input[field].trim()) fail('CLAUDE_CONTEXT_UNAVAILABLE', '需要 Claude Code 2.1.196+ 提供 session_id、prompt_id 和 tool_use_id；不能推测会话或回合');
  }
  const toolName = nonempty(input.tool_name);
  if (!toolName.startsWith(CLAUDE_TOOL_PREFIX)) fail('CLAUDE_TOOL_UNSUPPORTED', '不是 Amoji Claude 插件工具');
  const args = claudeArguments(toolName.slice(CLAUDE_TOOL_PREFIX.length), input.tool_input);
  return { args, invocation: { sessionId: nonempty(input.session_id), promptId: nonempty(input.prompt_id), invocationId: nonempty(input.tool_use_id), toolName, argumentsDigest: argumentsDigest(args) } };
}
