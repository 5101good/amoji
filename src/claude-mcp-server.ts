import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { amojiTools, amojiPickTool, runModelTool } from './model-tools.js';
import { argumentsDigest, claudeArguments, CLAUDE_TICKET_FIELD, CLAUDE_TOOL_PREFIX } from './claude-context.js';
import { fail } from './shared-contract.js';
import { messageProjection } from './projection.js';
import type { SharedClient } from './shared-client.js';
import type { AdapterRuntime } from './adapter-runtime.js';
import type { PanelServer } from './panel-server.js';

export function createClaudeServer(client: SharedClient, runtime: AdapterRuntime, panel: PanelServer): Server {
  const server = new Server({ name: 'amoji-claude', version: '0.1.0-dev.1' }, { capabilities: { tools: {} } });
  const available: Tool[] = [...amojiTools, amojiPickTool].map(tool => ({
    ...tool,
    ...(tool.name === 'amoji_express' ? { description: `${tool.description} 发送后会打开配套面板显示；presentation=pending 不是宿主投递或人类已读证明。` } : {}),
    inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, [CLAUDE_TICKET_FIELD]: { type: 'string', description: '保留给可信 PreToolUse Hook。模型应省略此字段；不能填写会话或回合。' } } },
  }));
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: available }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const name = request.params.name;
      const supplied = request.params.arguments ?? {};
      const args = claudeArguments(name, supplied);
      const ticket = supplied[CLAUDE_TICKET_FIELD];
      if (typeof ticket !== 'string' || !ticket) fail('CLAUDE_TICKET_UNAVAILABLE', '需要可信 PreToolUse Hook 关联票据；请检查宿主版本和插件 Hook');
      const metadataId = request.params._meta?.['claudecode/toolUseId'];
      if (metadataId !== undefined && (typeof metadataId !== 'string' || !metadataId.trim())) fail('CLAUDE_TICKET_MISMATCH', '宿主附加调用标识不合法');
      const { context } = await client.redeemClaudeTicket({ ticket, toolName: `${CLAUDE_TOOL_PREFIX}${name}`, argumentsDigest: argumentsDigest(args), ...(typeof metadataId === 'string' ? { invocationId: metadataId } : {}) });
      if (extra.signal.aborted) fail('CLAUDE_CALL_CANCELLED', '宿主已取消本次调用');
      let result: unknown;
      if (name === 'amoji_pick') {
        const message = await panel.pick(context, extra.signal);
        result = messageProjection(message);
      } else {
        const run = await runModelTool(runtime, context, name, args);
        result = run.result;
        if (run.message) {
          let panelOpened = false;
          try { await panel.show(context); panelOpened = true; } catch { /* The persisted message remains pending; URL supports manual opening. */ }
          result = { ...run.result, panel_url: panel.url(context), panel_opened: panelOpened,
            ...(!panelOpened ? { panel_notice: '未能自动打开面板。请打开 panel_url 查看此消息；宿主投递和显示状态尚未确认。' } : {}) };
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Amoji 操作失败' }] };
    }
  });
  return server;
}
