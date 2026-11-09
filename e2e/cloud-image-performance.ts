/** Read-only timing probe; never generates images or changes cloud data. */
import {writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {createRequire} from 'node:module';
import path from 'node:path';
const {values}=parseArgs({options:{output:{type:'string'},'base-url':{type:'string',default:'http://127.0.0.1:17580'}}});
if(!values.output||!path.isAbsolute(values.output))throw Error('Pass absolute --output');
const sharp=createRequire(new URL('../apps/server/package.json',import.meta.url))('sharp') as (input:Buffer)=>{metadata():Promise<{width?:number;height?:number;format?:string}>};
const base=new URL(values['base-url']!);if(base.hostname!=='127.0.0.1'||base.protocol!=='http:')throw Error('Pass a loopback HTTP base URL');
const root=`${base.origin}/api/projects/image-device-proof-20261021`;
const name='outputs/images/canvas-c5ed1f00bf0805b57b3426972e054c62f3f672da6a57a42d85198979dbf512ca.png';
const scenarios=[{name:'sidebar-64',url:`${root}/raw/${name}?odThumbnailWidth=64`},{name:'canvas-512',url:`${root}/files/${name}?odCanvasPreview=image&odPreviewWidth=512`},{name:'canvas-1024',url:`${root}/files/${name}?odCanvasPreview=image&odPreviewWidth=1024`},{name:'original',url:`${root}/files/${name}`}];
const results=[];
for(const scenario of scenarios){
 for(let attempt=1;attempt<=2;attempt++){
  const started=performance.now();const r=await fetch(scenario.url,{cache:'no-store'});const firstByteMs=Math.round(performance.now()-started);const bytes=Buffer.from(await r.arrayBuffer());
  if(!r.ok)throw Error(`${scenario.name}: ${r.status}`);const meta=await sharp(bytes).metadata();
  if(scenario.name!=='original'&&meta.format!=='webp')throw Error(`${scenario.name} returned original bytes instead of preview`);
  results.push({scenario:scenario.name,attempt,status:r.status,bytes:bytes.length,firstByteMs,totalMs:Math.round(performance.now()-started),...meta});
 }
}
const started=performance.now();const shared=await Promise.all(Array.from({length:4},()=>fetch(`${root}/files/${name}?odCanvasPreview=image&odPreviewWidth=256`).then(async r=>{if(!r.ok)throw Error('Concurrent preview failed');return(await r.arrayBuffer()).byteLength;})));
const report={verifiedAt:new Date().toISOString(),results,concurrent:{requests:4,totalMs:Math.round(performance.now()-started),bytes:shared},baseline:{sidebar64:{ms:1675,bytes:618},canvas1024:{ms:6126,bytes:6189780}},note:'Originals remain PNG. Timings are this local development BFF plus real corporate Appwrite; cache is bounded per process, not CDN or staging proof.'};
await writeFile(values.output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
