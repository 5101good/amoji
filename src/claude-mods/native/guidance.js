import { bridge, L, refOf, errorText } from './transport.js';
import { state, send, invalidate } from './controller.js';
const same=(a,b)=>a.release_id===b.release_id&&a.action_id===b.action_id&&a.action_revision_id===b.action_revision_id;
export async function loadGuidance($,s,expression) {
  s.guidanceExpression=expression||null;
  s.guidanceChoices=await bridge($,s.context,'guidance',{method:'choices',...(expression?{ref:refOf(expression)}:{})});
  s.activeGuidance=(s.activeGuidance||[]).filter(r=>s.guidanceChoices.rules.some(c=>same(c.selection,r)));
}
export async function applyGuidance($,e,next) {
  const origin=e.origin;
  const s=await state($);
  const delivery=s.delivery;
  const own=origin?.kind==='plugin'&&origin.name==='amoji'&&origin.asUser===true&&delivery?.text===e.text&&delivery.phase==='submitting'&&!delivery.guidanceClaimed;
  if(!own&&!['composer','bridge'].includes(origin?.kind))return next(e);
  if(!s.guidanceTouched&&!own)return next(e);
  if(own)delivery.guidanceClaimed=true;
  const once=own?delivery.guidance:undefined;
  if(!s.guidanceTouched&&!once)return next(e);
  s.guidanceTouched=true;
  let compiled;
  try {
    compiled=await bridge($,s.context,'guidance',{method:'compile',rules:s.activeGuidance||[],...(once?{once}:{})});
    s.activeGuidance=compiled.rules;
    if(compiled.removed)s.notice=L(s,'部分提示的来源已不可用，已停用。','Some guidance sources became unavailable and were disabled.');
  } catch(error) {
    s.guidanceReceipt='failed';s.error=errorText(s,error);invalidate($);
    // An explicitly chosen instruction must not silently turn into a plain send.
    if(once)return {drop:s.error};
    s.activeGuidance=[];
    compiled={text:JSON.stringify({kind:'amoji.collaboration',version:1,actions:[],applies_to:'No Amoji guidance applies to this message. This empty snapshot supersedes previous Amoji guidance.'})};
  }
  const result=await next({...e,context:[...(e.context||[]),compiled.text]});
  s.guidanceReceipt=result?.drop!==undefined?'rejected':result?.context?.includes(compiled.text)?'attached':'unknown';
  invalidate($);
  return result;
}
export function guidanceView($,s,k) {
  const {col,row,t,heading,button,Button}=k,tr=(zh,en)=>L(s,zh,en),choices=s.guidanceChoices||{rules:[],once:[]};
  return col([
    heading(tr('让协作更合拍','Make collaboration feel right')),
    t(tr('提示是你给 AI 的文字建议，不授予工具权限，也不保证模型遵从。只对当前会话中之后的用户消息附加；重启或换会话需重新启用。','Guidance is your text suggestion to AI, not tool permission or guaranteed behavior. It accompanies subsequent user messages here. Re-enable after restarting or switching conversations.'),true),
    button('guidance-refresh',tr('刷新可用提示','Refresh available guidance'),()=>loadGuidance($,s,s.guidanceExpression)),
    s.guidanceTouched&&button('guidance-clear',tr('停用全部提示','Disable all guidance'),async()=>{s.activeGuidance=[];s.guidanceTouched=true;s.guidanceReceipt=null;}),
    s.guidanceReceipt&&t(tr('最近一次附加状态：','Last attachment status: ')+tr(({attached:'已附加',failed:'未能附加',rejected:'消息被拒绝',unknown:'未能核实'})[s.guidanceReceipt]||s.guidanceReceipt,s.guidanceReceipt),true),
    ...choices.rules.map(c=>{
      const active=(s.activeGuidance||[]).some(r=>same(r,c.selection));
      const conflict=choices.rules.find(other=>(s.activeGuidance||[]).some(r=>same(r,other.selection))&&other.action.conflict_group===c.action.conflict_group&&!same(other.selection,c.selection));
      return col([heading(c.action.effect_summary),t(tr('当前会话 · ','Current conversation · ')+c.source.origin+' · v'+c.source.version,true),
        t(JSON.stringify({template:c.action.template,config:c.action.config})),
        t(tr('来源版本：','Source release: ')+c.source.release_id,true),
        conflict&&t(tr('将替换：','Will replace: ')+conflict.action.effect_summary),
        button('guidance-enable:'+c.selection.action_revision_id,tr(active?'停用这条提示':conflict?'确认替换并启用':'启用这条提示',active?'Disable this guidance':conflict?'Replace and enable':'Enable this guidance'),async()=>{
          const keep=(s.activeGuidance||[]).filter(r=>!same(r,c.selection)&&(!conflict||!same(r,conflict.selection)));
          if(!active&&keep.length>=2)throw new Error('ACTION_LIMIT');
          s.activeGuidance=active?keep:[...keep,c.selection];s.guidanceTouched=true;s.guidanceReceipt=null;
        },!active),
      ]);
    }),
    !choices.rules.length&&t(tr('尚无可用的持续提示。可从市场安装带协作提示的表情包。','No conversation guidance is available. Install a pack with guidance from the market.')),
    s.guidanceExpression&&choices.once.length>0&&heading(tr('为这张表情选择提示：','Choose guidance for: ')+s.guidanceExpression.name),
    ...choices.once.map(c=>col([
      heading(c.action.effect_summary),t(tr('仅本次表达 · ','This expression only · ')+c.source.origin,true),t(c.action.instruction),
      Button({key:'guidance-once:'+c.selection.action_revision_id,label:tr('附带这条提示发送','Send with this guidance'),onPress:()=>send($,s,s.guidanceExpression,undefined,c.selection)}),
    ])),
  ]);
}
