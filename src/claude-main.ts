import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SharedClient } from './shared-client.js';
import { CLAUDE_TICKET_CAPABILITY } from './shared-contract.js';
import { ConnectedRuntime } from './adapter-runtime.js';
import { PanelServer } from './panel-server.js';
import { createClaudeServer } from './claude-mcp-server.js';

const client = await SharedClient.connect({ requiredCapabilities: [CLAUDE_TICKET_CAPABILITY] });
const runtime = new ConnectedRuntime(client);
const panel = await PanelServer.start(runtime, async url => {
  const run = promisify(execFile);
  if (process.platform === 'darwin') await run('open', [url]);
  else if (process.platform === 'win32') await run('explorer.exe', [url]);
  else await run('xdg-open', [url]);
});
const server = createClaudeServer(client, runtime, panel);
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
