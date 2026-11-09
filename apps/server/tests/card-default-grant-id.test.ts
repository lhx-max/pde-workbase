import { describe, it, expect } from 'vitest';
import { CardRegistryStore } from '../src/storage/card-registry.js';
import type { AppwriteClient } from '../src/storage/appwrite-client.js';
describe('Appwrite default card grant ID', () => {
 it('uses a valid Appwrite ID for wildcard and still validates the scope attribute',async()=>{
  const paths:string[]=[];
  const client={docsPath:()=>'/db/card_grants/documents',getOrNull:async(p:string)=>{paths.push(p);return p.endsWith('/default')?{scope:'*',allowedKinds:'["image"]',source:'local'}:null;}} as unknown as AppwriteClient;
  expect(await new CardRegistryStore(client,'db').resolveAllowedKinds({projectId:'proof',teamId:'local'})).toEqual(['image']);
  expect(paths.at(-1)).toBe('/db/card_grants/documents/default');
 });
});

it('hashes long project/team scopes into valid collision-resistant document IDs and reads legacy short grants', async()=>{
 const paths:string[]=[];
 const client={docsPath:()=>'/db/card_grants/documents',getOrNull:async(p:string)=>{paths.push(p);const id=p.split('/').pop()!;if(id.length>36)throw Error('Appwrite 400');return id==='team_old'?{scope:'team:old',allowedKinds:'["sketch"]',source:'local'}:null;}} as unknown as AppwriteClient;
 const registry=new CardRegistryStore(client,'db');
 expect(await registry.resolveAllowedKinds({projectId:'sketch-save-performance-20261021',teamId:'old'})).toEqual(['sketch']);
 expect(paths.every(p=>p.split('/').pop()!.length<=36)).toBe(true);
 expect(paths.some(p=>/scope-[a-f0-9]{28}$/.test(p))).toBe(true);
});
