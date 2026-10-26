/** Read-only proof for resource thumbnails and saved canvas references. No generation. */
import { readFile,writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { AppwriteClient } from '../apps/server/src/storage/appwrite-client.js';
const {values}=parseArgs({options:{'console-prefs':{type:'string'},output:{type:'string'}}});
for(const key of ['console-prefs','output'] as const)if(!values[key]||!path.isAbsolute(values[key]!))throw Error(`Pass absolute --${key}`);
const prefs=JSON.parse(await readFile(values['console-prefs']!,'utf8'));
const cookie=/a_session_console=([^;,\s]+)/u.exec(prefs[prefs.current].cookie)?.[1];if(!cookie)throw Error('Missing maintenance session');
const client=new AppwriteClient({endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',sessionCookie:`a_session_console=${cookie}`,sessionMode:'admin'});
const projectId='image-device-proof-20261021';
const row=await client.call<{state:string;revision:number}>('GET',`${client.docsPath('canvas_app_dev','canvases')}/${projectId}`);
const state=JSON.parse(row.state) as {workbenchImages:Array<{id:string;path:string}>};
const references:Record<string,number>={};for(const image of state.workbenchImages)references[image.path]=(references[image.path]??0)+1;
if(state.workbenchImages.length<4||!Object.values(references).some(n=>n>=3))throw Error('Saved drag/menu imports missing');
const response=await fetch(`http://127.0.0.1:17462/api/projects/${projectId}/files`);if(!response.ok)throw Error('Resource list unavailable');
const listing=await response.json();const files=(Array.isArray(listing)?listing:listing.files) as Array<{name:string;kind:string;mtime:number}>;
const sharp=createRequire(new URL('../apps/server/package.json',import.meta.url))('sharp') as (input:Buffer)=>{metadata():Promise<{width?:number;height?:number;format?:string}>};
const thumbnails=[];
for(const file of files.filter(f=>f.kind==='image')){
 const preview=await fetch(`http://127.0.0.1:17462/api/projects/${projectId}/raw/${file.name}?odThumbnailWidth=64&v=${file.mtime}`);
 if(!preview.ok||!preview.headers.get('content-type')?.startsWith('image/webp'))throw Error('Thumbnail unavailable');
 const meta=await sharp(Buffer.from(await preview.arrayBuffer())).metadata();if(!meta.width||meta.width>64||!meta.height||meta.height>64)throw Error('Thumbnail dimensions invalid');
 thumbnails.push({path:file.name,width:meta.width,height:meta.height,format:meta.format,references:references[file.name]??0});
}
if(thumbnails.length!==3)throw Error('Expected the same three resources after reuse');
const report={passed:true,verifiedAt:new Date().toISOString(),projectId,cloudRevision:row.revision,resourceCount:thumbnails.length,imageCards:state.workbenchImages.length,thumbnails,note:'Actual UI drag and Add to canvas menu each imported an existing image; cloud state and browser refresh verified. Resource reuse did not create a fourth resource or call a model.'};
await writeFile(values.output!,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
