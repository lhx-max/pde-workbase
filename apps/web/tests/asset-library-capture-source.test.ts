// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import type {BezierHostBrowserCapture} from '@bezier/host';
import {configureAssetLibraryAdapter,createHttpAssetLibrary} from '../src/providers/asset-library';
import {persistBrowserCapture} from '../src/browser-capture/persist-browser-capture';
it('keeps inspector update and follow-up reads on the originally captured adapter',async()=>{
 let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;});
 const getA=vi.fn().mockResolvedValue({asset:{id:'asset',name:'Source A'}}),getB=vi.fn().mockResolvedValue({asset:{id:'asset',name:'Source B'}});
 const analysisA=vi.fn().mockResolvedValue(undefined),promptA=vi.fn().mockResolvedValue(undefined),analysisB=vi.fn().mockResolvedValue(undefined),promptB=vi.fn().mockResolvedValue(undefined);
 const restoreA=configureAssetLibraryAdapter({...createHttpAssetLibrary(),patch:vi.fn().mockImplementation(async()=>{await pending;return {asset:{id:'asset'}};}),get:getA,analysisStatus:analysisA,promptStatus:promptA});
 let restoreB:(()=>void)|undefined;
 try {
  const result=persistBrowserCapture('p',{captureId:'cap',assetOperation:{action:'update',assetId:'asset',patch:{name:'Updated'}}} as BezierHostBrowserCapture);
  restoreB=configureAssetLibraryAdapter({...createHttpAssetLibrary(),get:getB,analysisStatus:analysisB,promptStatus:promptB});
  finish();
  expect((await result).assetData?.asset.name).toBe('Source A');
  for(const read of [getA,analysisA,promptA])expect(read).toHaveBeenCalledWith('asset');
  for(const read of [getB,analysisB,promptB])expect(read).not.toHaveBeenCalled();
 } finally {finish();restoreB?.();restoreA();}
});
