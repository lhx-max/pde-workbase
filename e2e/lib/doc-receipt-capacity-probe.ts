/** Public HTTP receipt capacity proof; no implementation/storage imports. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

interface Reply {status:number;data:any;bytes:Uint8Array}
interface Options {method?:string;body?:unknown;key?:string;sso?:string;instance?:string}
export async function probeDocReceiptCapacity(request:(app:'doc',route:string,options?:Options)=>Promise<Reply>){
 const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
 // One receipt exceeds the shared state port's 1 MiB bound; separate keys
 // also push the aggregate beyond it. The document remains within 20 MiB.
 const content='Receipt capacity 中文\n'+'a'.repeat(1_200_000),contentSha256=hash(content);
 const created=await request('doc','/api/apps/doc/actions/doc.create',{body:{input:{name:'Receipt capacity acceptance',content}},key:'capacity-create'});
 assert.equal(created.status,200,'capacity document create: '+created.status);
 const id=created.data.data.result.instanceId as string;assert(id);
 const route=`/api/apps/doc/instances/${id}/actions/doc.read`;
 const receipts:Array<{key:string;bytes:number}>=[];
 for(let index=0;index<3;index++){
  const key='capacity-read-'+index;
  const read=await request('doc',route,{body:{input:{}},key});
  assert.equal(read.status,200,'large durable read: '+read.status);
  assert.equal(hash(read.data.data.result.content),contentSha256);
  assert.equal(read.data.data.replayed,false);
  receipts.push({key,bytes:read.bytes.length});
 }
 assert(receipts.every(r=>r.bytes>1024*1024));
 const evidence={id,contentBytes:Buffer.byteLength(content),contentSha256,receiptCount:receipts.length,aggregateResponseBytes:receipts.reduce((n,r)=>n+r.bytes,0),receipts,restartVerified:false,foreignReceiptRejected:false};
 return {evidence,async postRestart(){
  for(const {key} of receipts){
   const replay=await request('doc',route,{body:{input:{}},key});assert.equal(replay.status,200);
   assert.equal(replay.data.data.replayed,true);assert.equal(hash(replay.data.data.result.content),contentSha256);
   const lookup=await request('doc',`/api/apps/doc/instances/${id}/action-receipts/${key}`);
   assert.equal(lookup.status,200);assert.equal(hash(lookup.data.data.receipt.result.content),contentSha256);
  }
  const foreign=await request('doc',`/api/apps/doc/instances/${id}/action-receipts/${receipts[0]!.key}`,{instance:'mai-doc-alt'});
  assert([403,404].includes(foreign.status));
  evidence.foreignReceiptRejected=true;evidence.restartVerified=true;
 }};
}
