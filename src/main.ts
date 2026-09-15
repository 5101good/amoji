import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAmojiServer } from './mcp-server.js';
import { PanelServer } from './panel-server.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SharedClient } from './shared-client.js';
import { ConnectedRuntime } from './adapter-runtime.js';

const client = await SharedClient.connect();
const runtime = new ConnectedRuntime(client);
const panel = await PanelServer.start(runtime, async url => {
  if (process.platform !== 'darwin') throw new Error('自动打开面板当前仅验证 macOS');
  await promisify(execFile)('open', [url]);
});
const server = createAmojiServer(runtime, panel);
let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await panel.close();
  await server.close();
  await client.close();
}
server.onclose = () => { void shutdown(); };
client.signal.addEventListener('abort', () => { void shutdown(); }, { once: true });
process.stdin.once('end', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
await server.connect(new StdioServerTransport());
