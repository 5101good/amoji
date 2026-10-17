import type { ActionDefinition, ActionRef } from './actions.js';
import type { CollaborationCheckpoint, CollaborationReceipt } from './dsh/collaboration-context.js';
import { nonempty, object } from './shared-contract.js';
export interface ActionSelection extends ActionRef { release_id: string }
export interface ActionChoice { selection: ActionSelection; action: Extract<ActionDefinition,{kind:'instruction'}>; source: { pack_id: string; release_id: string; version: number; origin: string } }
export interface ActionIntent extends ActionChoice { operation_id: string; requestId: string; status: 'prepared' | 'dispatched' | 'bound' | 'attached' | 'failed' | 'cancelled' | 'unknown'; checkpoint?: CollaborationCheckpoint; receipt?: CollaborationReceipt }
export function actionSelection(value: unknown): ActionSelection {
 const a=object(value,['release_id','action_id','action_revision_id']);
 return {release_id:nonempty(a.release_id),action_id:nonempty(a.action_id),action_revision_id:nonempty(a.action_revision_id)};
}
