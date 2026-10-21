import { bridge, L } from './transport.js';
export function marketCall($,s,method,args={}) { return bridge($,s.context,'marketplace',{method,args}); }
export function publisherCall($,s,method,args={}) { return bridge($,s.context,'publisher',{method,args}); }
export async function refreshMarket($,s,search=true) {
  s.marketLocal=await marketCall($,s,'local');
  if(search)s.marketRows=await marketCall($,s,'search',{query:s.marketQuery||'',...(s.marketFilters||{})});
}
export async function showRelease($,s,pack_id,release_id) {
  const release=await marketCall($,s,'detail',{pack_id,...(release_id?{release_id}:{})});
  s.marketRelease=release;s.marketPage=0;s.marketPreviews={};
  const previous=s.marketLocal?.installs?.find(i=>i.manifest.pack_id===release.pack_id&&i.release_id!==release.release_id);
  s.marketBefore=previous?.manifest;
  await loadMarketImages($,s);
}
export async function loadMarketImages($,s) {
  const release=s.marketRelease;
  for(const e of release.manifest.expressions.slice((s.marketPage||0)*4,(s.marketPage||0)*4+4)) {
    if(s.marketPreviews[e.revision_id])continue;
    try{s.marketPreviews[e.revision_id]=await marketCall($,s,'visual',{pack_id:release.pack_id,release_id:release.release_id,digest:(e.visual.poster||e.visual.primary).sha256});}catch{}
  }
}
export async function settleInstall($,s,operation) {
  if(operation.status==='pending'){s.notice=L(s,'安装结果待核对，请查询原操作。','Installation is pending. Check the original operation.');return;}
  s.marketPending=null;
  if(operation.status==='failed')throw Error(operation.error||'MARKET_UNAVAILABLE');
  s.notice=L(s,'已保存到本地表情库。','Saved to your local library.');
  s.collection=null;s.galleryBuffer=null;
  await refreshMarket($,s,false);
}
export async function acquire($,s,expression) {
  if(s.marketPending)return;
  const release=s.marketRelease;
  const operation_id=await marketCall($,s,'operationId');
  s.marketPending=operation_id;
  await settleInstall($,s,await marketCall($,s,expression?'collect':'install',{
    operation_id,pack_id:release.pack_id,release_id:release.release_id,
    ...(expression?{ref:{asset_id:expression.asset_id,revision_id:expression.revision_id}}:{}),
  }));
}
export async function refreshPublisher($,s) {
  s.publishLogin=await publisherCall($,s,'loginStatus');
  s.publishDrafts=await publisherCall($,s,'drafts');
  s.scenarios=await bridge($,s.context,'scenario',{method:'list'});
}
export function openPublication(s,draft) {
  s.publication=draft;s.publicationFields=JSON.parse(JSON.stringify(draft.manifest));
  s.publicationRights=false;s.publicationPage=0;s.publicationVisited=new Set();
  s.publicationActions=s.publicationFields.actions.map(a=>a.action_revision_id);
}
export async function savePublication($,s,step) {
  const d=s.publication,v=s.publicationFields;
  const result=await publisherCall($,s,'save',{id:d.id,version:d.version,step,name:v.name,description:v.description||'',
    license:v.rights.license,creator:v.rights.creator||'',source:v.rights.source||'',actions:s.publicationActions});
  openPublication(s,result);
  s.publishDrafts=await publisherCall($,s,'drafts');
}
export async function publicationAction($,s,method) {
  try{openPublication(s,await publisherCall($,s,method,{id:s.publication.id,
    ...(['submit','retrySubmit'].includes(method)?{rights_confirmed:s.publicationRights===true}:{})}));}
  finally {
    s.publishDrafts=await publisherCall($,s,'drafts');
    const current=s.publishDrafts.find(d=>d.id===s.publication.id);
    if(current)s.publication=current;
  }
}
