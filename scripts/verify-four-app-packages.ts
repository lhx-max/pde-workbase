/** Install four built tarballs outside every checkout and verify public consumers. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{canvas:{type:'string'},doc:{type:'string'},sketch:{type:'string'},image:{type:'string'},output:{type:'string'},'independent-image-ma':{type:'boolean',default:false}}});
for(const key of ['canvas','doc','sketch','image','output'] as const)if(!values[key]||!path.isAbsolute(values[key]!))throw Error(`${key} requires an absolute path`);
const root=mkdtempSync(path.join(tmpdir(),'four-app-consumer-'));
const checks:Array<{name:string;passed:boolean}>=[];const logs:Record<string,string>={};
const run=(name:string,exe:string,args:string[])=>{logs[name]=execFileSync(exe,args,{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,env:{...process.env,npm_config_engine_strict:'true'}});checks.push({name,passed:true});};
let failure:string|undefined;
try{
 writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'four-app-independent-consumer',private:true,version:'0.0.0',type:'module',dependencies:{'@ks-designai/canvas-surface':`file:${values.canvas}`,'@ks-designai/doc-surface':`file:${values.doc}`,'@ks-designai/sketch-surface':`file:${values.sketch}`,'@ks-designai/image-card-pack':`file:${values.image}`,'@xyflow/react':'12.8.5','@excalidraw/excalidraw':'0.18.1',react:'18.3.1','react-dom':'18.3.1'},devDependencies:{vite:'8.3.4',typescript:'5.9.3','@types/react':'18.3.28','@types/react-dom':'18.3.7'}}));
 run('Install real tarballs in a clean external directory','pnpm',['install','--ignore-scripts','--registry=https://registry.npmjs.org/']);
 writeFileSync(path.join(root,'index.html'),'<div id="root"></div><script type="module" src="/main.tsx"></script>');
 writeFileSync(path.join(root,'main.tsx'),`import React from 'react';
import CanvasSurface,{createCanvasApp} from '@ks-designai/canvas-surface';
import '@ks-designai/canvas-surface/styles.css';
import {DocumentEditorPane} from '@ks-designai/doc-surface';
import {DocEditorApp,createDocEditorApp} from '@ks-designai/doc-surface/da';
import {createAuthenticatedDocProvider,providerDocApi} from '@ks-designai/doc-surface/provider';
import '@ks-designai/doc-surface/styles.css';
import {SketchEditorApp,createSketchEditorApp,createAuthenticatedSketchProvider} from '@ks-designai/sketch-surface/da';
import '@ks-designai/sketch-surface/styles.css';
import {ImageCanvasCard} from '@ks-designai/image-card-pack/react';
${values['independent-image-ma']?"import {createIndependentImageMaApp,IndependentImageMaApp} from '@ks-designai/image-card-pack/react';\nconst ConfiguredImage=createIndependentImageMaApp({requestForContext:context=>(route,init)=>fetch('/image'+route,init)});\nconsole.log(ConfiguredImage,IndependentImageMaApp);":''}
console.log(React,CanvasSurface,createCanvasApp,DocumentEditorPane,DocEditorApp,createDocEditorApp,createAuthenticatedDocProvider,providerDocApi,SketchEditorApp,createSketchEditorApp,createAuthenticatedSketchProvider,ImageCanvasCard);`);
 writeFileSync(path.join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',lib:['ES2022','DOM','DOM.Iterable'],jsx:'react-jsx',module:'ESNext',moduleResolution:'Bundler',strict:true,noEmit:true,skipLibCheck:true,esModuleInterop:true},include:['main.tsx']}));
 run('Public TypeScript declarations compile together','pnpm',['exec','tsc','--noEmit']);
 run('Browser bundle includes all four public surfaces and CSS','pnpm',['exec','vite','build']);
 run('Pure server and manifest exports load in Node',process.execPath,['--input-type=module','-e',"import*as image from '@ks-designai/image-card-pack/server';import{createSketchManifest}from'@ks-designai/sketch-surface/manifest';import{createAuthenticatedDocProvider,providerDocApi}from'@ks-designai/doc-surface/provider';import{createAuthenticatedSketchProvider,providerSketchApi}from'@ks-designai/sketch-surface/provider';if(!image.imageAppManifest||!createSketchManifest('https://sketch.example')||typeof createAuthenticatedDocProvider!=='function'||typeof providerDocApi!=='function'||typeof createAuthenticatedSketchProvider!=='function'||typeof providerSketchApi!=='function')throw Error('Missing manifest');console.log('pure exports verified')"]);
 if(values['independent-image-ma'])run('Independent Image Kit manifest and backend import stay React-free',process.execPath,['--input-type=module','-e',"import{getIndependentImageKitManifest,independentImageManifest}from'@ks-designai/image-card-pack/app-backend';const m=getIndependentImageKitManifest({providerBaseUrl:'https://image.example'});if(m.version!==independentImageManifest.version||m.actions.length!==11||m.actions.filter(a=>a.effect==='read').length!==2||m.frontend.exportName!=='IndependentImageMaApp')throw Error('Invalid Image Kit manifest');console.log(JSON.stringify({version:m.version,actions:m.actions.length}))"]);
}catch(error){failure=error instanceof Error?error.message:String(error);process.exitCode=1;}
finally{
 const artifacts=Object.fromEntries((['canvas','doc','sketch','image'] as const).map(k=>[k,{file:path.basename(values[k]!),sha256:createHash('sha256').update(readFileSync(values[k]!)).digest('hex')}]));
 mkdirSync(path.dirname(values.output!),{recursive:true});writeFileSync(values.output!,JSON.stringify({verifiedAt:new Date().toISOString(),passed:!failure,checks,artifacts,logs,...(failure?{failure}:{})},null,2));
 rmSync(root,{recursive:true,force:true});console.log(JSON.stringify({passed:!failure,checks:checks.length,...(failure?{failure}:{})}));
}
