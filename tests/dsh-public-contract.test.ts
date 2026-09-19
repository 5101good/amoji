import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '@deepseek-ai/dsh-session';
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session/types';
import { validateStoredEvents } from '@deepseek-ai/dsh-session-persistence';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client';
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { SessionCreateRequest } from '@deepseek-ai/dsh-api-session-controller';
import type { DshAdapter } from '../src/dsh/host.js';
import type { DshSession } from '../src/dsh/contracts.js';
import { createComponents } from '../src/dsh/client.js';

// Compiled against pinned published declarations, no structural fixture substitutes.
function publicContracts(adapter: DshAdapter, slots: SlotRegistry, views: ReturnType<typeof createComponents>, session: Session, owner: ToolCallOwnerProps, user: ChatNodeViewProps<'user'>) {
  defineTool(adapter.tool('amoji_emit'));
  const port: DshSession = session;
  const create: SessionCreateRequest = { workspaceId: undefined, agentPreset: undefined };
  slots.inject('conversation.input.left', () => slots.register({ name: 'conversation.input.left', id: 'amoji' }, views.Picker));
  slots.inject('tool.call.toolview', () => slots.register({ name: 'tool.call.toolview', key: 'amoji_emit' }, views.ToolView));
  const block = owner.block;
  if ('kind' in block && block.kind === 'tool-result') void block.meta;
  void user.node.data.source;
  return { port, create };
}
void publicContracts;

test('0.1.5-rc.2 真实 Session + 持久化读取器：原生 rpcId 冷恢复，自定义事件被拒绝', () => {
  const session = Session.create(SessionId('amoji-contract-session'));
  session.append('user/message', { role: 'user', id: 'native-message' as never, content: [{ type: 'text', text: '固定语义' }], source: { kind: 'user', rpcId: 'amoji:message-id' as never } }, { surfaceOp: 'append' });
  const encoded = JSON.stringify(session.snapshotEvents());
  const restoredEvents = validateStoredEvents(session.header, JSON.parse(encoded));
  const restored = Session.fromRestore(session.id, restoredEvents, session.header, SessionLogOffset(0), 'shared-frozen');
  assert.deepEqual(restored.snapshotEvents().slice(0, session.snapshotEvents().length), session.snapshotEvents());
  assert.doesNotThrow(() => validateStoredEvents(restored.header, JSON.parse(JSON.stringify(restored.snapshotEvents()))));
  assert.equal(restored.snapshotEvents()[0]!.type, 'user/message');
  const bad = JSON.parse(encoded); bad[0].type = 'amoji/submission';
  assert.throws(() => validateStoredEvents(session.header, bad), /unknown|unsupported|amoji\/submission/i);
});
