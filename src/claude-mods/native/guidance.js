import { bridge, L, refOf, errorText, local, view } from './transport.js';
import { state, send, invalidate, navigate } from './controller.js';
const same=(a,b)=>a.release_id===b.release_id&&a.effect_id===b.effect_id&&a.effect_revision_id===b.effect_revision_id;
const groupOf=e=>e.kind==='context'?e.conflict_group:e.template==='response-organization@1'?'response-organization':'completion-report';
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
    compiled={text:JSON.stringify({kind:'amoji.effects',amoji:'0.1',effects:[],applies_to:'No Amoji guidance applies to this message. This empty snapshot supersedes previous Amoji guidance.'})};
  }
  const result=await next({...e,context:[...(e.context||[]),compiled.text]});
  s.guidanceReceipt=result?.drop!==undefined?'rejected':result?.context?.includes(compiled.text)?'attached':'unknown';
  invalidate($);
  return result;
}
// Predefined effect templates in the words a person reads; never raw JSON.
export function effectText(s,a,original) {
  const tr=(zh,en)=>L(s,zh,en);
  if(a.kind==='context')return local(s,a.instruction,original);
  if(a.template==='completion-self-check@1')return tr('结束时说明已完成什么、验证依据和尚未知道的事项。','At completion, report what was done, the evidence and what remains unknown.');
  return ({
    'answer-first':tr('先给答案，再说明依据。','Answer first, then the evidence.'),
    concise:tr('简明回答，保留必要依据。','Be concise and keep the necessary evidence.'),
    'example-first':tr('先给例子，再解释。','Give an example before explaining.'),
  })[a.config?.layout]||local(s,a.summary,original);
}

export function guidanceView($,s,k) {
  const {col,row,button,Button,ui,inner}=k,tr=(zh,en)=>L(s,zh,en),choices=s.guidanceChoices||{rules:[],once:[]};
  const active=(s.activeGuidance||[]);
  const receipt=s.guidanceReceipt&&({attached:['success',tr('最近一条消息已附加提示','Guidance was attached to the latest message')],
    failed:['error',tr('最近一条消息未能附加提示','Guidance could not be attached to the latest message')],
    rejected:['error',tr('最近一条消息被拒绝','The latest message was rejected')],
    unknown:['warning',tr('未能核实最近一条消息是否附加了提示','Could not verify whether guidance was attached')]})[s.guidanceReceipt];
  return col([
    ui.caption(tr('提示是你给 AI 的文字建议，不授予工具权限，也不保证模型遵从。只对当前会话中之后的用户消息附加；重启或换会话需重新启用。','Guidance is your text suggestion to AI, not tool permission or guaranteed behavior. It accompanies subsequent user messages here. Re-enable after restarting or switching conversations.')),
    receipt&&ui.status(receipt[0],receipt[1]),
    row([
      ui.badge(active.length?'success':'info',active.length?tr(`已启用 ${active.length} / 2 条`,`${active.length} of 2 enabled`):tr('未启用持续提示','No rules enabled')),
      button('guidance-refresh',tr('刷新','Refresh'),()=>loadGuidance($,s,s.guidanceExpression)),
      s.guidanceTouched&&active.length>0&&button('guidance-clear',tr('全部停用','Disable all'),async()=>{s.activeGuidance=[];s.guidanceTouched=true;s.guidanceReceipt=null;}),
    ]),
    choices.rules.length>0&&ui.section(tr(`对话规则 · ${choices.rules.length}`,`CONVERSATION RULES · ${choices.rules.length}`)),
    ...choices.rules.map(c=>{
      const on=active.some(r=>same(r,c.selection));
      const conflict=choices.rules.find(other=>active.some(r=>same(r,other.selection))&&groupOf(other.effect)===groupOf(c.effect)&&!same(other.selection,c.selection));
      return ui.card({key:'guidance-card:'+c.selection.effect_revision_id,selected:on,gap:0,children:[
        row([ui.label(local(s,c.effect.title,c.source.original_locale)),on&&ui.badge('success',tr('✓ 已启用','✓ On'))]),
        ui.body(effectText(s,c.effect,c.source.original_locale),inner),
        ui.meta([tr('来自 ','From ')+c.source.origin,'v'+c.source.version],inner),
        conflict&&ui.tone('warning',tr('启用后将替换：','Enabling replaces: ')+local(s,conflict.effect.title,conflict.source.original_locale),inner),
        button('guidance-enable:'+c.selection.effect_revision_id,tr(on?'停用':conflict?'替换并启用':'启用',on?'Disable':conflict?'Replace and enable':'Enable'),async()=>{
          const keep=active.filter(r=>!same(r,c.selection)&&(!conflict||!same(r,conflict.selection)));
          if(!on&&keep.length>=2)throw new Error('EFFECT_LIMIT');
          s.activeGuidance=on?keep:[...keep,c.selection];s.guidanceTouched=true;s.guidanceReceipt=null;
        },!on),
      ]});
    }),
    !choices.rules.length&&ui.card({children:[
      ui.label(tr('还没有可用的对话规则','No conversation rules yet'),inner),
      ui.caption(tr('从表情市场安装带协作提示的表情包后，就能在这里启用。','Install a pack with guidance from the market to enable it here.'),inner),
      button('guidance-market',tr('去表情市场','Open the market'),()=>navigate($,s,'market')),
    ]}),
    s.guidanceExpression&&choices.once.length>0&&ui.heading(tr('随「','Send “')+view(s,s.guidanceExpression).name+tr('」一起发送','” with guidance')),
    ...choices.once.map(c=>ui.card({key:'guidance-once-card:'+c.selection.effect_revision_id,gap:0,children:[
      ui.label(local(s,c.effect.title,c.source.original_locale),inner),
      ui.body(effectText(s,c.effect,c.source.original_locale),inner),
      ui.meta([tr('仅本次表达','This expression only'),c.source.origin],inner),
      Button({key:'guidance-once:'+c.selection.effect_revision_id,label:tr('附带这条提示发送','Send with this guidance'),variant:'primary',onPress:()=>send($,s,s.guidanceExpression,undefined,c.selection)}),
    ]})),
  ]);
}
