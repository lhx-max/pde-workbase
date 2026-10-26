import {it,expect} from 'vitest';import {ImageEditReceipts} from '../src/storage/image-edit-receipts.js';
import type {JsonStatePort} from '@ks-designai/app-cloud-state';
it('archives completed edit receipts immutably and survives a fresh projection',async()=>{
 const values=new Map<string,unknown>();const state:JsonStatePort={ready:Promise.resolve(),read:key=>structuredClone(values.get(key)),write:(key,value)=>{values.set(key,structuredClone(value));},flush:async()=>{}};
 const archive=new ImageEditReceipts(state),receipt={actionId:'image.edit.save',status:'succeeded',digest:'a'.repeat(64),receiptId:'one',callerScope:'caller'};
 await archive.write('project','one',receipt);expect(await new ImageEditReceipts(state).read('project','one')).toEqual(receipt);
 expect(await archive.read('foreign','one')).toBeUndefined();await expect(archive.write('project','one',{...receipt,digest:'b'.repeat(64)})).rejects.toMatchObject({status:409});
});
