import { bridge, L, refOf } from './transport.js';
import { actionText } from './guidance.js';
import { perform, navigate, invalidate } from './controller.js';
import { publisherCall, refreshPublisher, openPublication, savePublication, publicationAction } from './market.js';
export async function publicationPreview($,s) {
  const pack=s.publicationFields||s.scenarioDraft?.manifest;
  if(!pack)return;
  const expressions=pack.expressions.slice((s.publicationPage||0)*4,(s.publicationPage||0)*4+4);
  s.publicationPreviews=await bridge($,s.context,'scenario',{method:'previews',refs:expressions.map(refOf)});
}
export async function openDraft($,s,d) {
  openPublication(s,d);if(d.step===3||d.state!=='draft')await publicationPreview($,s);
}
function previewContent($,s,k,pack) {
  const {col,row,button,showcase,ui,inner,besideWidth}=k,tr=(zh,en)=>L(s,zh,en);
  const page=s.publicationPage||0,pages=Math.ceil(pack.expressions.length/4);
  return col([
    ui.title(pack.name),pack.description&&ui.body(pack.description),
    ui.meta([pack.rights.license,pack.rights.creator,tr(`${pack.expressions.length} 个表情`,`${pack.expressions.length} expressions`)]),
    pack.rights.source&&ui.caption(pack.rights.source),
    ...pack.expressions.slice(page*4,page*4+4).map(e=>ui.card({key:'publish-item:'+e.revision_id,children:[
      showcase(s.publicationPreviews?.[e.revision_id],e.name,[
        ui.label(e.name),ui.body(e.semantics.meaning,besideWidth(12)),
        ui.mono([e.semantics.fallback!==e.name&&e.semantics.fallback,e.semantics.tone,e.semantics.locale].filter(Boolean).join(' · ')),
        ui.mono([e.rights?.license,e.rights?.creator].filter(Boolean).join(' · ')),
      ]),
    ]})),
    pages>1&&row([
      page>0&&button('publish-prev-image',tr('‹ 上一页','‹ Previous'),async()=>{s.publicationPage--;await publicationPreview($,s);}),
      ui.caption(`${page+1} / ${pages}`),
      page+1<pages&&button('publish-next-image',tr('下一页 ›','Next ›'),async()=>{s.publicationPage=page+1;await publicationPreview($,s);}),
    ]),
    ...pack.actions.map(a=>ui.card({gap:0,children:[ui.label(a.effect_summary,inner),ui.body(actionText(s,a),inner)]})),
  ]);
}
export function publisherView($,s,k) {
  const {col,row,button,input,select,Link,ui,inner}=k,tr=(zh,en)=>L(s,zh,en);
  const login=s.publishLogin||{state:'signed_out'},d=s.publication,v=s.publicationFields;
  const label=state=>tr(({draft:'编辑中',uploading:'上传中',uploaded:'已校验',unknown:'结果待核对',submitted:'已投稿',pending:'待审核',published:'已公开',changes_requested:'需要修改',withdrawn:'已撤回'})[state]||state,({draft:'Draft',uploading:'Uploading',uploaded:'Validated',unknown:'Outcome unknown',submitted:'Submitted',pending:'Awaiting review',published:'Published',changes_requested:'Changes requested',withdrawn:'Withdrawn'})[state]||state);
  const tone=state=>({published:'success',changes_requested:'warning',unknown:'warning',withdrawn:'info'})[state]||'info';
  const check=(key,on,text,action)=>button(key,(on?'☑ ':'☐ ')+text,action);
  const next=async step=>{await savePublication($,s,step);if(step===3)await publicationPreview($,s);};
  const steps=[tr('介绍与许可','Details'),tr('协作提示','Guidance'),tr('预览与投稿','Review')];
  return col([
    ui.caption(tr('将你选择的作品投稿到市场，审核后公开。会话和模型设置不会上传。','Submit selected work to the market for review. Conversations and model settings stay on your device.')),
    ui.card({selected:login.state==='authenticated',children:[
      row([ui.label(tr('市场账号','Market account')),ui.badge(login.state==='authenticated'?'success':login.state==='pending'?'warning':'info',
        login.state==='authenticated'?tr('已连接','Connected'):login.state==='pending'?tr('等待授权','Awaiting authorization'):tr('未连接','Not connected'))]),
      login.state==='pending'?col([
        ui.caption(tr('在浏览器登录，并确认页面上的设备短码与下面一致：','Sign in in your browser and confirm it shows this device code:'),inner),
        ui.title(login.user_code),ui.caption(login.device_name,inner),
        Link({href:login.verification_uri,children:[tr('打开市场授权页 ↗','Open authorization page ↗')]}),
        row([button('publish-login-check',tr('我已授权，检查连接','I authorized it — check connection'),async()=>{s.publishLogin=await publisherCall($,s,'loginStatus');},true),
          button('publish-login-cancel',tr('取消授权','Cancel pairing'),async()=>{s.publishLogin=await publisherCall($,s,'cancelLogin');})]),
      ]):login.state==='authenticated'?button('publish-logout',tr('断开此设备','Disconnect device'),async()=>{s.publishLogin=await publisherCall($,s,'logout');})
        :col([ui.caption(tr('投稿前需要连接账号；插件不会接收你的密码。','Connect an account before submitting; the plugin never receives your password.'),inner),
          button('publish-login',tr('连接市场账号','Connect market account'),async()=>{s.publishLogin=await publisherCall($,s,'beginLogin',{device_name:'Amoji Claude'});},true)]),
    ]}),
    ui.card({children:[
      ui.label(tr('新的投稿','New submission')),
      select('publish-source',tr('选择已确认的本地表情包','Choose a confirmed local pack'),s.publishSource||'',
        [['',tr('选择表情包','Choose a pack')],...(s.scenarios?.packs||[]).map(p=>[p.release_id,p.name+' · v'+p.version])],x=>perform($,s,async()=>{s.publishSource=x;})),
      row([s.publishSource&&button('publish-create',tr('开始投稿','Prepare submission'),async()=>openDraft($,s,await publisherCall($,s,'create',{release_id:s.publishSource})),true),
        button('publish-choose',tr('从表情库组织新包','Create a pack from your library'),async()=>{await navigate($,s,'library');s.selecting=true;s.selected={};})]),
      ui.caption(tr('也可以导入 .amoji 表情包后投稿。','You can also import an .amoji pack before submitting.'),inner),
    ]}),
    ((s.publishDrafts||[]).length>0||(s.scenarios?.drafts||[]).some(d=>!d.saved))&&ui.heading(tr('进行中','In progress')),
    ...(s.publishDrafts||[]).map(p=>{const state=p.submission?.state||p.state;return row([
      button('publish-resume:'+p.id,p.manifest.name,()=>openDraft($,s,p)),ui.badge(tone(state),label(state))]);}),
    ...(s.scenarios?.drafts||[]).filter(d=>!d.saved).map(d=>row([button('scenario-resume:'+d.draft_id,d.manifest.name,async()=>{s.scenarioDraft=JSON.parse(JSON.stringify(d));s.scenarioPreview=false;s.scenarioReviewed=false;s.publicationFields=null;await navigate($,s,'scenario');}),
      ui.badge('info',tr('整理中','Organizing'))])),
    button('publish-refresh',tr('刷新草稿与连接','Refresh drafts and connection'),()=>refreshPublisher($,s)),
    d&&v&&ui.card({selected:true,children:[
      row([ui.heading(tr('投稿','Submission')),ui.badge(tone(d.submission?.state||d.state),label(d.submission?.state||d.state))]),
      ui.caption(steps.map((name,i)=>(i+1===d.step?'● ':'○ ')+name).join('   '),inner),
      d.state==='draft'&&col([
        d.step===1&&col([
          input('publish-name',tr('表情包名称','Pack name'),v.name,x=>{v.name=x;}),
          input('publish-description',tr('介绍','Description'),v.description||'',x=>{v.description=x;}),
          select('publish-license',tr('公开分发许可','Distribution license'),v.rights.license,['CC0-1.0','CC-BY-4.0','CC-BY-SA-4.0'].map(x=>[x,x]),x=>{v.rights.license=x;}),
          input('publish-creator',tr('署名','Attribution'),v.rights.creator||'',x=>{v.rights.creator=x;}),
          input('publish-source-url',tr('许可来源','License source'),v.rights.source||'',x=>{v.rights.source=x;}),
        ]),
        d.step===2&&col([
          ui.caption(tr('选择要一起分享的协作提示，使用者仍需自行启用。','Choose guidance to share. Recipients must still enable it themselves.'),inner),
          ...(s.scenarios?.packs.find(p=>p.release_id===d.source_release_id)?.actions||[]).map(a=>check('publish-action:'+a.action_revision_id,s.publicationActions.includes(a.action_revision_id),a.effect_summary,async()=>{
            s.publicationActions=s.publicationActions.includes(a.action_revision_id)?s.publicationActions.filter(x=>x!==a.action_revision_id):[...s.publicationActions,a.action_revision_id];
          })),
          !v.actions.length&&ui.body(tr('这个包只包含表情。','This pack contains expressions only.'),inner),
        ]),
        row([d.step<3&&button('publish-next',tr('保存并继续','Save and continue'),()=>next(d.step+1),true),d.step>1&&button('publish-back',tr('上一步','Back'),()=>next(d.step-1)),button('publish-save',tr('保存草稿','Save draft'),()=>next(d.step))]),
      ]),
      (d.step===3||d.state!=='draft')&&col([
        previewContent($,s,k,v),
        ui.caption(tr('投稿版本一经确认不可改写；后续更新会再次审核。','Submitted releases are immutable; updates are reviewed again.'),inner),
        login.state!=='authenticated'&&['draft','uploading'].includes(d.state)&&ui.tone('warning',tr('请先在上方连接市场账号，再上传。','Connect your market account above before uploading.'),inner),
        login.state==='authenticated'&&['draft','uploading'].includes(d.state)&&button('publish-upload',tr(d.state==='uploading'?'恢复原上传':'上传并校验',d.state==='uploading'?'Resume upload':'Upload and validate'),()=>publicationAction($,s,'upload'),true),
        ['uploaded','unknown'].includes(d.state)&&check('publish-rights',s.publicationRights,tr('我已核对全部内容并拥有公开分发的权利','I reviewed all content and have the rights to distribute it'),async()=>{s.publicationRights=!s.publicationRights;}),
        login.state==='authenticated'&&d.state==='uploaded'&&s.publicationRights&&button('publish-submit',tr('确认投稿，等待审核','Submit for review'),()=>publicationAction($,s,'submit'),true),
        ['unknown','submitted'].includes(d.state)&&col([
          d.submission?.reason&&ui.card({gap:0,children:[ui.label(tr('审核意见','Reviewer notes'),inner),ui.body(d.submission.reason,inner)]}),
          button('publish-reconcile',tr('核对原操作与审核状态','Check original operation and review status'),()=>publicationAction($,s,'reconcile')),
          d.state==='unknown'&&d.unknown_absent&&s.publicationRights&&button('publish-retry',tr('确认重试同一投稿','Retry the same submission'),()=>publicationAction($,s,'retrySubmit')),
          d.submission?.state==='pending'&&button('publish-withdraw',tr('撤回待审版本','Withdraw pending release'),()=>publicationAction($,s,'withdraw')),
          ['changes_requested','published','withdrawn'].includes(d.submission?.state)&&s.publishSource&&button('publish-revise',tr('使用所选包创建修订','Create revision from selected pack'),async()=>openDraft($,s,await publisherCall($,s,'create',{release_id:s.publishSource,revise_id:d.id}))),
        ]),
      ]),
    ]}),
  ]);
}
export function scenarioView($,s,k) {
  const {col,row,button,input,select,ui}=k,tr=(zh,en)=>L(s,zh,en),d=s.scenarioDraft,v=d.manifest;
  const save=async()=>{s.scenarioReviewed=false;s.scenarioDraft=await bridge($,s.context,'scenario',{method:'save',id:d.draft_id,version:d.version,manifest:v});};
  return col([
    ui.title(tr('组织表情包','Create an expression pack')),
    ui.caption(tr(`已选 ${v.expressions.length} 个表情。图片与固定语义保持原样；先确认本地包，再选择是否投稿。`,`${v.expressions.length} expressions selected. Images and meanings stay unchanged. Confirm your local pack before choosing to submit it.`)),
    input('scenario-name',tr('名称','Name'),v.name,x=>{v.name=x;s.scenarioReviewed=false;s.scenarioPreview=false;invalidate($);}),
    input('scenario-description',tr('介绍','Description'),v.description||'',x=>{v.description=x;s.scenarioReviewed=false;s.scenarioPreview=false;invalidate($);}),
    select('scenario-license',tr('包许可','Pack license'),v.rights.license,['仅供个人使用','CC0-1.0','CC-BY-4.0','CC-BY-SA-4.0'].map(x=>[x,x==='仅供个人使用'?tr(x,'Personal use only'):x]),x=>{v.rights.license=x;s.scenarioReviewed=false;s.scenarioPreview=false;invalidate($);}),
    input('scenario-creator',tr('署名','Attribution'),v.rights.creator||'',x=>{v.rights.creator=x;s.scenarioReviewed=false;s.scenarioPreview=false;invalidate($);}),
    row([button('scenario-save',tr('保存草稿','Save draft'),async()=>{await save();s.notice=tr('表情包草稿已保存。','Pack draft saved.');}),
      button('scenario-preview',tr('预览全部内容','Preview all content'),async()=>{await save();await bridge($,s.context,'scenario',{method:'preview',id:s.scenarioDraft.draft_id,version:s.scenarioDraft.version});s.scenarioPreview=true;s.publicationFields=null;s.publicationPage=0;await publicationPreview($,s);})]),
    s.scenarioPreview&&col([
      previewContent($,s,k,v),
      button('scenario-reviewed',(s.scenarioReviewed?'☑ ':'☐ ')+tr('已核对图片、语义和许可','I reviewed images, meanings and licenses'),async()=>{s.scenarioReviewed=!s.scenarioReviewed;}),
      s.scenarioReviewed&&button('scenario-confirm',tr('确认并准备分享','Confirm and prepare to share'),async()=>{
        if(!s.scenarioReviewed||!s.scenarioPreview)return;
        const pack=await bridge($,s.context,'scenario',{method:'confirm',id:s.scenarioDraft.draft_id,version:s.scenarioDraft.version,reviewed:true});
        s.scenarioDraft=null;await navigate($,s,'publish');s.publishSource=pack.release_id;
      },true),
    ]),
    button('scenario-close',tr('稍后继续','Continue later'),async()=>{s.scenarioDraft=null;await navigate($,s,'publish');}),
  ]);
}
