/** Explicit isolated, maintainer-only UI fixture. No model requests. */
import {createRequire} from 'node:module';import {mkdir,writeFile} from 'node:fs/promises';
const sharp=createRequire(new URL('../apps/server/package.json',import.meta.url))('sharp') as typeof import('sharp').default;
const base='http://127.0.0.1:17462',projectId=`image-mvp-ui-${Date.now()}`;
async function json(path:string,init?:RequestInit){const response=await fetch(base+path,init),value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value.data??value;}
const post=(input:unknown,key:string)=>({method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify(input)});
await json('/api/apps/canvas/actions/canvas.create',post({input:{instanceId:projectId,name:'图片MVP工程恢复验收'}},`create-${projectId}`));
const source=await sharp({create:{width:320,height:240,channels:3,background:'#256a8e'}}).png().toBuffer();
const design=await sharp({create:{width:80,height:80,channels:3,background:'#f89648'}}).png().toBuffer();
const form=new FormData();form.append('files',new Blob([new Uint8Array(source)],{type:'image/png'}),'base.png');form.append('files',new Blob([new Uint8Array(design)],{type:'image/png'}),'design.png');
const uploaded=await json(`/api/projects/${projectId}/upload`,{method:'POST',body:form});
let state=await json(`/api/apps/image/instances/${projectId}/state`);
await json(`/api/apps/canvas/instances/${projectId}/operations`,post({operationId:'attach',baseRevision:state.revision,operations:[{type:'image.attach',nodeId:'source',source:{path:uploaded.files[0].name},x:250,y:180}]},'attach'));
state=await json(`/api/apps/image/instances/${projectId}/state`);const sourcePath=state.cards.find((v:{nodeId:string})=>v.nodeId==='source').node.path;
const document={version:2,basePath:sourcePath,layers:[{id:'design',name:'橙色贴图',path:uploaded.files[1].name,quad:[[.2,.2],[.7,.2],[.7,.8],[.2,.8]],opacity:1,blend:'normal',lighting:0,wrinkle:0,mask:[],material:'screen'}],surface:null};
await json(`/api/apps/image/instances/${projectId}/actions/image.edit.save`,post({input:{nodeId:'source',document,expectedEditRevision:0},expectedRevision:state.revision},'seed-edit'));
const restored=await json(`/api/apps/image/instances/${projectId}/actions/image.edit.read`,post({input:{nodeId:'source'}},'read'));
if(restored.result.document.layers[0].name!=='橙色贴图')throw Error('Missing editable layer');
await mkdir('docs/verification/image-mvp-api-20261022',{recursive:true});await writeFile('docs/verification/image-mvp-api-20261022/ui-fixture.json',JSON.stringify({projectId,sourcePath,document,url:`http://127.0.0.1:17580/?projectId=${projectId}`}));console.log(JSON.stringify({projectId,url:`http://127.0.0.1:17580/?projectId=${projectId}`}));
