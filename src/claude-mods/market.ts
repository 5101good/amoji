import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { SharedClient } from '../shared-client.js';
import type { BindingContext } from '../shared-contract.js';
import { fail, nonempty, object } from '../shared-contract.js';
import { expressionRef } from '../library-management.js';
import { draftVersion } from '../drafts.js';
import { cachedThumbnailImage } from './thumbnail.js';
import { writeNewFile } from './files.js';

/** Management-only commands. These are never registered as model tools. */
export async function executeMarketBridge(client: SharedClient, context: BindingContext, command: string,
  raw: Record<string,unknown>, options:{previewDirectory?:string}):Promise<unknown> {
  if(context.host!=='claude-code')fail('BINDING_MISMATCH','需要 Claude 会话');
  if(command==='marketplace') {
    const a=object(raw,['method','args']);
    const method=nonempty(a.method);
    if(method==='operationId'){object(a.args,[]);return randomUUID();}
    if(method==='visual') {
      const args=object(a.args,['pack_id','release_id','digest']);
      const digest=nonempty(args.digest);
      return cachedThumbnailImage(digest,async()=>{
        const data=await client.marketplace('visual',args);
        if(typeof data!=='string'||!/^data:image\/[a-z0-9.+-]+;base64,/i.test(data))fail('MARKET_INVALID','图片响应无效');
        return Buffer.from(data.slice(data.indexOf(',')+1),'base64');
      },options.previewDirectory,'gallery');
    }
    return client.marketplace(method,a.args);
  }
  if(command==='publisher') {
    const a=object(raw,['method','args']);
    return client.publisher(nonempty(a.method),a.args);
  }
  const a=object(raw,['method','refs','id','version','manifest','reviewed','path','expressionsOnly'],['method']);
  switch(a.method) {
    case 'previews': {
      if(!Array.isArray(a.refs)||a.refs.length>4)fail('INVALID_ARGUMENT','一次预览最多四个表情');
      const images:Record<string,string|null>={};
      for(const ref of a.refs){const e=await client.resolve(expressionRef(ref));const blob=e.visual.poster??e.visual.primary;
        try{images[e.revision_id]=await cachedThumbnailImage(blob.sha256,async()=>readFile(await client.blobPath(blob.sha256)),options.previewDirectory,'gallery');}catch{images[e.revision_id]=null;}
      }return images;
    }
    case 'list': return {packs:await client.listScenarioPacks(),drafts:await client.listScenarioDrafts()};
    case 'create': {
      if(!Array.isArray(a.refs))fail('INVALID_ARGUMENT','请选择表情');
      return client.createScenarioDraft(a.refs.map(expressionRef));
    }
    case 'save': return client.saveScenarioDraft(nonempty(a.id),draftVersion(a.version),a.manifest as Parameters<SharedClient['saveScenarioDraft']>[2]);
    case 'preview': return client.previewScenarioDraft(nonempty(a.id),draftVersion(a.version));
    case 'confirm': {
      if(a.reviewed!==true)fail('REVIEW_REQUIRED','请先核对图片、固定语义和许可');
      return client.confirmScenarioDraft(nonempty(a.id),draftVersion(a.version));
    }
    case 'export': {
      const bytes=await client.exportScenarioPack(nonempty(a.id),a.expressionsOnly===true);
      await writeNewFile(nonempty(a.path),bytes);return {bytes:bytes.length};
    }
    default: fail('INVALID_ARGUMENT','未知表情包操作');
  }
}
