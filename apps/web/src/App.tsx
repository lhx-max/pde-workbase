'use client';
import { useEffect,useState } from 'react';
import { FileWorkspace,type WorkspacePorts } from './components/FileWorkspace';
import { I18nProvider,useT,tActive } from './i18n';
import { localizeApiMessage } from './i18n/api-errors';
import { getWebProductName } from './product-runtime';
import { ProjectCollabProvider } from './collab/collab-context';
import { requestJson } from './providers/registry';
import { Button } from './components/ui';
import { TooltipLayer } from './components/TooltipLayer';
export default function App({projectId,ports}:{projectId?:string;ports?:WorkspacePorts}) {return <I18nProvider><ProjectCollabProvider workspaceContext={ports?.workspaceContext}><WorkspaceApp projectId={projectId} ports={ports}/><TooltipLayer/></ProjectCollabProvider></I18nProvider>;}
function WorkspaceApp({projectId:injected,ports}:{projectId?:string;ports?:WorkspacePorts}) {
 const t=useT();const [project,setProject]=useState<{id:string;name?:string}|null>(null);const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);
 useEffect(()=>{let alive=true;const load=async()=>{const id=injected||new URLSearchParams(location.search).get('projectId');if(id){const response=await requestJson<{project?:{id:string;name?:string};id?:string;name?:string}>(`/api/projects/${encodeURIComponent(id)}`);if(alive)setProject(response.project||{id,name:response.name});return;}
 const response=await requestJson<{projects:{id:string;name?:string}[]}>('/api/projects');let selected=response.projects[0];if(!selected){const created=await requestJson<{project:{id:string;name?:string}}>('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:getWebProductName()})});selected=created.project;}
 if(!selected?.id)throw new Error('Project response is missing its id');if(alive){history.replaceState(null,'',`?projectId=${encodeURIComponent(selected.id)}`);setProject(selected);}};void load().catch(cause=>{if(alive)setError(localizeApiMessage(cause?.message,tActive('api.error.generic'),{code:cause?.code,status:cause?.status}));});return()=>{alive=false;};},[injected,attempt]);
 return <main className="standalone-workspace-root" data-project-chrome>{project?<FileWorkspace key={project.id} projectId={project.id} projectName={project.name} ports={ports}/>:<div className="viewer-empty" role={error?'alert':undefined}>{error||t('fileViewer.loading')}{error&&<Button onClick={()=>{setError('');setAttempt(value=>value+1);}}>{t('common.retry')}</Button>}</div>}</main>;
}
