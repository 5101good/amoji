import { L } from './transport.js';
import { send, navigate } from './controller.js';
import { marketCall, refreshMarket, showRelease, loadMarketImages, acquire, settleInstall } from './market.js';
export function marketView($,s,k) {
  const {col,row,t,heading,button,input,select,picture,Link,Button}=k;
  const tr=(zh,en)=>L(s,zh,en);
  const local=s.marketLocal||{installs:[],collections:[]},release=s.marketRelease;
  const owned=e=>local.collections.some(c=>c.ref.revision_id===e.revision_id)||local.installs.some(i=>i.refs.some(r=>r.revision_id===e.revision_id));
  const actionDetails=a=>col([heading(a.effect_summary),t(tr(a.scope==='turn'?'本次表达附带的提示':'当前对话的预定义规则',a.scope==='turn'?'Guidance for this expression':'Predefined conversation rule'),true),
    t(a.kind==='instruction'?a.instruction:JSON.stringify({template:a.template,config:a.config})),t(a.rights.license+' · '+a.locale,true)]);
  return col([
    heading(tr('表情市场','Expression market')),
    t(tr('发现新的表达，带回你的日常对话。无需登录即可下载。','Discover expressions for your everyday conversations. Download without signing in.'),true),
    input('market-query',tr('搜索表情包','Search packs'),s.marketQuery||'',v=>{s.marketQuery=v;},tr('名称、心情或使用场景','Name, mood or situation')),
    row([button('market-search',tr('搜索','Search'),()=>refreshMarket($,s),true),button('market-filters',tr('筛选','Filters'),async()=>{s.marketFilterOpen=!s.marketFilterOpen;})]),
    s.marketFilterOpen&&col(['scenario','locale','style'].map((key,i)=>input('market-'+key,tr(['场景','语义语言','画风'][i],['Situation','Semantic language','Style'][i]),s.marketFilters?.[key]||'',v=>{s.marketFilters={...s.marketFilters,[key]:v};})).concat([
      select('market-actions',tr('协作提示','Collaboration guidance'),s.marketFilters?.actions||'',[['',tr('全部','All')],['true',tr('包含提示','With guidance')],['false',tr('仅表达','Expressions only')]],v=>{s.marketFilters={...s.marketFilters,actions:v};})])),
    s.marketRows?.stale&&t(tr('当前展示离线缓存；发布状态可能已变化。','Showing cached results; publication status may have changed.'),true),
    s.marketRows?.last_checked_at&&t(tr('上次核对：','Last checked: ')+s.marketRows.last_checked_at,true),
    s.marketPending&&button('market-reconcile',tr('核对原安装操作','Check original installation'),async()=>settleInstall($,s,await marketCall($,s,'installStatus',{operation_id:s.marketPending}))),
    !release?col([
      ...(s.marketRows?.packs||[]).map(p=>button('market-open:'+p.release_id,p.manifest.name+' · v'+p.manifest.version,()=>showRelease($,s,p.pack_id,p.release_id))),
      !s.marketRows?.packs?.length&&t(s.busy?tr('正在加载市场…','Loading the market…'):tr('暂时没有匹配的公开表情包。','No matching public packs.')),
    ]):col([
      button('market-back',tr('‹ 返回市场','‹ Back to market'),async()=>{s.marketRelease=null;}),
      heading(release.manifest.name+' · v'+release.manifest.version),
      t(release.manifest.description||release.manifest.scenario.join(' · ')),
      t((release.author||release.manifest.rights.creator||'Amoji')+' · '+release.manifest.rights.license,true),
      Link({href:release.share_url,children:[t(tr('在网页中查看此版本 ↗','View this release on the web ↗'))]}),
      t(tr('图片旁的文字是固定语义。协作提示需单独选择，安装不会启用。','The text beside each image is its fixed meaning. Installing never enables guidance.'),true),
      ...release.manifest.actions.map(actionDetails),
      ...release.manifest.expressions.slice((s.marketPage||0)*4,(s.marketPage||0)*4+4).map(e=>col([
        picture(s.marketPreviews?.[e.revision_id],e.name),heading(e.name),t(e.semantics.meaning),t(e.semantics.fallback,true),
        t(e.semantics.locale+' · '+e.rights.license,true),row([
          !s.marketPending&&button('market-collect:'+e.revision_id,tr('单独收藏','Collect expression'),()=>acquire($,s,e)),
          owned(e)&&button('market-guidance:'+e.revision_id,tr('可选提示','Optional guidance'),async()=>{s.guidanceExpression=e;await navigate($,s,'guidance');}),
          owned(e)&&Button({key:'market-send:'+e.revision_id,label:tr('发送','Send'),onPress:()=>send($,s,e)}),
        ]),
      ])),
      row([
        (s.marketPage||0)>0&&button('market-prev',tr('上一页','Previous'),async()=>{s.marketPage--;await loadMarketImages($,s);}),
        t(`${(s.marketPage||0)+1} / ${Math.ceil(release.manifest.expressions.length/4)}`,true),
        ((s.marketPage||0)+1)*4<release.manifest.expressions.length&&button('market-next',tr('下一页','Next'),async()=>{s.marketPage=(s.marketPage||0)+1;await loadMarketImages($,s);}),
      ]),
      s.marketBefore&&col([
        heading(tr('更新预览','Review update')),
        t(tr('采用后旧规则停用，新提示仍需确认。','Updating disables old rules. New guidance needs confirmation.'),true),
        button('market-diff',tr('展开语义与提示差异','Show meaning and guidance changes'),async()=>{s.marketDiffOpen=!s.marketDiffOpen;}),
        s.marketDiffOpen&&col([t(tr('原版本','Previous version')), ...s.marketBefore.expressions.map(e=>t(e.name+': '+e.semantics.meaning)),...s.marketBefore.actions.map(actionDetails),t(tr('新版本的语义与提示见上方。','The new meanings and guidance are shown above.'))]),
      ]),
      !s.marketPending&&button('market-install',tr(s.marketBefore?'确认采用新版本':'安装此版本',s.marketBefore?'Adopt this update':'Install this version'),()=>acquire($,s),true),
    ]),
    heading(tr('已安装','Installed')),
    ...local.installs.map(i=>col([
      t(i.manifest.name+' · v'+i.manifest.version),row([
        button('market-update:'+i.release_id,tr('检查更新','Check updates'),()=>showRelease($,s,i.manifest.pack_id)),
        button('market-remove:'+i.release_id,tr('移除','Remove'),async()=>{await marketCall($,s,'remove',{pack_id:i.manifest.pack_id});await refreshMarket($,s,false);s.collection=null;}),
      ]),
    ])),
    local.collections.length>0&&heading(tr('独立收藏','Collected expressions')),
    ...local.collections.map(c=>row([t(c.ref.revision_id.slice(0,8),true),button('market-uncollect:'+c.ref.revision_id,tr('取消收藏','Remove collection'),async()=>{await marketCall($,s,'uncollect',{ref:c.ref});await refreshMarket($,s,false);s.collection=null;})])),
  ]);
}
