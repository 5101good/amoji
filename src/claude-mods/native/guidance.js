import { bridge, L, refOf, errorText, local, view } from './transport.js';
import { state, send, invalidate, navigate } from './controller.js';
const same=(a,b)=>a.release_id===b.release_id&&a.effect_id===b.effect_id&&a.effect_revision_id===b.effect_revision_id;
// One effect revision can ship in several releases (the same effect in two packs): a row's identity is the whole selection.
const idOf=c=>c.selection.release_id+':'+c.selection.effect_revision_id;
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
    if(compiled.removed)s.notice=L(s,'部分表情效果的来源已不可用，已自动停用。','Some expression effects lost their source and were turned off.');
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

const LIMIT=2;
// Expression effects: one page in every host. What it is, an example, the
// conversation-wide switches, then how the one-message use works.
export function guidanceView($,s,k) {
  const {col,row,button,Button,ui,inner}=k,tr=(zh,en)=>L(s,zh,en),choices=s.guidanceChoices||{rules:[],once:[]};
  const active=(s.activeGuidance||[]);
  const title=c=>local(s,c.effect.title,c.source.original_locale);
  const isOn=c=>active.some(r=>same(r,c.selection));
  const rules=[...choices.rules].sort((a,b)=>Number(isOn(b))-Number(isOn(a)));
  const example=rules[0];
  const receipt=s.guidanceReceipt&&({attached:['success',tr('已附在最近一条消息上','Went with your latest message')],
    failed:['error',tr('最近一条消息没能附上效果','The effect could not go with your latest message')],
    rejected:['error',tr('最近一条消息被拒绝了','Your latest message was rejected')],
    unknown:['warning',tr('还不确定最近一条消息是否附上了效果','Not sure whether the effect went with your latest message')]})[s.guidanceReceipt];
  return col([
    ui.body(tr('表情效果是表情包附带的一句给 AI 的要求，用来改变它的回答方式。','An expression effect is a short request to the AI that comes with an expression pack and changes how it answers.')),
    example&&ui.card({gap:0,children:[ui.caption(tr(`例如启用「${title(example)}」后，AI 会：`,`For example, with “${title(example)}” on, the AI will:`),inner),ui.body(effectText(s,example.effect,example.source.original_locale),inner)]}),
    receipt&&ui.status(receipt[0],receipt[1]),
    ui.row([ui.section(tr('对话中持续','FOR THIS CONVERSATION')),ui.badge(active.length?'success':'info',tr(`已启用 ${active.length} / ${LIMIT}`,`${active.length} OF ${LIMIT} ON`))]),
    ui.caption(tr('启用后，你在这个对话里发的每条消息都会附上它。最多同时启用 2 个；同一类只能启用 1 个，启用新的会替换旧的。','Once on, it goes with every message you send in this conversation. Up to 2 can be on, and only 1 of each kind: turning on another of the same kind replaces it.')),
    ...rules.map(c=>{
      const on=isOn(c);
      const replaced=!on&&rules.find(other=>isOn(other)&&groupOf(other.effect)===groupOf(c.effect)&&!same(other.selection,c.selection));
      const full=!on&&!replaced&&active.length>=LIMIT;
      return ui.card({key:'guidance-card:'+idOf(c),selected:on,gap:0,children:[
        ui.row([ui.label(title(c)),on&&ui.badge('success',tr('已启用','ON'))]),
        ui.body(effectText(s,c.effect,c.source.original_locale),inner),
        replaced&&ui.caption(tr(`会替换已启用的「${title(replaced)}」`,`Replaces “${title(replaced)}”, which is on`),inner),
        full&&ui.caption(tr('已启用 2 个，先停用一个','2 are on; turn one off first'),inner),
        !full&&button('guidance-enable:'+idOf(c),tr(on?'停用':'启用',on?'Turn off':'Turn on'),async()=>{
          const keep=active.filter(r=>!same(r,c.selection)&&(!replaced||!same(r,replaced.selection)));
          if(!on&&keep.length>=LIMIT)throw new Error('EFFECT_LIMIT');
          s.activeGuidance=on?keep:[...keep,c.selection];s.guidanceTouched=true;s.guidanceReceipt=null;
        }),
      ]});
    }),
    !rules.length&&ui.card({children:[
      ui.label(tr('已安装的表情包里还没有表情效果','No installed pack has expression effects yet'),inner),
      ui.caption(tr('可以在表情市场找带效果的表情包。','Find packs with effects in the market.'),inner),
      button('guidance-market',tr('去表情市场','Open the market'),()=>navigate($,s,'market')),
    ]}),
    s.guidanceTouched&&active.length>0&&row([button('guidance-clear',tr('全部停用','Turn all off'),async()=>{s.activeGuidance=[];s.guidanceTouched=true;s.guidanceReceipt=null;})]),
    ui.section(tr('仅本次','THIS MESSAGE ONLY')),
    s.guidanceExpression&&choices.once.length>0
      ?col([ui.caption(tr(`随「${view(s,s.guidanceExpression).name}」发送，只对 AI 的下一次回答生效：`,`Send with “${view(s,s.guidanceExpression).name}”; affects only the AI’s next answer:`),inner),
        ...choices.once.map(c=>ui.card({key:'guidance-once-card:'+idOf(c),gap:0,children:[
          ui.label(title(c),inner),
          ui.body(effectText(s,c.effect,c.source.original_locale),inner),
          Button({key:'guidance-once:'+idOf(c),label:tr('带效果发送','Send with effect'),variant:'primary',onPress:()=>send($,s,s.guidanceExpression,undefined,c.selection)}),
        ]}))])
      :ui.caption(tr('只跟随一条表情消息，对 AI 的下一次回答生效。在表情详情里点「带效果发送」。','Goes with one expression message and affects the AI’s next answer. In an expression’s details, choose “Send with effect”.'),inner),
    ui.caption(tr('表情效果只是给 AI 的建议：不会给它任何额外权限，也不保证每次都照做。停用后从下一条消息起不再附上，已发出的消息不受影响。换对话或重启后需要重新启用。','Expression effects are suggestions to the AI: they grant no permissions and are not always followed. Turning one off stops it from your next message; sent messages are unchanged. Turn effects on again after switching conversations or restarting.'),inner),
    button('guidance-refresh',tr('刷新状态','Refresh status'),()=>loadGuidance($,s,s.guidanceExpression)),
  ]);
}
