import { SharedClient } from '../shared-client.js';
import { ConnectedRuntime } from '../adapter-runtime.js';
import { ExpressionApplication } from '../application/expressions.js';
import { SESSION_BINDINGS_CAPABILITY, CREATE_DRAFT_CAPABILITY, LIBRARY_MANAGEMENT_CAPABILITY, PACKS_CAPABILITY, ServiceError } from '../shared-contract.js';
import { executeBridge } from './bridge.js';

let client:SharedClient|undefined;
try {
  let input=''; for await (const chunk of process.stdin) { input+=chunk.toString(); if(Buffer.byteLength(input)>128*1024) throw new ServiceError('INVALID_ARGUMENT','请求过大'); }
  const request=JSON.parse(input);
  client=await SharedClient.connect({requiredCapabilities:[SESSION_BINDINGS_CAPABILITY,CREATE_DRAFT_CAPABILITY,LIBRARY_MANAGEMENT_CAPABILITY,PACKS_CAPABILITY]});
  const result=await executeBridge(new ExpressionApplication(new ConnectedRuntime(client),client),client,request);
  process.stdout.write(JSON.stringify({ok:true,result}));
} catch(error) {
  // Do not leak environment values, stack traces, provider URLs or filesystem details.
  const code=error instanceof ServiceError ? error.code : 'BRIDGE_UNAVAILABLE';
  process.stdout.write(JSON.stringify({ok:false,error:{code,message:error instanceof ServiceError?error.message:'本地服务暂时不可用，请检查 Node.js 24+ 和插件运行环境'}}));
} finally { await client?.close(); }
