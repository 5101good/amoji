import { fixture } from './dsh-correlated.js';
const f=await fixture({after:()=>{}},false,process.argv[2]);
f.host.ctx.on('agent/request',async(p,next)=>{const config=await next();await f.host.ctx.sessions.flush(p.agent.session);process.exit(0);return config;});
await f.apply({ref:f.ref,requestId:'crash',action:f.action});
await f.live.whenIdle();
throw Error('Crash seam was not reached');
