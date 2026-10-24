import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dataDirectory } from './shared-contract.js';
import { startSharedService } from './shared-service.js';

// Built-in packs, in default preference order. AMOJI_SEED_PACKS (comma-separated paths) overrides them for tests.
const assets = new URL(import.meta.url.endsWith('.ts') ? '../assets/official-packs/' : '../../assets/official-packs/', import.meta.url);
const seeds = process.env.AMOJI_SEED_PACKS !== undefined
  ? process.env.AMOJI_SEED_PACKS.split(',').filter(Boolean).map(path => pathToFileURL(resolve(path)))
  : ['classic.amoji', 'office.amoji'].map(name => new URL(name, assets));
try {
  const service = await startSharedService(dataDirectory(), seeds, Number(process.env.AMOJI_SERVICE_IDLE_MS) || 60000);
  process.once('SIGTERM', () => { void service.close(); });
  process.once('SIGINT', () => { void service.close(); });
  // This process owns only the service. Exit after HTTP, SQLite and the writer
  // lock have closed; a cancelled outbound fetch may still retain a transport
  // handle. Library callers keep normal process ownership and only await closed.
  await service.closed;
  process.exit(0);
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (code === 'SERVICE_STARTING') process.exitCode = 75;
  else { process.stderr.write(`${error instanceof Error ? error.message : '服务启动失败'}\n`); process.exitCode = 1; }
}
