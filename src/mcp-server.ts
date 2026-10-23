import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { codexContext } from './codex-context.js';
import { messageProjection } from './projection.js';
import { actGloss } from './protocol/index.js';
import { amojiTools, amojiPickTool, runModelTool } from './model-tools.js';
import type { AdapterRuntime } from './adapter-runtime.js';
import type { PanelServer } from './panel-server.js';

export { amojiTools, amojiPickTool } from './model-tools.js';

export function createAmojiServer(runtime: AdapterRuntime, panel?: PanelServer): Server {
  const server = new Server({ name: 'amoji', version: '0.1.0' }, { capabilities: { tools: {} } });
  const available: Tool[] = panel ? [...amojiTools, amojiPickTool] : amojiTools;
  const ajv = new Ajv2020();
  const validators = new Map(available.map(tool => [tool.name, ajv.compile(tool.inputSchema)]));
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: available }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const validate = validators.get(request.params.name);
      const args = request.params.arguments ?? {};
      if (!validate || !validate(args)) throw new Error('无效工具参数；不接受语义覆盖或目标会话');
      const context = codexContext(request.params._meta);
      let result: unknown;
      if (request.params.name === 'amoji_pick') {
        const message = await panel!.pick(context, extra.signal);
        result = messageProjection(message);
      } else {
        const run = await runModelTool(runtime, context, request.params.name, args);
        result = run.result;
        const glyph = run.message?.revision;
        if (glyph) {
          const path = runtime.blobPath ? await runtime.blobPath(glyph.visual.primary.sha256) : fileURLToPath(new URL(`blobs/${glyph.visual.primary.sha256}`, runtime.catalog.root));
          const alt = actGloss(run.message!.act, 'a2h').text.replace(/[[\]\\]/g, '');
          result = { ...run.result, display_markdown: `![${alt}](<${path}>)`, ...(panel ? { panel_url: panel.url(context) } : {}) };
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Amoji 操作失败' }] };
    }
  });
  return server;
}
