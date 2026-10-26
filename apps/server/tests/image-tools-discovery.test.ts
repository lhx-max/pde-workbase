import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {expect,it} from 'vitest';import {createCanvasServer} from '../src/server.js';
it('tool discovery is project-authorized and never dispatches model work',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'image-tool-discovery-'));let discovery=0,dispatch=0;
 const api=createCanvasServer({dataRoot:root,media:{catalog:async()=>({providers:[],image:[],video:[],audio:{},aspects:[],videoLengthsSec:[],audioDurationsSec:[]}),config:async()=>({providers:{}}),tools:async()=>{discovery++;return{tools:[{id:'vectorize',configured:true},{id:'upscale',configured:false}]};},generate:async()=>{dispatch++;throw Error('unexpected generation');}}});
 await api.ready;const project=api.registry.create({name:'Discovery',teamId:'local',createdBy:'local'});const server=api.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const port=(server.address() as {port:number}).port;
 try{const response=await fetch(`http://127.0.0.1:${port}/api/apps/image/instances/${project.id}/tools`);expect(response.status).toBe(200);expect(((await response.json()) as {data:{tools:unknown[]}}).data.tools).toEqual([{id:'vectorize',configured:true},{id:'upscale',configured:false}]);const denied=await fetch(`http://127.0.0.1:${port}/api/apps/image/instances/${project.id}/tools`,{headers:{'x-team-id':'foreign'}});expect(denied.status).toBe(403);expect(discovery).toBe(1);expect(dispatch).toBe(0);}
 finally{await api.close();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
