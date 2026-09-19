import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dataDirectory } from './shared-contract.js';
import { startSharedService } from './shared-service.js';

const seed = process.env.AMOJI_SAMPLE_ROOT ? pathToFileURL(`${resolve(process.env.AMOJI_SAMPLE_ROOT)}/`) : new URL(import.meta.url.endsWith('.ts') ? '../assets/base-library/base.amoji' : '../../assets/base-library/base.amoji', import.meta.url);
try {
  const service = await startSharedService(dataDirectory(), seed, Number(process.env.AMOJI_SERVICE_IDLE_MS) || 60000);
  process.once('SIGTERM', () => { void service.close(); });
  process.once('SIGINT', () => { void service.close(); });
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (code === 'SERVICE_STARTING') process.exitCode = 75;
  else { process.stderr.write(`${error instanceof Error ? error.message : '服务启动失败'}\n`); process.exitCode = 1; }
}
