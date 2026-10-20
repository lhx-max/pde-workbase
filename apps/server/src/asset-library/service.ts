import type {AssetAnalysisTarget, AssetAnalysisStatus, AssetLibraryInfo, AssetLibraryCatalogueResponse, PersonalAssetAnalysisRequest, PersonalAssetCreate} from '@bezier/contracts';
import {createPersonalAssetService, type PersonalAssetService} from './core.js';
import {openAssetLibraryDatabase} from '../storage/asset-library.js';

type Awaitable<T> = T | Promise<T>;
type Operations = Pick<PersonalAssetService, 'list'|'read'|'create'|'patch'|'version'|'content'|'batch'|'uses'|'recordUse'|'readSpaces'|'patchSpaces'|'importTemplates'|'indexImages'>;
type AsyncOperations = {[K in keyof Operations]: (...args:Parameters<Operations[K]>)=>Awaitable<Awaited<ReturnType<Operations[K]>>>};
/** Full server-side source replacement. Required operations must genuinely work;
 * a list/import-only v1 source uses AssetAdapter, not this full-library port.
 * Adapters receive bytes/DTOs, never the original platform, DB or filesystem root.
 */
export interface AssetLibraryAdapter extends AsyncOperations {
  readonly source: AssetLibraryInfo['source'];
  readonly imageMetadata: boolean;
  readonly idempotentCreate: boolean;
  close?(): Awaitable<void>;
}
export interface AssetLibraryAnalysisHook {
  state(id:string,target:AssetAnalysisTarget):Awaitable<AssetAnalysisStatus>;
  enqueue(id:string,request:PersonalAssetAnalysisRequest,target:AssetAnalysisTarget):Awaitable<AssetAnalysisStatus>;
}
/** A configured catalogue is the authority for importable templates. Frontend
 * input cannot manufacture installed packages. resolveTemplates must reject any
 * unavailable selection, or return the approved complete set atomically.
 */
export interface AssetLibraryCatalogueHook {
  list():Awaitable<AssetLibraryCatalogueResponse>;
  resolveTemplates(selection:PersonalAssetCreate[]):Awaitable<PersonalAssetCreate[]>;
}
export interface AssetLibraryOptions {
  adapter?:AssetLibraryAdapter;
  analysis?:AssetLibraryAnalysisHook;
  catalogue?:AssetLibraryCatalogueHook;
}
export function createLocalAssetLibrary(dataRoot:string):AssetLibraryAdapter {
  const db=openAssetLibraryDatabase(dataRoot);
  let core:PersonalAssetService;
  try { core=createPersonalAssetService(db); } catch(error) { db.close();throw error; }
  return {
    ...core, source:{id:'builtin-local',name:'Local asset library',kind:'builtin'},imageMetadata:true,idempotentCreate:true,
    async close(){await core.whenIdle();db.close();},
  };
}
export function assetLibraryInfo(adapter:AssetLibraryAdapter,options:AssetLibraryOptions):AssetLibraryInfo {
  return {
    apiVersion:1,source:adapter.source,
    capabilities:{list:true,read:true,create:true,upload:true,folders:true,spaces:true,metadata:true,versions:true,batch:true,content:true,uses:true,export:true,imageMetadata:adapter.imageMetadata,projectImport:true,projectSave:true,analysis:Boolean(options.analysis),catalogue:Boolean(options.catalogue),idempotentCreate:adapter.idempotentCreate},
    limits:{uploadBytes:200*1024*1024,textBytes:4*1024*1024,batchAssets:500,exportBytes:500*1024*1024},deletion:'permanent',
  };
}
