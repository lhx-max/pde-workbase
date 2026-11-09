/** Artifact runtime acceptance. Local fixture boots do not establish cloud or MA acceptance. */
import {execFileSync,spawnSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
const{values}=parseArgs({options:{output:{type:'string'},tag:{type:'string',default:'acceptance-20261022'}}});
if(!values.output||!path.isAbsolute(values.output))throw Error('Absolute output required');
const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim();
const checks:string[]=[];const images:Record<string,string>={};let failure:string|undefined;const runtimeFailures:Record<string,string>={};
try{
for(const app of ['canvas','doc','sketch']){
 const image=`designai-${app}:${values.tag}`;const metadata=JSON.parse(docker(['image','inspect',image]))[0];images[app]=metadata.Id;
 assert.equal(metadata.Config.User,'node');assert(!metadata.Config.Env.some((entry:string)=>/^(APPWRITE_API_KEY|APPWRITE_SESSION_COOKIE|APPWRITE_SESSION_SECRET|MAV_SSO_TOKEN)=/.test(entry)));checks.push(`${app}: image uses non-root user and contains no configured credentials`);
 assert.equal(docker(['run','--rm','--entrypoint','node',image,'-e','console.log(process.getuid())']),'1000');checks.push(`${app}: actual container process runs as UID 1000`);
 const refused=spawnSync('docker',['run','--rm',image],{encoding:'utf8',timeout:20000});assert(refused.status!==0&&!refused.error);assert(/Invalid .+runtime configuration|Production requires/.test(refused.stderr));checks.push(`${app}: unconfigured production startup refuses before listening`);
 const port=app==='canvas'?17456:app==='doc'?19000:17610;
 const variables=app==='canvas'?['CANVAS_STORAGE_MODE=local-test','CANVAS_AUTH_TOKEN=isolated-container-fixture']:app==='doc'?['DOC_STORAGE_MODE=local-test','DOC_DATA_DIR=/tmp/doc-fixture']:['SKETCH_STORAGE_MODE=local-test','SKETCH_DATA_DIR=/tmp/sketch-fixture','SKETCH_LISTEN_HOST=0.0.0.0'];
 let id:string|undefined;
 try{
  id=docker(['run','-d','--rm','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,nodev,size=1g,uid=1000,gid=1000','--init','-e','NODE_ENV=test',...variables.flatMap(value=>['-e',value]),'-p',`127.0.0.1::${port}`,image]);
  const address=docker(['port',id,`${port}/tcp`]);const origin=`http://${address}`;let healthy=false;
  for(let attempt=0;attempt<50;attempt++){
   try{const res=await fetch(origin+(app==='sketch'?'/api/ready':'/api/health'),{headers:app==='canvas'?{authorization:'Bearer isolated-container-fixture'}:{},signal:AbortSignal.timeout(1000)});if(res.ok){healthy=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!healthy)runtimeFailures[app]=docker(['logs',id]);assert(healthy,`${app} isolated fixture did not become healthy`);checks.push(`${app}: explicit disposable local-test container boots and answers health over real HTTP`);if(app!=='canvas'){const page=await fetch(origin+'/');assert.equal(page.status,200,app+' frontend index');const html=await page.text();assert.match(html,/<html|<!doctype/i);const resources=[...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:["'])/g)].map(m=>m[1]!);assert(resources.length,app+' frontend resources');for(const resource of resources.slice(0,8)){const response=await fetch(new URL(resource,origin));assert.equal(response.status,200,resource);assert((await response.arrayBuffer()).byteLength>0);}checks.push(`${app}: actual static HTML and linked JavaScript/CSS are served from the readonly image`);}
  const stopped=docker(['stop','--timeout','15',id]);assert.equal(stopped,id);id=undefined;checks.push(`${app}: graceful container shutdown completes`);
 }finally{if(id)try{docker(['rm','-f',id]);}catch{}}
}
// Exercise native dependencies with real media and a minimal valid PDF, as the image user.
const native=`const{execFileSync}=require('node:child_process');const{rmSync}=require('node:fs');const assert=require('node:assert/strict');const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];const stream='BT /F1 12 Tf 20 200 Td (Smoke preview) Tj ET';objects[3]='<< /Length '+Buffer.byteLength(stream)+' >>\\nstream\\n'+stream+'\\nendstream';let pdf='%PDF-1.4\\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\\n'+objects[i]+'\\nendobj\\n';}const xref=Buffer.byteLength(pdf);pdf+='xref\\n0 6\\n0000000000 65535 f \\n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \\n').join('')+'trailer\\n<< /Size 6 /Root 1 0 R >>\\nstartxref\\n'+xref+'\\n%%EOF';assert.match(execFileSync('pdftotext',['-','-'],{input:pdf,encoding:'utf8'}),/Smoke preview/);const file='/tmp/preview-smoke.mp4';try{execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=32x32:d=0.1','-y',file]);const result=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',file],{encoding:'utf8'}));assert(result.streams.some(s=>s.codec_type==='video'));}finally{rmSync(file,{force:true});}console.log('native-preview-ok');`;
assert.equal(docker(['run','--rm','--entrypoint','node', 'designai-canvas:'+values.tag,'-e',native]),'native-preview-ok');checks.push('canvas: non-root image extracts real PDF text and encodes/probes real video');
}catch(error){failure=error instanceof Error?error.message:String(error);}
await mkdir(path.dirname(values.output),{recursive:true});await writeFile(values.output,JSON.stringify({checkedAt:new Date().toISOString(),passed:!failure,scope:'actual built containers, production refusal, explicit isolated local fixtures and native preview tools; no cloud/MA deployment claim',images,checks,runtimeFailures,...(failure?{failure}:{})},null,2)+'\n');
if(failure)throw Error(failure);console.log(JSON.stringify({passed:true,checks:checks.length}));
