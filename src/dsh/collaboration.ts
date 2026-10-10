import type { ActionChoice } from '../collaboration.js';
import type { ExpressionRef } from '../sample-catalog.js';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { AdapterRuntime } from '../adapter-runtime.js';
import type { SampleMessage } from '../sample-runtime.js';
import { fail } from '../shared-contract.js';
import { collaborationEnvelope, CollaborationContext, type CollaborationReceipt } from './collaboration-context.js';
/** Bridges durable human choices to the registered native Agent. No model calls. */
export class DshCollaboration {
  private readonly releases:Array<()=>unknown>=[];
  private pending:Promise<unknown>=Promise.resolve();
  readonly context: CollaborationContext;
  constructor(private readonly ctx: Context, private readonly runtime: AdapterRuntime, private readonly profile: string) { this.context=new CollaborationContext(ctx,profile);
    // Persist terminal cancellation independently of a browser polling history.
    this.releases.push(ctx.on('agent/inbox/discarded', ({agent,message})=>{
      if(message.source.kind!=='user' || !('rpcId' in message.source))return;
      const rpcId=String(message.source.rpcId);
      this.pending=this.pending.then(async()=>{
        const rows=await runtime.messages(this.binding(agent.id));
        const row=rows.find(m=>`amoji:${m.message_id}`===rpcId && m.action_intent);
        if(row)await this.receipt(agent.id,row);
      }).catch(()=>{}); // Native logs remain the recovery authority if persistence fails.
    }));
  }
  private agent(sessionId:string):Agent { const agent=this.ctx.agents.get(SessionId(sessionId));if(!agent || this.ctx.sessions.get(SessionId(sessionId))!==agent.session)fail('DSH_CONTEXT_UNAVAILABLE','缺少当前原生会话');return agent; }
  private binding(sessionId:string){return{host:'dsh' as const,hostInstanceId:this.profile,sessionId};}
  private instruction(intent:ActionChoice,ref:ExpressionRef){return {id:intent.action.action_id,revision:intent.action.action_revision_id,instruction:intent.action.instruction,conflictGroup:intent.action.conflict_group,source:intent.source,expression:{asset_id:ref.asset_id,revision_id:ref.revision_id}};}
  validate(sessionId:string,choice:ActionChoice,ref:ExpressionRef):void{
    this.agent(sessionId);
    try{collaborationEnvelope(this.profile,sessionId,Number.MAX_SAFE_INTEGER,[],this.instruction(choice,ref));}
    catch{fail('ACTION_LIMIT','完整动作上下文超过 8 KiB，可明确选择仅发送');}
  }
  async prepare(sessionId:string,message:SampleMessage):Promise<void>{
    const intent=message.action_intent;if(!intent)return;
    const agent=this.agent(sessionId);this.context.authorize(agent);
    this.context.prepare(agent,`amoji:${message.message_id}`,this.instruction(intent,message.revision));
    try {await this.runtime.collaboration!.save(this.binding(sessionId),message.message_id,{status:'prepared',checkpoint:this.context.checkpoint(agent)});}
    catch(error){this.context.uncertain(agent,`amoji:${message.message_id}`);throw error;}
  }
  dispatched(sessionId:string,message:SampleMessage){this.context.dispatched(this.agent(sessionId),`amoji:${message.message_id}`);}
  uncertain(sessionId:string,message:SampleMessage){this.context.uncertain(this.agent(sessionId),`amoji:${message.message_id}`);}
  async receipt(sessionId:string,message:SampleMessage):Promise<CollaborationReceipt|undefined>{
    const intent=message.action_intent;if(!intent)return;
    const agent=this.agent(sessionId);const rpcId=`amoji:${message.message_id}`;
    if(intent.status==='cancelled' || intent.status==='failed')return intent.receipt??{status:intent.status};
    if(!this.context.has(agent,rpcId)){
      if(!intent.checkpoint || !this.context.restore(agent,intent.checkpoint))return {status:'unknown',reason:'identity-not-restored'};
    }
    const receipt=this.context.receipt(agent,rpcId);
    await this.runtime.collaboration!.save(this.binding(sessionId),message.message_id,{status:receipt.status==='unsupported'?'failed':receipt.status,receipt,checkpoint:this.context.checkpoint(agent)});
    return receipt;
  }
  dispose(){for(const release of this.releases)release();this.context.dispose();}
}
