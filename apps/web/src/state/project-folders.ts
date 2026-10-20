import {tActive} from '../i18n';
import {getActiveAssetLibraryAdapter,getAssetLibrarySourceId} from '../providers/asset-library';

/** Original space-picker cache/outbox, scoped to the selected independent source. */
export interface ProjectFolderGroup {id:string;name:string;createdAt:number}
export const PROJECT_FOLDERS_CHANGED_EVENT='bezier:project-folders-changed';
export const DEFAULT_PROJECT_FOLDER_ID='default-project';
export const DEFAULT_PROJECT_FOLDER_NAME='Default space';
export const DEFAULT_PROJECT_FOLDER:ProjectFolderGroup={id:DEFAULT_PROJECT_FOLDER_ID,name:DEFAULT_PROJECT_FOLDER_NAME,createdAt:0};
type Change={upsert:ProjectFolderGroup[];remove:string[]};
const syncing=new Map<string,Promise<void>>();
const sourceNamespaces=new WeakMap<object,string>();
function key(scope:string,source=sourceNamespaces.get(getActiveAssetLibraryAdapter())||`${getAssetLibrarySourceId()}:unresolved`){return `canvas-workspace:asset-spaces:${source}:${scope||'local'}`;}
function valid(value:unknown):value is ProjectFolderGroup{const row=value as ProjectFolderGroup;return !!row&&typeof row.id==='string'&&!!row.id&&typeof row.name==='string'&&!!row.name.trim()&&Number.isFinite(row.createdAt);}
function cached(storageKey:string):ProjectFolderGroup[]{try{const value=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(value)?value.filter(valid):[];}catch{return [];}}
export async function syncProjectFolders(scope='local'):Promise<void>{
 if(typeof window==='undefined')return;
 const adapter=getActiveAssetLibraryAdapter(),slot=getAssetLibrarySourceId();
 const info=await adapter.info();
 const namespace=`${slot}:${info.source.kind}:${info.source.id}`;
 sourceNamespaces.set(adapter,namespace);
 const storageKey=key(scope,namespace);const pendingKey=`${storageKey}:pending`;
 const pending=syncing.get(storageKey);if(pending)return pending;
 const read=adapter.spaces.bind(adapter),patch=adapter.patchSpaces.bind(adapter);
 const task=(async()=>{try{
  let remote=await read(scope);if(!Array.isArray(remote.folders)||!remote.folders.every(valid))throw new Error(tActive('space.error.invalid'));
  const encoded=localStorage.getItem(pendingKey);
  if(encoded){const change=JSON.parse(encoded) as Change;remote=await patch(scope,change);if(localStorage.getItem(pendingKey)===encoded)localStorage.removeItem(pendingKey);}
  if(!localStorage.getItem(pendingKey)){const next=JSON.stringify(remote.folders);if(localStorage.getItem(storageKey)!==next){localStorage.setItem(storageKey,next);window.dispatchEvent(new CustomEvent(PROJECT_FOLDERS_CHANGED_EVENT,{detail:{scope}}));}}
 }finally{syncing.delete(storageKey);}})();
 syncing.set(storageKey,task);return task;
}
export function readProjectFolders(scope='local',_projects:unknown[]=[]):ProjectFolderGroup[]{
 const rows=typeof window==='undefined'?[]:cached(key(scope));
 return [{...DEFAULT_PROJECT_FOLDER,name:tActive('entry.personalAssets.meta.defaultSpace')},...rows.filter(row=>row.id!==DEFAULT_PROJECT_FOLDER_ID).sort((a,b)=>b.createdAt-a.createdAt)];
}
export function writeProjectFolders(scope:string,folders:ProjectFolderGroup[]):void{
 if(typeof window==='undefined')return;
 if(!sourceNamespaces.has(getActiveAssetLibraryAdapter()))throw new Error(tActive('space.error.unavailable'));
 const storageKey=key(scope),previous=cached(storageKey),next=folders.filter(folder=>folder.id!==DEFAULT_PROJECT_FOLDER_ID),pendingKey=`${storageKey}:pending`;
 let pending:Change={upsert:[],remove:[]};try{pending=JSON.parse(localStorage.getItem(pendingKey)||JSON.stringify(pending));}catch{/* keep fresh outbox */}
 const upsert=new Map(pending.upsert.map(row=>[row.id,row])),remove=new Set(pending.remove);
 for(const row of next)if(JSON.stringify(row)!==JSON.stringify(previous.find(old=>old.id===row.id))){upsert.set(row.id,row);remove.delete(row.id);}
 for(const row of previous)if(!next.some(item=>item.id===row.id)){upsert.delete(row.id);remove.add(row.id);}
 localStorage.setItem(pendingKey,JSON.stringify({upsert:[...upsert.values()],remove:[...remove]}));localStorage.setItem(storageKey,JSON.stringify(next));
 window.dispatchEvent(new CustomEvent(PROJECT_FOLDERS_CHANGED_EVENT,{detail:{scope}}));void syncProjectFolders(scope).catch(()=>{/* durable outbox retries on next sync */});
}
export function readSelectedProjectFolderId(scope='local'):string|null{try{return localStorage.getItem(`${key(scope)}:selected`)||DEFAULT_PROJECT_FOLDER_ID;}catch{return DEFAULT_PROJECT_FOLDER_ID;}}
export function writeSelectedProjectFolderId(scope:string,id:string|null):void{try{localStorage.setItem(`${key(scope)}:selected`,id||DEFAULT_PROJECT_FOLDER_ID);}catch{/* private storage */}}
