import { createContext, useContext, useState, type ReactNode } from 'react';
import type { AgentInfo, CloudflarePagesDeploySelection, CloudflarePagesZonesResponse, DeployConfigResponse, DeployProjectFileResponse, ProjectDeploymentsResponse, SocialShareRequest, SocialShareResponse, UpdateDeployConfigRequest, WorkspaceCollabContext } from '@bezier/contracts';
import type { TrackingArtifactKind } from '@bezier/contracts/analytics';
import { Button } from '../ui';
import { Icon } from '../Icon';
import { useT } from '../../i18n';

export const DEFAULT_DEPLOY_PROVIDER_ID = 'vercel-self';
export const CLOUDFLARE_PAGES_PROVIDER_ID = 'cloudflare-pages';
export type WebDeployProviderId = typeof DEFAULT_DEPLOY_PROVIDER_ID | typeof CLOUDFLARE_PAGES_PROVIDER_ID;
export type WebDeployConfigResponse = DeployConfigResponse;
export type WebUpdateDeployConfigRequest = UpdateDeployConfigRequest;
export type WebDeploymentInfo = ProjectDeploymentsResponse['deployments'][number];
export type WebDeployProjectFileResponse = DeployProjectFileResponse;
export type WebCloudflarePagesDeploySelection = CloudflarePagesDeploySelection;
type Scope = WorkspaceCollabContext | null;
type Publication = {url:string;slug:string;fileName:string};
export interface HandoffRequest {projectId:string;projectName?:string;projectDir?:string|null;agents?:AgentInfo[];artifactId?:string;artifactKind?:TrackingArtifactKind;metricsConsent?:boolean;installationId?:string|null}
/** Optional host capabilities. No product service is contacted by this extraction. */
export interface HtmlViewerAdapters {
 fetchDeployConfig?: (providerId?:WebDeployProviderId)=>Promise<WebDeployConfigResponse|null>;
 updateDeployConfig?: (input:WebUpdateDeployConfigRequest)=>Promise<WebDeployConfigResponse|null>;
 fetchCloudflarePagesZones?: ()=>Promise<CloudflarePagesZonesResponse|null>;
 fetchProjectDeployments?: (projectId:string,scope?:Scope)=>Promise<WebDeploymentInfo[]>;
 deployProjectFile?: (projectId:string,fileName:string,providerId?:WebDeployProviderId,selection?:WebCloudflarePagesDeploySelection,target?:'preview'|'production',scope?:Scope)=>Promise<WebDeployProjectFileResponse>;
 checkDeploymentLink?: (projectId:string,deploymentId:string,scope?:Scope)=>Promise<WebDeployProjectFileResponse>;
 fetchProjectFilePublicPublication?: (projectId:string,fileName:string,scope?:Scope)=>Promise<Publication|null>;
 publishProjectFilePublic?: (projectId:string,fileName:string,scope?:Scope)=>Promise<Publication>;
 unpublishProjectFilePublic?: (projectId:string,fileName:string,slug:string,scope?:Scope)=>Promise<{ok:true;slug:string;fileName:string}>;
 createSocialSharePayload?: (input:SocialShareRequest)=>Promise<SocialShareResponse>;
 saveTemplate?: (input:{name:string;description?:string;sourceProjectId:string})=>Promise<{name:string}|null>;
 saveProjectAsset?: (input:{projectId:string;filename:string;workspaceContext?:Scope})=>Promise<void>;
 handoff?: (input:HandoffRequest)=>Promise<void>;
}
import { resolveHtmlViewerAdapters } from './capabilities';
export { HtmlViewerCapabilityUnavailable, resolveHtmlViewerAdapters } from './capabilities';
const Context=createContext<HtmlViewerAdapters>({});
export function HtmlViewerAdapterProvider({adapters={},children}:{adapters?:HtmlViewerAdapters;children:ReactNode}) {return <Context.Provider value={adapters}>{children}</Context.Provider>;}
export function useHtmlViewerAdapters(){const configured=useContext(Context);return {configured,...resolveHtmlViewerAdaptersObject(configured)};}
function resolveHtmlViewerAdaptersObject(adapters:HtmlViewerAdapters){const resolved=resolveHtmlViewerAdapters(adapters);return {fetchDeployConfig:resolved.fetchDeployConfig,updateDeployConfig:resolved.updateDeployConfig,fetchCloudflarePagesZones:resolved.fetchCloudflarePagesZones,fetchProjectDeployments:resolved.fetchProjectDeployments,deployProjectFile:resolved.deployProjectFile,checkDeploymentLink:resolved.checkDeploymentLink,fetchProjectFilePublicPublication:resolved.fetchProjectFilePublicPublication,publishProjectFilePublic:resolved.publishProjectFilePublic,unpublishProjectFilePublic:resolved.unpublishProjectFilePublic,createSocialSharePayload:resolved.createSocialSharePayload,saveTemplate:resolved.saveTemplate};}
// Original SaveProjectAssetButton markup; only the persistence boundary changed.
export function SaveProjectAssetButton({projectId,filename,workspaceContext,disabled}:{projectId:string;filename:string;workspaceContext?:Scope;disabled?:boolean}) {
 const adapters=useContext(Context); const t=useT();
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const label=t('asset.save.label');
 return <><Button variant="ghost" className="chrome-action chrome-action-secondary chrome-action-icon bezier-tooltip" disabled={disabled||busy} aria-label={label} aria-busy={busy} data-tooltip={status||label} data-tooltip-placement="bottom" title={status||label} onClick={()=>{
 setBusy(true);setStatus('');void resolveHtmlViewerAdapters(adapters).saveProjectAsset({projectId,filename,workspaceContext}).then(()=>setStatus(t('asset.save.saved'))).catch(error=>setStatus(error instanceof Error?error.message:t('asset.save.failed'))).finally(()=>setBusy(false));
 }}><Icon name={busy?'spinner':'folder'} size={15} className={busy?'icon-spin':undefined}/></Button>{status&&<span className="sr-only" role="status">{status}</span>}</>;
}
/** Handoff rendering belongs to the embedding host; retained original action location. */
export function HandoffButton(props:HandoffRequest){
 const adapters=useContext(Context);const t=useT();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const label=t('handoff.chooseTargetAria');
 return <div className="handoff-wrap handoff-wrap--solo" data-testid="handoff-wrap">
  <Button type="button" className="handoff-trigger handoff-trigger--solo bezier-tooltip" title={error||label} data-tooltip={error||label} data-tooltip-placement="bottom" disabled={busy} onClick={async()=>{setError('');setBusy(true);try{await resolveHtmlViewerAdapters(adapters).handoff(props);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}}>
   <Icon name={busy?'spinner':'folder'} size={20}/><span className="handoff-trigger-label">{label}</span>
  </Button>{error?<div className="handoff-menu-error" role="alert" data-testid="handoff-fallback-error">{error}</div>:null}
 </div>;
}
export type PublicFilePublishFailureKey='fileViewer.publishFileFailed';
export function publicFilePublishFailureKey(_error:unknown):PublicFilePublishFailureKey{return 'fileViewer.publishFileFailed';}
export function CenteredLoader({label}:{label?:string}){return <div className="centered-loader" role="status" aria-live="polite"><Icon name="spinner" size={24}/>{label?<span className="centered-loader-label">{label}</span>:null}</div>;}
