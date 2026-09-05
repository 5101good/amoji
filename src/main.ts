import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAmojiServer } from './mcp-server.js';
import { PanelServer } from './panel-server.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { openPrototypeState } from './prototype-state.js';

const root = process.env.AMOJI_SAMPLE_ROOT
  ? pathToFileURL(`${resolve(process.env.AMOJI_SAMPLE_ROOT)}/`)
  : new URL('../../assets/samples/', import.meta.url);
const directory = process.env.AMOJI_DATA_DIR ?? resolve(homedir(), 'Library/Application Support/Amoji/prototype');
const { runtime, journal } = await openPrototypeState(root, directory);
const panel = await PanelServer.start(runtime, async url => {
  if (process.platform !== 'darwin') throw new Error('此接入小样的自动打开面板仅验证 macOS');
  await promisify(execFile)('open', [url]);
});
const server = createAmojiServer(runtime, panel);
server.onclose = () => { void panel.close().finally(() => journal.close()); };
let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await server.close();
  await panel.close();
  journal.close();
}
process.stdin.once('end', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
await server.connect(new StdioServerTransport());
