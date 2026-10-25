import { bridge, L, refOf, errorText, local } from './transport.js';
import { state, invalidate } from './controller.js';
/** The effect bound to this expression, or null. One at most, and it always goes with it (RFC §7). */
export async function effectFor($,s,expression) {
  try { return (await bridge($,s.context,'guidance',{method:'choices',ref:refOf(expression)})).once[0]||null; }
  catch(error) { if(/CAPABILITY_UNAVAILABLE/.test(String(error?.code||error?.message)))return null; throw error; }
}
export const effectTitle=(s,choice)=>local(s,choice.effect.title,choice.source.original_locale);
// Only Amoji's own in-flight send carries an effect; typed messages never do.
export async function applyGuidance($,e,next) {
  const origin=e.origin;
  const s=await state($);
  const delivery=s.delivery;
  const own=origin?.kind==='plugin'&&origin.name==='amoji'&&origin.asUser===true&&delivery?.text===e.text&&delivery.phase==='submitting'&&!delivery.guidanceClaimed;
  if(!own||!delivery.guidance)return next(e);
  delivery.guidanceClaimed=true;
  let compiled;
  try { compiled=await bridge($,s.context,'guidance',{method:'compile',once:delivery.guidance}); }
  catch(error) {
    delivery.effectStatus='failed';s.error=errorText(s,error);invalidate($);
    // The effect is part of the expression: never let it silently become a plain send.
    return {drop:s.error};
  }
  const result=await next({...e,context:[...(e.context||[]),compiled.text]});
  delivery.effectStatus=result?.drop!==undefined?'rejected':result?.context?.includes(compiled.text)?'attached':'unknown';
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

