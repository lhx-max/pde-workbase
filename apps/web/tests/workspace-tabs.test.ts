// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { cacheTabs,loadTabs,moveWorkspaceTab,normalizeTabs,persistTabs } from '../src/state/workspace-tabs';
describe('standalone tab persistence',()=>{
 beforeEach(()=>{localStorage.clear();});afterEach(()=>vi.unstubAllGlobals());
 it('keeps browser, clip, text and sketch order in the original tabs shape',()=>{const tabs=['notes.md','__browser__:a','diagram.excalidraw','clip-editor:clip-1'];expect(moveWorkspaceTab(tabs,tabs[3]!,tabs[1]!,false)).toEqual(['notes.md','clip-editor:clip-1','__browser__:a','diagram.excalidraw']);expect(tabs[3]).toBe('clip-editor:clip-1');});
 it('rejects malformed tab payloads and removes duplicate IDs',()=>{expect(normalizeTabs({tabs:['a',42]})).toBeNull();expect(normalizeTabs({tabs:['a','a'],active:'a'})?.tabs).toEqual(['a']);});
 it('reconciles a newer local tab snapshot before returning from load',async()=>{const state=cacheTabs('p',{tabs:['notes.md','__browser__:b'],active:'__browser__:b',browserTabs:[{id:'__browser__:b',label:'Browser',url:'https://example.com'}]});const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({tabs:[],active:null,updatedAt:1}))).mockResolvedValueOnce(new Response('{}'));vi.stubGlobal('fetch',fetch);expect(await loadTabs('p')).toEqual(state);expect(fetch.mock.calls[1]?.[0]).toBe('/api/projects/p/tabs');expect(fetch.mock.calls[1]?.[1].method).toBe('PUT');expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toEqual(state);});
 it('reports failed saves instead of falsely acknowledging persistence',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'Disk is full'}),{status:507})));await expect(persistTabs('p',{tabs:['draft.md'],active:'draft.md'})).rejects.toThrow('Disk is full');});
});
