import {CloudStateError} from './errors.js';
import type {AppwriteStateClient} from './port.js';

/** Read-only deployment preflight. Never repairs or broadens somebody's ACLs. */
export async function assertPrivateAppwriteStorage(options:{client:AppwriteStateClient;databaseId:string;collectionIds:readonly string[];bucketId:string}):Promise<void>{
 const id=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,35}$/;
 if(!options?.client||!id.test(options.databaseId)||!id.test(options.bucketId)||!options.collectionIds?.length||options.collectionIds.some(value=>!id.test(value)))throw new CloudStateError(503,'CLOUD_STORAGE_NOT_CONFIGURED','Explicit private database, collections and bucket are required');
 const routes=[...new Set(options.collectionIds)].map(collection=>`/databases/${encodeURIComponent(options.databaseId)}/collections/${encodeURIComponent(collection)}`);
 const resources=await Promise.allSettled([...routes,`/storage/buckets/${encodeURIComponent(options.bucketId)}`].map(route=>options.client.call<unknown>('GET',route)));
 if(resources.some(result=>result.status==='rejected'))throw new CloudStateError(503,'CLOUD_STORAGE_UNAVAILABLE','Private storage metadata could not be verified');
 for(let index=0;index<resources.length;index++){
  const result=resources[index]!;
  if(result.status!=='fulfilled')continue;
  const row=result.value as {$permissions?:unknown;documentSecurity?:unknown;fileSecurity?:unknown}|null;
  const security=index<routes.length?row?.documentSecurity:row?.fileSecurity;
  if(!row||typeof row!=='object'||Array.isArray(row)||security!==true||!Array.isArray(row.$permissions)||row.$permissions.length!==0)throw new CloudStateError(503,'CLOUD_STORAGE_NOT_PRIVATE','Storage requires private per-document and per-file access with no collection or bucket grants');
 }
}
