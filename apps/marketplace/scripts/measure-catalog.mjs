// 100 requests, 20 concurrent readers: remains below the 120/minute/IP application limit.
import {writeFile} from 'node:fs/promises';
const [origin,networkLabel,output]=process.argv.slice(2);
if(!origin||!networkLabel||!output||!/^https:\/\//.test(origin))throw Error('Usage: node measure-catalog.mjs HTTPS_ORIGIN NETWORK_LABEL PRIVATE_OUTPUT.json');
const samples=[];const failures=[];
for(let round=0;round<5;round++)await Promise.all(Array.from({length:20},async()=>{
 const start=performance.now();try{const response=await fetch(origin+'/v1/packs?q=performance',{redirect:'error',signal:AbortSignal.timeout(15000)});const value=await response.json();const elapsed=performance.now()-start;const duration=Number(/amoji;dur=([0-9.]+)/.exec(response.headers.get('server-timing')??'')?.[1]);
 if(!response.ok||value.packs?.length!==20||!Number.isFinite(duration))failures.push({status:response.status});else samples.push({server_ms:duration,first_page_ms:elapsed});
 }catch{failures.push({code:'NETWORK_FAILURE'});}
}));
const p95=key=>samples.map(s=>s[key]).sort((a,b)=>a-b)[Math.ceil(samples.length*.95)-1]??null;
const result={origin,network:networkLabel,at:new Date().toISOString(),concurrency:20,requests:100,success:samples.length,failures,server_p95_ms:p95('server_ms'),first_page_p95_ms:p95('first_page_ms')};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result));
if(failures.length||result.server_p95_ms>500||result.first_page_p95_ms>2000)process.exitCode=1;
