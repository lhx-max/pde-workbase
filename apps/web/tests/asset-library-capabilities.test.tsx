// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PERSONAL_ASSET_CHANGED_EVENT,type AssetLibraryInfo} from '@bezier/contracts';
import {configureAssetLibraryAdapter,createHttpAssetLibrary} from '../src/providers/asset-library';
import {useAssetLibraryCapabilities} from '../src/components/asset-library/use-asset-library-capabilities';
const info=(id:string)=>({source:{id,name:id,kind:'external'},capabilities:{upload:true,analysis:false,catalogue:false}} as AssetLibraryInfo);
function deferred(){let resolve!:(value:AssetLibraryInfo)=>void;let reject!:(error:Error)=>void;const promise=new Promise<AssetLibraryInfo>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const restores:Array<()=>void>=[];
function install(request:()=>Promise<AssetLibraryInfo>){restores.push(configureAssetLibraryAdapter({...createHttpAssetLibrary(),info:request}));}
const refresh=()=>window.dispatchEvent(new Event(PERSONAL_ASSET_CHANGED_EVENT));
afterEach(()=>{cleanup();while(restores.length)restores.pop()!();});
it('keeps verified upload capability during same-source refresh after capture upload',async()=>{const next=deferred();install(vi.fn().mockResolvedValueOnce(info('A')).mockReturnValue(next.promise));const {result}=renderHook(useAssetLibraryCapabilities);await waitFor(()=>expect(result.current.info?.capabilities.upload).toBe(true));act(refresh);expect(result.current.info?.capabilities.upload).toBe(true);await act(async()=>next.resolve(info('A')));expect(result.current.info?.source.id).toBe('A');});
it('fails closed immediately for a new adapter until it has verified capabilities',async()=>{install(async()=>info('A'));const {result}=renderHook(useAssetLibraryCapabilities);await waitFor(()=>expect(result.current.info?.source.id).toBe('A'));const next=deferred();act(()=>install(()=>next.promise));expect(result.current.info).toBeNull();await act(async()=>next.resolve(info('B')));expect(result.current.info?.source.id).toBe('B');});
it('fails closed on a refresh error and does not restore stale capability responses',async()=>{const first=deferred(),second=deferred();install(vi.fn().mockResolvedValueOnce(info('A')).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));const {result}=renderHook(useAssetLibraryCapabilities);await waitFor(()=>expect(result.current.info?.source.id).toBe('A'));act(refresh);act(refresh);await act(async()=>second.reject(new Error('offline')));expect(result.current.info).toBeNull();await act(async()=>first.resolve(info('A')));expect(result.current.info).toBeNull();});
it('ignores completion from a replaced source',async()=>{const old=deferred();install(()=>old.promise);const {result}=renderHook(useAssetLibraryCapabilities);expect(result.current.info).toBeNull();act(()=>install(async()=>info('B')));await waitFor(()=>expect(result.current.info?.source.id).toBe('B'));await act(async()=>old.resolve(info('A')));expect(result.current.info?.source.id).toBe('B');});
