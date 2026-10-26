import { describe,it,expect } from 'vitest';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CanvasStateService} from '../src/canvas/state.js';
import {CardRegistryStore} from '../src/storage/card-registry.js';
import {AppwriteClient} from '../src/storage/appwrite-client.js';

describe('team card policy',()=>{
 it('blocks native-card creation and legacy batch bypass while retaining unchanged old cards',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'canvas-kind-policy-'));
  let allowed:string[]=['text','image'];
  const service=new CanvasStateService(()=>root,undefined,undefined,{cardEntitlement:async()=>allowed});
  await service.applyOperations('canvas',{operationId:'initial',baseRevision:0,operations:[{type:'node.create',node:{id:'image',kind:'text',x:0,y:0}}]});
  allowed=['image'];
  const before=await service.read('canvas');
  await expect(service.applyOperations('canvas',{operationId:'denied',baseRevision:before.revision,operations:[{type:'node.create',node:{id:'blocked',kind:'text',x:1,y:1}}]})).rejects.toMatchObject({status:403,code:'CARD_KIND_NOT_ALLOWED'});
  await expect(service.patch('canvas',{workbenchBasicNodes:[{id:'smuggled',kind:'text',x:1,y:1}]},{expectedRevision:before.revision})).rejects.toMatchObject({status:403});
  await service.patch('canvas',{workbenchViewport:{x:1,y:1,zoom:1}},{expectedRevision:before.revision});
  expect((await service.read('canvas')).state.workbenchBasicNodes).toEqual(before.state.workbenchBasicNodes);
 });
 it('never converts permission storage outages into an absent grant',async()=>{
  const client={docsPath:()=>'/grants',getOrNull:async()=>{throw Error('offline')}} as unknown as AppwriteClient;
  await expect(new CardRegistryStore(client,'db').resolveAllowedKinds({projectId:'c',teamId:'team-a'})).rejects.toThrow('offline');
 });
 it('uses team grants when no canvas-specific grant exists',async()=>{
  const requests:string[]=[];
  const client={docsPath:()=>'/grants',getOrNull:async(p:string)=>{requests.push(p);return p.endsWith('team_team-a')?{scope:'team:team-a',allowedKinds:'["text"]',source:'ma'}:null;}} as unknown as AppwriteClient;
  expect(await new CardRegistryStore(client,'db').resolveAllowedKinds({projectId:'c',teamId:'team-a'})).toEqual(['text']);
  expect(requests.filter(p=>!p.includes('/scope-'))).toEqual(['/grants/project_c','/grants/team_team-a']);
  expect(requests.every(p=>p.split('/').at(-1)!.length<=36)).toBe(true);
 });
});
