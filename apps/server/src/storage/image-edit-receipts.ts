import {createHash} from 'node:crypto';
import type {JsonStatePort} from '@ks-designai/app-cloud-state';
import {CanvasStateError} from '../canvas/errors.js';
/** Completed edit receipts are archived before their canvas entries are pruned.
 * Automatic saving must not exhaust the generation receipt capacity. */
export class ImageEditReceipts {
 constructor(private readonly state:JsonStatePort){}
 private slot(projectId:string,key:string){return 'image-edit-receipt-'+createHash('sha256').update(JSON.stringify([projectId,key])).digest('hex');}
 async read(projectId:string,key:string):Promise<unknown>{
  await this.state.ready;const value=this.state.read(this.slot(projectId,key));if(value===undefined)return undefined;
  const record=value as {projectId?:unknown;key?:unknown;receipt?:Record<string,unknown>};
  if(!record||record.projectId!==projectId||record.key!==key||record.receipt?.actionId!=='image.edit.save'||record.receipt.status!=='succeeded'||typeof record.receipt.digest!=='string'||!/^[a-f0-9]{64}$/.test(record.receipt.digest))throw new CanvasStateError(503,'IMAGE_EDIT_RECEIPT_CORRUPT','工程操作回执损坏');
  return record.receipt;
 }
 async write(projectId:string,key:string,receipt:unknown){
  const existing=await this.read(projectId,key);
  if(existing!==undefined){if(JSON.stringify(existing)!==JSON.stringify(receipt))throw new CanvasStateError(409,'IMAGE_EDIT_RECEIPT_CONFLICT','工程回执不可覆盖');return;}
  this.state.write(this.slot(projectId,key),{projectId,key,receipt});await this.state.flush();
 }
}
