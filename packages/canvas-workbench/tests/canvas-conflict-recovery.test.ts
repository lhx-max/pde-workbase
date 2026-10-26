// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {CanvasCompatProvider,useCanvasState} from '../src/platform/canvas-compat';
let root:Root|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each([false,true])('keeps draft on 409 and safely recovers (overlap=%s)',async(overlap)=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const errors=vi.spyOn(console,'error').mockImplementation(()=>{});vi.spyOn(console,'warn').mockImplementation(()=>{});
 let remote={left:1,right:1},revision=1,writes=0;
 const bodies:Array<{changes:{testSettings:typeof remote}}>=[];
 const context={projectId:'conflict-test',transport:{fetch:vi.fn(async(_url:string,init?:RequestInit)=>{
  if(init?.method==='PATCH'){
   writes++;const body=JSON.parse(String(init.body));bodies.push(body);
   if(writes===1){remote=overlap?{left:3,right:1}:{left:1,right:3};revision=2;return new Response(JSON.stringify({error:{code:'CANVAS_REVISION_CONFLICT',message:'conflict'}}),{status:409});}
   remote=body.changes.testSettings;return new Response(JSON.stringify({ok:true,state:{testSettings:remote},revision:++revision}));
  }
  return new Response(JSON.stringify({ok:true,state:{testSettings:remote},revision}));
 })}};
 let edit!:React.Dispatch<React.SetStateAction<typeof remote>>;let observed:typeof remote;
 function Probe(){[observed,edit]=useCanvasState('testSettings',{left:0,right:0});return null;}
 const host=document.createElement('div');root=createRoot(host);
 await act(async()=>root!.render(React.createElement(CanvasCompatProvider,{requestContext:context},React.createElement(Probe))));
 await act(async()=>edit({left:2,right:1}));
 expect(writes).toBe(1);expect(localStorage.getItem('canvas-unsaved:conflict-test')).not.toBeNull();expect(errors).not.toHaveBeenCalled();
 const recover=[...host.querySelectorAll('button')].find(b=>b.textContent==='保留草稿并读取最新');expect(recover).toBeTruthy();
 await act(async()=>recover!.click());
 if(overlap){expect(writes).toBe(1);expect(observed!).toEqual({left:2,right:1});expect(localStorage.getItem('canvas-unsaved:conflict-test')).not.toBeNull();expect(host.querySelector('[role=alert]')).not.toBeNull();}
 else{expect(writes).toBe(2);expect(bodies[1]!.changes.testSettings).toEqual({left:2,right:3});expect(observed!).toEqual({left:2,right:3});expect(localStorage.getItem('canvas-unsaved:conflict-test')).toBeNull();expect(host.querySelector('[role=alert]')).toBeNull();}
});
