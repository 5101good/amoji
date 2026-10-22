import { L } from './transport.js';
import { send, navigate, perform } from './controller.js';
import { actionText } from './guidance.js';
import { localized } from './ui-kit.js';
import { marketCall, refreshMarket, showRelease, loadMarketImages, acquire, settleInstall } from './market.js';

export function marketView($,s,k) {
  const {besideWidth,col,row,stack,button,input,select,thumb,showcase,Link,Button,Input,ui}=k;
  const tr=(zh,en)=>L(s,zh,en),lo=v=>localized(s,v);
  const local={installs:[],collections:[],...s.marketLocal},release=s.marketRelease;
  const installedOf=packId=>local.installs.find(i=>i.manifest.pack_id===packId);
  const owned=e=>local.collections.some(c=>c.ref.revision_id===e.revision_id)||local.installs.some(i=>i.refs.some(r=>r.revision_id===e.revision_id));
  // Search rows carry counts only; releases and installs carry full manifests.
  const counts=(expressions,actions)=>[tr(`${expressions} 个表情`,`${expressions} EXPR`),
    actions?tr(`${actions} 条提示`,`${actions} GUIDANCE`):''];
  const countsOf=m=>counts(m.expressions.length,m.actions?.length||0);
  const facts=parts=>ui.mono(parts.filter(Boolean).join(' · '));
  const actionCard=(a,key)=>ui.card({key,gap:0,children:[
    ui.row([ui.label(lo(a.effect_summary)),ui.badge('info',a.scope==='turn'?tr('单次','ONCE'):tr('对话规则','RULE'))]),
    ui.body(lo(actionText(s,a))),
    ui.caption(a.scope==='turn'?tr('随单次表达附带，发送时由你选择。','Sent with one expression, only when you choose it.'):tr('当前对话的预定义规则，需你手动启用。','A predefined rule for this conversation; you enable it yourself.')),
  ]});
  const page=s.marketPage||0,pages=release?Math.ceil(release.manifest.expressions.length/4):0;
  const nameOf=c=>release?.manifest.expressions.find(e=>e.revision_id===c.ref.revision_id)?.name||
    local.installs.flatMap(i=>i.manifest.expressions).find(e=>e.revision_id===c.ref.revision_id)?.name||tr('收藏的表情','Collected expression');
  const open=p=>()=>perform($,s,()=>showRelease($,s,p.pack_id,p.release_id));
  const packs=s.marketRows?.packs||[];

  const browse=()=>col([
    Input({key:'market-query',placeholder:tr('搜索名称、心情或使用场景','Search a name, mood or situation'),submitLabel:tr('搜索','Search'),
      value:s.marketQuery||'',onInput:v=>{if(!s.busy)s.marketQuery=v;},onSubmit:v=>perform($,s,async()=>{s.marketQuery=v;await refreshMarket($,s);})}),
    row([button('market-filters',tr(s.marketFilterOpen?'收起筛选':'筛选 ›',s.marketFilterOpen?'Hide filters':'Filters ›'),async()=>{s.marketFilterOpen=!s.marketFilterOpen;})]),
    s.marketFilterOpen&&ui.card({children:[
      ...['scenario','locale','style'].map((key,i)=>input('market-'+key,tr(['场景','语义语言','画风'][i],['Situation','Semantic language','Style'][i]),s.marketFilters?.[key]||'',v=>{s.marketFilters={...s.marketFilters,[key]:v};})),
      select('market-actions',tr('协作提示','Collaboration guidance'),s.marketFilters?.actions||'',[['',tr('全部','All')],['true',tr('包含提示','With guidance')],['false',tr('仅表达','Expressions only')]],v=>{s.marketFilters={...s.marketFilters,actions:v};}),
    ]}),
    s.marketRows?.stale&&ui.status('warning',tr('当前展示离线缓存；发布状态可能已变化。','Showing cached results; publication status may have changed.')),
    packs.length>0&&ui.section(tr(`表情包 · ${packs.length}`,`PACKS · ${packs.length}`)),
    ...packs.map(p=>{
      const m=p.manifest,mine=installedOf(p.pack_id);
      return ui.card({key:'market-card:'+p.release_id,direction:'row',gap:2,selected:!!mine,children:[
        thumb(s.marketCovers?.[p.release_id],lo(m.name),8,4),
        stack([
          ui.row([Button({key:'market-open:'+p.release_id,label:lo(m.name),plain:true,hover:{color:ui.ACCENT},dimColor:s.busy,onPress:open(p)}),
            mine&&ui.badge('success',mine.release_id===p.release_id?tr('已安装','INSTALLED'):tr('可更新','UPDATE'))]),
          (m.description||m.scenario?.length)&&ui.clamp('caption',lo(m.description||m.scenario.join(' · ')),besideWidth(8)),
          facts([p.author,...counts(p.expression_count??0,p.action_count??0),'v'+m.version]),
        ]),
      ]});
    }),
    !packs.length&&(s.busy?ui.status('busy',tr('正在加载市场…','Loading the market…')):ui.card({children:[
      ui.label(tr('没有匹配的公开表情包','No matching public packs')),ui.caption(tr('换个关键词，或清空筛选再试。','Try another word or clear the filters.'))]})),
    s.marketRows?.last_checked_at&&ui.mono(tr('上次同步 ','LAST SYNC ')+s.marketRows.last_checked_at),
  ]);

  const detail=()=>{
    const m=release.manifest,mine=installedOf(release.pack_id),current=mine?.release_id===release.release_id;
    return col([
      button('market-back',tr('‹ 返回市场','‹ Back to market'),async()=>{s.marketRelease=null;}),
      ui.card({direction:'row',gap:2,selected:current,children:[
        thumb(s.marketCovers?.[release.release_id]||s.marketPreviews?.[m.expressions[0]?.revision_id],lo(m.name),12,5),
        stack([
          ui.title(lo(m.name)),
          (m.description||m.scenario?.length)&&ui.caption(lo(m.description||m.scenario.join(' · ')),besideWidth(12)),
          facts([release.author,'v'+m.version,...countsOf(m),m.rights?.license]),
        ]),
      ]}),
      row([
        !s.marketPending&&button('market-install',tr(s.marketBefore?'采用新版本':current?'重新安装':'安装整包',
          s.marketBefore?'Adopt update':current?'Reinstall':'Install pack'),()=>acquire($,s),true),
        current&&ui.badge('success',tr('● 已在你的表情库','● IN YOUR LIBRARY')),
        Link({href:release.share_url,children:[tr('网页查看 ↗','Web ↗')]}),
      ]),
      ui.caption(tr('名称下方是 Claude 读到的固定语义。安装不会启用任何协作提示。','Under each name is the fixed meaning Claude reads. Installing never enables guidance.')),
      ui.section(tr(`表情 · ${m.expressions.length}`,`EXPRESSIONS · ${m.expressions.length}`)),
      ...m.expressions.slice(page*4,page*4+4).map(e=>ui.card({key:'market-item:'+e.revision_id,gap:1,children:[
        showcase(s.marketPreviews?.[e.revision_id],e.name,[
          ui.label(e.name),ui.body(e.semantics.meaning,besideWidth(10)),
          facts([e.semantics.fallback!==e.name&&e.semantics.fallback,e.semantics.locale,e.rights?.license]),
        ],10,4),
        row([
          owned(e)&&Button({key:'market-send:'+e.revision_id,label:tr('发送','Send'),variant:'primary',onPress:()=>send($,s,e)}),
          !s.marketPending&&!owned(e)&&button('market-collect:'+e.revision_id,tr('只收藏这一个','Collect only this'),()=>acquire($,s,e)),
          owned(e)&&button('market-guidance:'+e.revision_id,tr('配合提示发送','Send with guidance'),async()=>{s.guidanceExpression=e;await navigate($,s,'guidance');}),
        ]),
      ]})),
      pages>1&&row([
        page>0&&button('market-prev',tr('‹ 上一页','‹ Previous'),async()=>{s.marketPage--;await loadMarketImages($,s);}),
        ui.mono(`${page+1} / ${pages}`),
        page+1<pages&&button('market-next',tr('下一页 ›','Next ›'),async()=>{s.marketPage=page+1;await loadMarketImages($,s);}),
      ]),
      m.actions.length>0&&ui.section(tr(`可选协作提示 · ${m.actions.length}`,`OPTIONAL GUIDANCE · ${m.actions.length}`)),
      ...m.actions.map(a=>actionCard(a,'market-action:'+a.action_revision_id)),
      s.marketBefore&&ui.card({selected:true,children:[
        ui.label(tr('更新预览','Review update')),
        ui.caption(tr('采用后旧规则停用，新提示仍需确认。','Updating disables old rules. New guidance needs confirmation.')),
        button('market-diff',tr(s.marketDiffOpen?'收起差异':'展开语义与提示差异',s.marketDiffOpen?'Hide changes':'Show meaning and guidance changes'),async()=>{s.marketDiffOpen=!s.marketDiffOpen;}),
        s.marketDiffOpen&&col([ui.mono(tr('原版本','PREVIOUS VERSION')),
          ...s.marketBefore.expressions.map(e=>ui.body(e.name+'：'+e.semantics.meaning)),
          ...s.marketBefore.actions.map(a=>ui.body(lo(a.effect_summary)+'：'+lo(actionText(s,a)))),
          ui.caption(tr('新版本的语义与提示见上方。','The new meanings and guidance are shown above.'))]),
      ]}),
    ]);
  };

  return col([
    s.marketPending&&ui.card({selected:true,children:[
      ui.label(tr('有一次安装还没有确认结果','An installation has not been confirmed')),
      button('market-reconcile',tr('核对原安装操作','Check original installation'),async()=>settleInstall($,s,await marketCall($,s,'installStatus',{operation_id:s.marketPending}))),
    ]}),
    release?detail():browse(),
    (local.installs.length>0||local.collections.length>0)&&ui.section(tr('我的安装','INSTALLED')),
    ...local.installs.map(i=>ui.card({gap:0,children:[
      ui.row([ui.label(lo(i.manifest.name)),ui.mono('v'+i.manifest.version)]),
      facts(countsOf(i.manifest)),
      row([
        button('market-update:'+i.release_id,tr('检查更新','Check updates'),()=>showRelease($,s,i.manifest.pack_id)),
        button('market-remove:'+i.release_id,tr('移除','Remove'),async()=>{await marketCall($,s,'remove',{pack_id:i.manifest.pack_id});await refreshMarket($,s,false);s.collection=null;}),
      ]),
    ]})),
    local.collections.length>0&&ui.card({gap:0,children:[
      ui.label(tr('单独收藏的表情','Collected expressions')),
      ...local.collections.map(c=>row([ui.body(nameOf(c)),button('market-uncollect:'+c.ref.revision_id,tr('取消收藏','Remove'),async()=>{await marketCall($,s,'uncollect',{ref:c.ref});await refreshMarket($,s,false);s.collection=null;})])),
    ]}),
  ]);
}
