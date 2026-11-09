/** Explicit local integration fixture. This is not a production App entrypoint. */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {createHttpMediaAdapter} from '../apps/server/src/http-adapters.js';
import {createCanvasServer} from '../apps/server/src/server.js';
const {values}=parseArgs({options:{'local-test':{type:'boolean'},'data-dir':{type:'string'},'doc-source':{type:'string'},'sketch-source':{type:'string'},'port-base':{type:'string',default:'19463'},'single-user-image-url':{type:'string'},'image-token-file':{type:'string'}}});
if(!values['local-test']||process.env.NODE_ENV==='production')throw Error('Pass --local-test; production is forbidden');
for(const key of ['data-dir','doc-source','sketch-source'] as const)if(!values[key]||!path.isAbsolute(values[key]!))throw Error(`Pass an explicit absolute --${key}`);
const port=Number(values['port-base']);if(!Number.isInteger(port)||port<1024||port>65532)throw Error('Invalid loopback port base');
// Do not accidentally consult a developer credential/authority environment.
for(const key of Object.keys(process.env))if(/^(APPWRITE_|MAV_|TEAM_PERMISSIONS_URL$|DOC_REQUIRE_AUTH$|SKETCH_REQUIRE_AUTH$)/.test(key))delete process.env[key];
process.env.SKETCH_PROVIDER_LOCAL='1';
const source=(root:string,file:string)=>import(pathToFileURL(path.join(root,'apps/server/src',file)).href);
const [docModule,docStoreModule,sketchModule,sketchStoreModule]=await Promise.all([
 source(values['doc-source']!,'app.ts'),source(values['doc-source']!,'local-store.ts'),
 source(values['sketch-source']!,'app.ts'),source(values['sketch-source']!,'local-store.ts'),
]);
const root=values['data-dir']!,origin='http://127.0.0.1:18582';
let media;
if(values['single-user-image-url']||values['image-token-file']){
 if(!values['single-user-image-url']||!values['image-token-file']||!path.isAbsolute(values['image-token-file']))throw Error('Pass both --single-user-image-url and absolute --image-token-file');
 const url=new URL(values['single-user-image-url']);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Image development service must use a plain loopback origin');
 const token=(await readFile(values['image-token-file'],'utf8')).trim();if(!token)throw Error('Empty image service token');
 media=createHttpMediaAdapter(url.origin,token);
}
const canvas=createCanvasServer({dataRoot:path.join(root,'canvas'),host:'127.0.0.1',providerLocalDevelopment:true,allowedOrigins:[origin],...(media?{media}:{})});await canvas.ready;
const doc=docModule.createApp(new docStoreModule.LocalDocStore(path.join(root,'doc')),{allowedOrigins:[origin,`http://127.0.0.1:${port+1}`]});
const sketch=sketchModule.createApp(new sketchStoreModule.LocalSketchStore(path.join(root,'sketch')),{allowedOrigins:[origin,`http://127.0.0.1:${port+2}`]});
const servers=[canvas.app,doc,sketch].map((app,index)=>app.listen(port+index,'127.0.0.1'));
console.log(JSON.stringify({mode:'explicit-local-test',ports:[port,port+1,port+2],cloud:false,models:media?'single-maintainer-device-authorization':false}));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await Promise.all(servers.map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));await canvas.close();process.exit(0);});
