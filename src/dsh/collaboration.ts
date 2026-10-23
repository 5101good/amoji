import { compiledRule, type RuleView, type RuleChange } from '../conversation-rules.js';
import { effectConflictGroup, effectGuidance, type EffectChoice } from '../effects.js';
import type { ExpressionRef } from '../protocol/index.js';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { AdapterRuntime } from '../adapter-runtime.js';
import type { StoredMessage } from '../messages.js';
import { fail } from '../shared-contract.js';
import { collaborationEnvelope, CollaborationContext, type CollaborationReceipt } from './collaboration-context.js';
/** Bridges durable human choices to the registered native Agent. No model calls. */
export class DshCollaboration {
  private readonly releases:Array<()=>unknown>=[];
  private pending:Promise<unknown>=Promise.resolve();
  readonly context: CollaborationContext;
  constructor(private readonly ctx: Context, private readonly runtime: AdapterRuntime, private readonly profile: string) { this.context=new CollaborationContext(ctx,profile,agent=>this.load(agent));
    this.releases.push(ctx.on('agent/session-start',({agent,source})=>{if(source==='clear'){this.invalidated.add(agent);}}));
    // Persist terminal cancellation independently of a browser polling history.
    this.releases.push(ctx.on('agent/inbox/discarded', ({agent,message})=>{
      if(message.source.kind!=='user' || !('rpcId' in message.source))return;
      const rpcId=String(message.source.rpcId);
      this.pending=this.pending.then(async()=>{
        const rows=await runtime.messages(this.binding(agent.id));
        const row=rows.find(m=>`amoji:${m.message_id}`===rpcId && m.effect_intent);
        if(row)await this.receipt(agent.id,row);
      }).catch(()=>{}); // Native logs remain the recovery authority if persistence fails.
    }));
  }
  private readonly invalidated=new WeakSet<Agent>();
  private async load(agent:Agent):Promise<void>{
    if(!this.runtime.rules)return;
    const messages=await this.runtime.messages(this.binding(agent.id));
    for(const message of messages)if(message.effect_intent?.receipt?.reason==='safety_removed')this.context.revoke(agent,`amoji:${message.message_id}`);
    const snapshot=await this.runtime.rules.read(this.binding(agent.id));
    if(!snapshot.checkpoint || this.invalidated.has(agent) || !this.context.matchesIdentity(agent,snapshot.checkpoint))return;
    this.context.authorize(agent);
    this.context.setRules(agent,snapshot.rules.filter(r=>r.enabled).map(r=>({...compiledRule(r),generation:r.generation})));
  }
  async rules(sessionId:string):Promise<RuleView>{
    if(!this.runtime.rules)fail('CAPABILITY_UNAVAILABLE','当前宿主不支持会话规则');
    const agent=this.agent(sessionId);await this.load(agent);
    const snapshot=await this.runtime.rules.read(this.binding(sessionId));
    const ready=!snapshot.checkpoint || (!this.invalidated.has(agent)&&this.context.matchesIdentity(agent,snapshot.checkpoint));
    return {...snapshot,identity:ready?'ready':'pending',choices:await this.runtime.rules.choices(this.binding(sessionId)),rules:snapshot.rules.map(r=>({...r,...(!r.enabled?{status:'disabled' as const}:!ready?{status:'unsupported' as const,reason:'identity-not-restored'}:this.context.ruleStatus(agent,{...compiledRule(r),generation:r.generation}))}))};
  }
  async change(sessionId:string,change:Omit<RuleChange,'checkpoint'>):Promise<RuleView>{
    if(!this.runtime.rules)fail('CAPABILITY_UNAVAILABLE','当前宿主不支持会话规则');
    const agent=this.agent(sessionId);this.context.authorize(agent);
    const snapshot=await this.runtime.rules.read(this.binding(sessionId));
    if(change.kind!=='disableAll' && snapshot.checkpoint && (this.invalidated.has(agent)||!this.context.matchesIdentity(agent,snapshot.checkpoint)) && snapshot.rules.some(r=>r.enabled))fail('RULE_IDENTITY','身份待恢复；请先全部停用，再显式启用');
    await this.runtime.rules.change(this.binding(sessionId),{...change,checkpoint:this.context.checkpoint(agent)});
    this.invalidated.delete(agent);await this.load(agent);return this.rules(sessionId);
  }
  private agent(sessionId:string):Agent { const agent=this.ctx.agents.get(SessionId(sessionId));if(!agent || this.ctx.sessions.get(SessionId(sessionId))!==agent.session)fail('DSH_CONTEXT_UNAVAILABLE','缺少当前原生会话');return agent; }
  private binding(sessionId:string){return{host:'dsh' as const,hostInstanceId:this.profile,sessionId};}
  private instruction(intent:EffectChoice,ref:ExpressionRef){return {id:intent.effect.effect_id,revision:intent.effect.effect_revision_id,instruction:effectGuidance(intent.effect,undefined,intent.source.original_locale),conflictGroup:effectConflictGroup(intent.effect) as import('./collaboration-context.js').CollaborationInstruction['conflictGroup'],source:intent.source,expression:{asset_id:ref.asset_id,revision_id:ref.revision_id}};}
  validate(sessionId:string,choice:EffectChoice,ref:ExpressionRef):void{
    this.context.authorize(this.agent(sessionId));
    try{collaborationEnvelope(this.profile,sessionId,Number.MAX_SAFE_INTEGER,this.context.checkpoint(this.agent(sessionId)).rules,this.instruction(choice,ref));}
    catch{fail('ACTION_LIMIT','完整动作上下文超过 8 KiB，可明确选择仅发送');}
  }
  async prepare(sessionId:string,message:StoredMessage):Promise<void>{
    const intent=message.effect_intent;if(!intent)return;
    const agent=this.agent(sessionId);this.context.authorize(agent);
    this.context.prepare(agent,`amoji:${message.message_id}`,this.instruction(intent,message.revision!));
    try {await this.runtime.collaboration!.save(this.binding(sessionId),message.message_id,{status:'prepared',checkpoint:this.context.checkpoint(agent)});}
    catch(error){this.context.uncertain(agent,`amoji:${message.message_id}`);throw error;}
  }
  dispatched(sessionId:string,message:StoredMessage){this.context.dispatched(this.agent(sessionId),`amoji:${message.message_id}`);}
  uncertain(sessionId:string,message:StoredMessage){this.context.uncertain(this.agent(sessionId),`amoji:${message.message_id}`);}
  async receipt(sessionId:string,message:StoredMessage):Promise<CollaborationReceipt|undefined>{
    const intent=message.effect_intent;if(!intent)return;
    const agent=this.agent(sessionId);const rpcId=`amoji:${message.message_id}`;
    if(intent.status==='cancelled' || intent.status==='failed')return intent.receipt??{status:intent.status};
    if(!this.context.has(agent,rpcId)){
      if(!intent.checkpoint || !this.context.restore(agent,intent.checkpoint,false))return {status:'unknown',reason:'identity-not-restored'};
    }
    const receipt=this.context.receipt(agent,rpcId);
    await this.runtime.collaboration!.save(this.binding(sessionId),message.message_id,{status:receipt.status==='unsupported'?'failed':receipt.status,receipt,checkpoint:this.context.checkpoint(agent)});
    return receipt;
  }
  dispose(){for(const release of this.releases)release();this.context.dispose();}
}
