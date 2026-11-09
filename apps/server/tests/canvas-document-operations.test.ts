import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,rm,writeFile,readFile,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {CanvasStateService} from '../src/canvas/state.js';
import type {CanvasOperation} from '@bezier/contracts';
let root:string,canvas:CanvasStateService;let serial=0;
const apply=async(operations:CanvasOperation[])=>canvas.applyOperations('p',{operationId:`doc-${serial++}`,baseRevision:(await canvas.read('p')).revision,operations});
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'canvas-doc-'));canvas=new CanvasStateService(()=>root);});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
it('creates webpage and deck cards with separate HTML copies and idempotent node receipts',async()=>{
  await mkdir(join(root,'site'));await writeFile(join(root,'site','index.html'),'<html><body><img src="local.png"><h1>Original</h1></body></html>');
  const created=await apply([{type:'document.create',nodeId:'page',format:'html',source:{path:'site/index.html'},x:0,y:0},{type:'document.create',nodeId:'deck',format:'presentation',source:{html:'<html><body><section class="slide">Deck</section></body></html>'},x:500,y:0}]);
  const nodes=created.state.workbenchBasicNodes as any[];expect(nodes[0].projectFilePath).toMatch(/^site\/canvas-page/);expect(nodes[1].artifactFormat).toBe('presentation');
  const copy=await apply([{type:'node.duplicate',nodeId:'page',newNodeId:'copy',x:20,y:50}]);const copied=(copy.state.workbenchBasicNodes as any[]).at(-1);
  expect(copied.projectFilePath).not.toBe(nodes[0].projectFilePath);expect(await readFile(join(root,copied.projectFilePath),'utf8')).toContain('local.png');
  await writeFile(join(root,copied.projectFilePath),'<html>Changed</html>');expect(await readFile(join(root,nodes[0].projectFilePath),'utf8')).toContain('Original');
  await apply([{type:'node.delete',nodeId:'copy'}]);expect((await canvas.read('p')).state.workbenchBasicNodes).toHaveLength(2);
});
it('prepares a bound generation and rejects invalid sources and stale targets',async()=>{
  await apply([{type:'document.create',nodeId:'page',format:'html',x:0,y:0}]);
  await expect(apply([{type:'document.begin',nodeId:'page',requestId:'r',outputPath:'../bad.html'}])).rejects.toMatchObject({status:400});
  const request={operationId:'begin',baseRevision:(await canvas.read('p')).revision,operations:[{type:'document.begin' as const,nodeId:'page',requestId:'r',outputPath:'candidate.html',expectedPath:''}]};
  const first=await canvas.applyOperations('p',request);expect((first.state.workbenchBasicNodes as any[])[0].generation.requestId).toBe('r');
  expect((await canvas.applyOperations('p',request)).replayed).toBe(true);
  await expect(apply([{type:'document.select',nodeId:'page',path:'other.html'}])).rejects.toMatchObject({status:400});
  await expect(apply([{type:'document.create',nodeId:'bad',format:'html',x:0,y:0,source:{path:'../index.html'}}])).rejects.toMatchObject({status:400});
  await writeFile(join(root,'original.html'),'<html>Source</html>');await symlink(join(root,'original.html'),join(root,'link.html'));
  await expect(apply([{type:'document.create',nodeId:'bad',format:'html',x:0,y:0,source:{path:'link.html'}}])).rejects.toThrow();
  expect((await canvas.read('p')).state.workbenchBasicNodes).toHaveLength(1);
});


