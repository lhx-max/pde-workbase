// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,renderHook} from '@testing-library/react';
import {useWorkflowArtifacts} from '../src/components/workspace/use-workflow-artifacts';
describe('original workflow projection lifecycle',()=>{
 beforeEach(()=>{vi.useFakeTimers();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});});
 afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
 it('defers polling during interaction and catches up after the original 600ms quiet window',async()=>{const fetch=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({artifacts:[]}))));vi.stubGlobal('fetch',fetch);const {result}=renderHook(()=>useWorkflowArtifacts('p'));await act(async()=>{});expect(fetch).toHaveBeenCalledTimes(1);act(()=>result.current.onInteractionActiveChange(true));await act(async()=>vi.advanceTimersByTimeAsync(2000));expect(fetch).toHaveBeenCalledTimes(1);act(()=>result.current.onInteractionActiveChange(false));await act(async()=>vi.advanceTimersByTimeAsync(599));expect(fetch).toHaveBeenCalledTimes(1);await act(async()=>vi.advanceTimersByTimeAsync(1));expect(fetch).toHaveBeenCalledTimes(2);});
 it('does not replace confirmed artifacts with an error response',async()=>{const artifacts=[{id:'result-1'}];const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({artifacts}))).mockResolvedValue(new Response('offline',{status:503}));vi.stubGlobal('fetch',fetch);const {result}=renderHook(()=>useWorkflowArtifacts('p'));await act(async()=>{});expect(result.current.artifacts).toEqual(artifacts);await act(async()=>vi.advanceTimersByTimeAsync(2000));expect(result.current.artifacts).toEqual(artifacts);expect(result.current.error).toContain('503');});
});
