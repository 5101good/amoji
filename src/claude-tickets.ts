import { randomBytes } from 'node:crypto';
import { fail, nonempty, object, type ClaudeHookInvocation, type ClaudeTicketContext } from './shared-contract.js';

interface Ticket { invocation: ClaudeHookInvocation; expiresAt: number; consumed: boolean }

/** Credentials exist only in the existing service, across short-lived Hook connections. */
export class ClaudeTickets {
  private readonly tickets = new Map<string, Ticket>();
  private readonly invocations = new Map<string, string>();

  prune(): void {
    for (const [token, record] of this.tickets) {
      if (record.expiresAt <= Date.now()) {
        this.tickets.delete(token);
        this.invocations.delete(record.invocation.invocationId);
      }
    }
  }

  issue(value: unknown): { ticket: string; expiresAt: number } {
    const args = object(value, ['sessionId', 'promptId', 'invocationId', 'toolName', 'argumentsDigest']);
    const invocation: ClaudeHookInvocation = {
      sessionId: nonempty(args.sessionId), promptId: nonempty(args.promptId), invocationId: nonempty(args.invocationId),
      toolName: toolName(args.toolName), argumentsDigest: digest(args.argumentsDigest),
    };
    this.prune();
    const previous = this.invocations.get(invocation.invocationId);
    if (previous) {
      const record = this.tickets.get(previous)!;
      if (JSON.stringify(record.invocation) !== JSON.stringify(invocation)) fail('CLAUDE_INVOCATION_CONFLICT', '同一宿主调用的会话、回合或参数不一致');
      if (record.consumed) fail('CLAUDE_TICKET_CONSUMED', '本次调用的票据已兑换；不能重放 Hook');
      return { ticket: previous, expiresAt: record.expiresAt };
    }
    if (this.tickets.size >= 10000) fail('CLAUDE_TICKET_CAPACITY', '关联票据已达上限，请稍后重试');
    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + 120000;
    this.tickets.set(ticket, { invocation, expiresAt, consumed: false });
    this.invocations.set(invocation.invocationId, ticket);
    return { ticket, expiresAt };
  }

  redeem(value: unknown): ClaudeTicketContext {
    const args = object(value, ['ticket', 'toolName', 'argumentsDigest', 'invocationId'], ['ticket', 'toolName', 'argumentsDigest']);
    const record = this.tickets.get(nonempty(args.ticket));
    if (!record) fail('CLAUDE_TICKET_UNAVAILABLE', '缺少有效 Hook 关联票据；不能使用模型自报的身份');
    if (record.expiresAt <= Date.now()) fail('CLAUDE_TICKET_EXPIRED', 'Hook 关联票据已过期；请重新发起工具调用');
    if (record.consumed) fail('CLAUDE_TICKET_CONSUMED', 'Hook 关联票据已经兑换');
    const invocation = record.invocation;
    if (toolName(args.toolName) !== invocation.toolName || digest(args.argumentsDigest) !== invocation.argumentsDigest ||
      (args.invocationId !== undefined && nonempty(args.invocationId) !== invocation.invocationId)) fail('CLAUDE_TICKET_MISMATCH', '工具调用与可信 Hook 记录不一致');
    record.consumed = true;
    return { context: { host: 'claude-code', hostInstanceId: 'local', sessionId: invocation.sessionId, turnId: invocation.promptId }, invocationId: invocation.invocationId };
  }
}

function toolName(value: unknown): string {
  const name = nonempty(value);
  if (!/^mcp__plugin_amoji_amoji__amoji_(search|resolve|emit|pick)$/.test(name)) fail('INVALID_ARGUMENT', '不是 Amoji Claude 插件工具');
  return name;
}
function digest(value: unknown): string {
  const text = nonempty(value);
  if (!/^[a-f0-9]{64}$/.test(text)) fail('INVALID_ARGUMENT', '无效参数摘要');
  return text;
}
