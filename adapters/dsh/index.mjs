import {DshPublisher,MARKET_ORIGIN} from './runtime/src/dsh/publisher.js';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { loadProfileIdentity } from './runtime/src/dsh/profile-identity.js';
import { DshCollaboration } from './runtime/src/dsh/collaboration.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { SharedClient } from './runtime/src/shared-client.js';
import { ConnectedRuntime } from './runtime/src/adapter-runtime.js';
import { DSH_RELIABILITY_CAPABILITY, DSH_NATIVE_CAPABILITY, LIBRARY_MANAGEMENT_CAPABILITY, PACKS_CAPABILITY } from './runtime/src/shared-contract.js';
import { installDsh } from './runtime/src/dsh/host.js';
export const inject = ['tools', 'sessions', 'sessionProjections', 'sessionController', 'connection', 'llm', 'agents', 'systemPrompt'];
export const name = 'amoji';
export async function apply(ctx) {
  const client = await SharedClient.connect({ requiredCapabilities: [DSH_RELIABILITY_CAPABILITY, DSH_NATIVE_CAPABILITY, LIBRARY_MANAGEMENT_CAPABILITY, PACKS_CAPABILITY] });
  ctx.effect(() => () => client.close(), 'amoji: shared core connection');
  const runtime = new ConnectedRuntime(client);
  let hostInstanceId = 'local';
  let collaboration;
  if (ctx.agents && ctx.systemPrompt && typeof ctx.on === 'function') {
    try {
      hostInstanceId = (await loadProfileIdentity(dshHomePath('plugins', 'amoji'))).id;
      collaboration = new DshCollaboration(ctx, runtime, hostInstanceId);
      ctx.effect(() => () => collaboration.dispose(), 'amoji: collaboration lifecycle');
    } catch { /* Identity unavailable: preserve expressions; actions fail explicitly. */ }
  }
  const publisher=new DshPublisher(dshHomePath('plugins','amoji','publisher'),runtime,process.env.AMOJI_MARKET_ORIGIN||MARKET_ORIGIN);
  installDsh(ctx, runtime, hostInstanceId, defineTool, collaboration,publisher);
}
