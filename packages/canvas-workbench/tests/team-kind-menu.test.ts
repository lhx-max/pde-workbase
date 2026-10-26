// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,it,expect,vi} from 'vitest';
vi.mock('../src/platform/api-base',()=>({platformFetchWithContext:vi.fn()}));
vi.mock('../src/platform/ui-host',()=>({useCanvasUiHost:()=>({}),requireCanvasMenuRenderer:()=>({items}:{items:Array<{id:string;kind?:string}>})=>React.createElement('div',null,items.filter(item=>!item.kind).map(item=>React.createElement('button',{key:item.id,'data-kind':item.id},item.id)))}));
import {platformFetchWithContext} from '../src/platform/api-base';
import {CanvasTeamKindAvailability} from '../src/platform/kind-availability';
import {CanvasAddNodeMenu} from '../src/workbench/CanvasAddNodeMenu';
const holder=document.createElement('div');document.body.append(holder);const root=createRoot(holder);
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(async()=>{await act(async()=>root.render(null));vi.clearAllMocks();});
async function menu(projectId:string){await act(async()=>root.render(React.createElement(CanvasTeamKindAvailability,{context:{projectId},children:React.createElement(CanvasAddNodeMenu,{open:true,onOpenChange:()=>{},trigger:React.createElement('button'),onAddNode:()=>{}})})));}
it('renders only team-granted creation entries in the actual shared add-node menu',async()=>{
 vi.mocked(platformFetchWithContext).mockResolvedValue(Response.json({data:{allowedKinds:['storyboard']}}));
 await menu('team-a');expect([...holder.querySelectorAll('[data-kind]')].map(element=>element.getAttribute('data-kind'))).toEqual(['storyboard']);
});
it('does not retain the previous team menu when policy loading fails',async()=>{
 vi.mocked(platformFetchWithContext).mockResolvedValueOnce(Response.json({data:{allowedKinds:['text']}}));await menu('team-a');expect(holder.querySelector('[data-kind="text"]')).not.toBeNull();
 vi.mocked(platformFetchWithContext).mockResolvedValueOnce(Response.json({error:{code:'AUTH_REQUIRED'}},{status:401}));await menu('team-b');expect(holder.querySelectorAll('[data-kind]')).toHaveLength(0);
});
