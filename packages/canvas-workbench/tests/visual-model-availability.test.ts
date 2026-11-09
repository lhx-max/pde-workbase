import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({image:[] as Array<{id:string;provider:string}>,enabled:true}));
vi.mock('../src/platform/media-catalog',()=>({getCanvasMediaSnapshot:()=>({image:state.image,video:[],ready:true})}));
vi.mock('../src/platform/media-policy',()=>({isCanvasMediaProviderEnabled:()=>state.enabled}));
import {isVisualModelEnabled} from '../src/workbench/visual-model-routing';
afterEach(()=>{state.image=[];state.enabled=true;});
it('does not enable the legacy Codex choice when no executable model was discovered',()=>{
 expect(isVisualModelEnabled('codex-gpt2')).toBe(false);
});
it('enables discovered Codex only while product policy permits it',()=>{
 state.image=[{id:'codex-gpt2',provider:'codex'}];expect(isVisualModelEnabled('codex-gpt2')).toBe(true);
 state.enabled=false;expect(isVisualModelEnabled('codex-gpt2')).toBe(false);
});
