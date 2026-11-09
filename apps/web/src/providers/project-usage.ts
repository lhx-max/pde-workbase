import type { WorkspaceCollabContext } from '@bezier/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
/** A real download of project bytes; no library/global usage-tracking dependency. */
export async function downloadProjectResource(_projectId:string,input:{url:string;fileName:string;nodeId?:string},context?:WorkspaceCollabContext|null):Promise<void> {
 const response=await fetch(input.url,{headers:context?workspaceProjectHeaders(context):undefined});
 if(!response.ok)throw new Error(`Download failed (${response.status})`);
 const objectUrl=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=objectUrl;link.download=input.fileName;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
}
