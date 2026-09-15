import { defineTool } from '@deepseek-ai/dsh-tools';
import { SharedClient } from './runtime/src/shared-client.js';
import { ConnectedRuntime } from './runtime/src/adapter-runtime.js';
import { DSH_SUBMISSION_CAPABILITY } from './runtime/src/shared-contract.js';
import { installDsh } from './runtime/src/dsh/host.js';
export const inject = ['tools', 'sessions', 'sessionProjections', 'sessionController', 'connection'];
export const name = 'amoji';
export async function apply(ctx) {
  const client = await SharedClient.connect({ requiredCapabilities: [DSH_SUBMISSION_CAPABILITY] });
  ctx.effect(() => () => client.close(), 'amoji: shared core connection');
  installDsh(ctx, new ConnectedRuntime(client), 'local', defineTool);
}
