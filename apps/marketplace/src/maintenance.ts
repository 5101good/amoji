import type { Env } from './worker';
/** Independent queues: cleanup pressure must never prevent a recovery snapshot. */
export async function scheduledMaintenance(env: Env) {
 if (!env.FREE_RUNTIME) throw Error('RUNTIME_UNAVAILABLE');
 const runtime=env.FREE_RUNTIME;
 const outcomes=await Promise.allSettled([
  Promise.resolve().then(()=>runtime.getByName('free-runtime-v1').fetch('https://runtime/cleanup',{method:'POST'})),
  Promise.resolve().then(()=>runtime.getByName('backup-v1').fetch('https://runtime/backup',{method:'POST'})),
 ]);
 if(outcomes.some(result=>result.status==='rejected'||!result.value.ok))throw Error('MAINTENANCE_RETRY');
}
