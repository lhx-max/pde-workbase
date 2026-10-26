import {afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CanvasStateService} from '../src/canvas/state.js';
import {SketchAppFiles} from '../src/storage/sketch-app-files.js';
import {runWithRequestTenant} from '../src/tenant.js';
const roots:string[]=[];
afterEach(async()=>{vi.unstubAllGlobals();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('reads canonical sketch content instead of an old canvas mirror and rejects blind mirror writes',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'sketch-projection-'));roots.push(root);let scene='cloud-v1';
 const state=new CanvasStateService(()=>root,undefined,undefined,{sketchStore:async()=>({readSketch:async()=>scene,putSketch:async()=>{throw Error('not called');}})});
 expect((await state.readFileSnapshot('p','card.sketch.json')).content).toBe('cloud-v1');scene='cloud-v2';
 expect((await state.readFileSnapshot('p','card.sketch.json')).content).toBe('cloud-v2');
 await expect(state.writeTextMirror('p','card.sketch.json','stale')).rejects.toMatchObject({code:'SKETCH_WRITE_CHANNEL_REQUIRED'});
});
it('normalizes the registered protocol root and forwards request-scoped identity',async()=>{
 const fetcher=vi.fn(async(_input:string|URL,_init?:RequestInit)=>new Response('scene'));vi.stubGlobal('fetch',fetcher);
 await runWithRequestTenant({teamId:'team-a',userId:'user-a'},()=>new SketchAppFiles('https://sketch.example/api/apps/sketch').read('card.sketch.json'),{'x-mav-sso-authorization':'Bearer fixture'},['https://sketch.example']);
 expect(fetcher.mock.calls[0]?.[0]).toBe('https://sketch.example/api/files?path=card.sketch.json');
 expect(fetcher.mock.calls[0]?.[1]).toMatchObject({headers:{'x-team-id':'team-a','x-mav-sso-authorization':'Bearer fixture'}});
});
it('serves the browser raw URL from the sketch App without falling back to an old canvas file',async()=>{
 const {createServer}=await import('node:http');const {createCanvasServer}=await import('../src/server.js');
 const root=await mkdtemp(path.join(tmpdir(),'sketch-raw-'));roots.push(root);let content: string | null='{"type":"excalidraw","version":2,"elements":[]}';
 const remote=createServer((req,res)=>{if(req.url?.startsWith('/api/files?')&&content!==null){res.setHeader('content-type','application/json');res.end(content);}else{res.writeHead(404);res.end();}});
 const listen=(server:import('node:http').Server)=>new Promise<string>(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${(server.address() as {port:number}).port}`)));
 const origin=await listen(remote);const api=createCanvasServer({dataRoot:root});await api.ready;api.registry.create({id:'raw-project',name:'Raw'});const local=createServer(api.app);const base=await listen(local);
 try{
  const registered=await fetch(base+'/api/apps/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({appId:'sketch',name:'Sketch',endpoint:origin+'/api/apps/sketch'})});expect(registered.status).toBe(201);
  const url=base+'/api/projects/raw-project/raw/cards/a.sketch.json';const first=await fetch(url);expect(first.status).toBe(200);expect(await first.text()).toBe(content);expect(first.headers.get('cache-control')).toBe('private, no-store');
  content='{"type":"excalidraw","version":2,"elements":[{"id":"fresh"}]}';expect(await(await fetch(url)).text()).toBe(content);
  content=null;const missing=await fetch(url);expect(missing.status).toBe(404);expect(await missing.text()).toContain('FILE_NOT_FOUND');
 }finally{await new Promise<void>(resolve=>local.close(()=>resolve()));await api.close();await new Promise<void>(resolve=>remote.close(()=>resolve()));}
});
it('creates a bound App asset instead of a second path-only file and returns the mirror path',async()=>{
 const {SketchAppSketchStore}=await import('../src/storage/sketch-app-files.js');const requests:{url:string;body:unknown}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
  requests.push({url:String(input),body:init?.body?JSON.parse(String(init.body)):null});
  if(String(input).includes('/api/files/meta'))return new Response('',{status:404});
  return Response.json({data:{result:{meta:{id:'same-sketch',path:'sketches/same-sketch.sketch.json'}}}});
 }));
 const saved=await new SketchAppSketchStore(new SketchAppFiles('https://sketch.example/api/apps/sketch'),'canvas-long').putSketch('{"elements":[]}','operation','card');
 expect(saved).toEqual({path:'canvases/canvas-long/cards/card.sketch.json',sketchId:'same-sketch'});
 expect(requests[1]).toMatchObject({url:'https://sketch.example/api/apps/sketch/actions/sketch.create',body:{input:{nodeId:'card',mirrorCanvasId:'canvas-long',mirrorPath:saved.path,content:'{"elements":[]}'}}});
 expect(requests.some(r=>r.url.includes('/api/files?'))).toBe(false);
});
