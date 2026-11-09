import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {AppwriteClient} from '../src/storage/appwrite-client.js';import {createCanvasServer} from '../src/server.js';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('Appwrite operations wait for the storage readiness gate and cannot bypass a rejected preflight',async()=>{
 const fetcher=vi.fn(async()=>Response.json({$id:'f',$permissions:[]}));vi.stubGlobal('fetch',fetcher);
 const rejected=Promise.reject(Object.assign(Error('not private'),{code:'CLOUD_STORAGE_NOT_PRIVATE'}));void rejected.catch(()=>{});
 const client=new AppwriteClient({endpoint:'https://fixture.invalid/v1',projectId:'p',apiKey:'fixture-only'},rejected);
 for(const operation of [()=>client.call('POST','/documents',{}),()=>client.getOrNull('/documents/a'),()=>client.download('/files/a'),()=>client.upload('bucket','f','a.png',new Uint8Array([1]),'image/png')])await expect(operation()).rejects.toMatchObject({code:'CLOUD_STORAGE_NOT_PRIVATE'});
 expect(fetcher).not.toHaveBeenCalled();
});
it('direct production factory cannot start or write business data with users-readable storage',async()=>{
 vi.stubEnv('NODE_ENV','production');const requests:Array<{method:string;url:string}>=[];
 vi.stubGlobal('fetch',vi.fn(async(url:unknown,init?:RequestInit)=>{requests.push({method:init?.method??'GET',url:String(url)});return Response.json({$permissions:['read("users")'],documentSecurity:true,fileSecurity:false});}));
 const root=await mkdtemp(path.join(tmpdir(),'image-production-gate-'));
 const api=createCanvasServer({dataRoot:root,appwrite:{endpoint:'https://fixture.invalid/v1',projectId:'p',apiKey:'fixture-only',databaseId:'business',bucketId:'bucket',runtime:{collectionId:'runtime',namespace:'production-test',singleWriter:true}}});
 try {await expect(api.ready).rejects.toMatchObject({code:'CLOUD_STORAGE_NOT_PRIVATE'});expect(requests.length).toBeGreaterThan(0);expect(requests.every(r=>r.method==='GET'&&!r.url.includes('/documents'))).toBe(true);}
 finally {await api.close().catch(()=>{});await rm(root,{recursive:true,force:true});}
});

it('production MA factory rejects service-wide or unbranded image credentials before startup',()=>{
 vi.stubEnv('NODE_ENV','production');
 for(const identityMode of ['service-only','single-user-development',undefined]) {
  const options={dataRoot:'/unused/image-auth-gate',authority:{},media:{identityMode}} as unknown as Parameters<typeof createCanvasServer>[0];
  expect(()=>createCanvasServer(options)).toThrow(expect.objectContaining({code:'IMAGE_REQUEST_IDENTITY_REQUIRED',status:503}));
 }
});
