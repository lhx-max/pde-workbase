// @vitest-environment jsdom
// Regression: a failed browser.create must remove the pending tab and show the
// error — the real UI was left on "正在准备浏览器" forever. Uses the REAL
// workspace-tabs module (normalizeTabs/cacheTabs/persistTabs), not a stub.
import React from 'react';
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FileWorkspace} from '../src/components/FileWorkspace';
import {normalizeTabs} from '../src/state/workspace-tabs';

const mocks=vi.hoisted(()=>({
  t:(key:string)=>key,
  submit:vi.fn(),
  launcher:undefined as unknown as {actions:{id:string;run:(ctx:unknown)=>void}[];launcherContext:{openAppTab?:(app:{appId:string;name:string;endpoint:string})=>void}},
  surface:undefined as unknown as {tab:{id:string;appId:string;target?:string}} | undefined,
  workspace:undefined as unknown as {nodeCreationRequest?:unknown} | undefined,
  putBodies:[] as unknown[],
  createStatus:400 as number,
}));

vi.mock('../src/i18n',()=>({useT:()=>mocks.t,useI18n:()=>({t:mocks.t,locale:'en'})}));
vi.mock('@bezier/canvas-workbench',()=>({clipEditorTabId:(id:string)=>`clip:${id}`,clipNodeIdFromTab:()=>null,createCanvasTaskSubmitter:()=>({submit:mocks.submit,dispose:vi.fn(),recover:vi.fn()}),flushCanvasForProject:vi.fn()}));
vi.mock('../src/providers/registry',()=>({
  fetchProjectFiles:vi.fn().mockResolvedValue([]),
  projectFileUrl:vi.fn(),
  requestJson:vi.fn(async(url:string,init?:RequestInit)=>{
    if(init?.method==='PUT'&&/\/tabs$/.test(url)){mocks.putBodies.push(JSON.parse(String(init.body)));return {};}
    if(/\/tabs$/.test(url))return {tabs:[],active:null,hasSavedState:false};
    return {available:false};
  }),
  deleteProjectFile:vi.fn(),fetchProjectFileText:vi.fn(),renameProjectFile:vi.fn(),uploadProjectFiles:vi.fn(),writeProjectTextFile:vi.fn(),
  WorkspaceApiError:class extends Error{status:number;constructor(m:string,s:number){super(m);this.status=s;}},
}));
vi.mock('../src/components/HtmlViewer',()=>({IframeKeepAliveProvider:({children}:any)=>children,createManualEditRetention:()=>({protectedFiles:()=>new Set(),isProtected:()=>false,settleAll:async()=>true,settle:async()=>true})}));
vi.mock('../src/app-surfaces',()=>({
  AppTabSurface:(props:any)=>{mocks.surface=props;return <div data-testid={`app-surface-${props.tab.appId}`} data-tab-id={props.tab.id}/>;},
  createAppTab:vi.fn(async(app:any)=>({id:`app:${app.appId}:x`,appId:app.appId,label:app.name})),
  createAppDocTab:(appId:string,target:string,label:string,mirrorPath?:string)=>({id:`app:${appId}:${target}`,appId,target,label,...(mirrorPath?{mirrorPath}:{})}),
  openBoundSketch:vi.fn(),
  tenantHeaders:()=>({'x-team-id':'local','x-user-id':'local'}),
}));
vi.mock('../src/app-surfaces/CanvasDocumentSyncNotice',()=>({CanvasDocumentSyncNotice:()=>null}));
vi.mock('../src/components/DesignBrowserPanel',()=>({DesignBrowserPanel:()=>null}));
vi.mock('../src/components/CanvasAssetsSidebar',()=>({CanvasAssetsSidebar:()=>null}));
vi.mock('../src/components/AssetLibraryBrowser',()=>({AssetLibraryBrowser:()=>null}));
vi.mock('../src/components/SaveAssetDialog',()=>({SaveAssetDialogHost:()=>null}));
vi.mock('../src/components/BrowserExtensionCaptureHost',()=>({BrowserExtensionCaptureHost:()=>null}));
vi.mock('../src/components/WorkspaceReferenceTray',()=>({WorkspaceReferenceTray:()=>null}));
vi.mock('../src/components/workspace/CanvasWorkspace',()=>({CanvasWorkspace:(props:any)=>{mocks.workspace=props;return <div data-testid="canvas"/>;}}));
vi.mock('../src/components/workspace/CanvasSketchCard',()=>({CanvasSketchCard:()=>null}));
vi.mock('../src/components/workspace/SketchWorkspaceTab',()=>({SketchWorkspaceTab:()=>null}));
vi.mock('../src/components/SketchEnginePrewarm',()=>({SketchEnginePrewarm:()=>null}));
vi.mock('../src/components/workspace/TabLauncherMenu',()=>({TabLauncherMenu:(props:any)=>{mocks.launcher=props;return null;}}));
vi.mock('../src/components/FileViewer',()=>({FileViewer:()=>null}));
vi.mock('../src/components/QuickSwitcher',()=>({QuickSwitcher:()=>null}));

const BROWSER_APP={appId:'browser',name:'浏览器',endpoint:'http://127.0.0.1:17620/api/apps/browser',status:'active'};

function stubApi(mode:'400'|'throw'='400'){
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
    const url=typeof input==='string'?input:input instanceof Request?input.url:input.href;
    if(url==='/api/apps')return Response.json({data:{apps:[BROWSER_APP]}});
    if(url==='/api/apps/browser/actions/browser.create'){
      if(mode==='throw')throw new TypeError('fetch failed');
      return Response.json({error:{code:'BAD_REQUEST',message:'canvasId requires nodeId'}},{status:400});
    }
    if(url.startsWith('/api/apps/canvas/'))return Response.json({data:{bindings:[]}});
    return Response.json({error:{message:'unhandled '+url}},{status:404});
  }));
}

beforeEach(()=>{
  mocks.submit.mockReset().mockResolvedValue(undefined);
  mocks.putBodies.length=0;
  mocks.surface=undefined;
  localStorage.clear();
  Element.prototype.scrollIntoView=vi.fn();
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

async function mount(){
  const view=render(<FileWorkspace projectId="p" ports={{onSubmitAgentTask:mocks.submit}}/>);
  await screen.findByTestId('canvas');
  await waitFor(()=>expect(mocks.launcher?.actions?.some(a=>a.id==='app:browser')).toBe(true));
  return view;
}
async function clickBrowser(){const action=mocks.launcher.actions.find(a=>a.id==='app:browser')!;await act(async()=>{action.run(mocks.launcher.launcherContext);await Promise.resolve();});}

describe('browser pending-tab recovery',()=>{
  it('does not write an old create completion into a newly selected workspace',async()=>{
    stubApi();
    const previous=fetch;
    let complete!:(response:Response)=>void;
    vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>
      input==='/api/apps/browser/actions/browser.create'
        ? new Promise<Response>(resolve=>{complete=resolve;})
        : previous(input,init)));
    const view=await mount();
    await clickBrowser();
    const sourceCache=localStorage.getItem('canvas-workspace:tabs:p');
    view.rerender(<FileWorkspace projectId="other" ports={{onSubmitAgentTask:mocks.submit}}/>);
    await screen.findByTestId('canvas');
    await act(async()=>{complete(Response.json({data:{instanceId:'old-instance',name:'浏览器'}}));});
    expect(localStorage.getItem('canvas-workspace:tabs:other')??'').not.toContain('old-instance');
    expect(localStorage.getItem('canvas-workspace:tabs:p')).toBe(sourceCache);
    expect(view.container.querySelector('[title="browser · old-instance"]')).toBeNull();
  });
  it('removes the pending tab and reports the error when browser.create fails',async()=>{
    stubApi();
    const view=await mount();
    await clickBrowser();
    // The pending tab must be gone from both the tab list and appTabs — no
    // permanent "正在准备浏览器".
    await waitFor(()=>{
      const stored=normalizeTabs(JSON.parse(localStorage.getItem('canvas-workspace:tabs:p')||'null'));
      expect(stored?.tabs.some(id=>id.includes(':pending:'))??false).toBe(false);
      expect(stored?.appTabs?.some(tab=>tab.id.includes(':pending:'))??false).toBe(false);
    });
    expect(screen.queryByText(/正在准备浏览器/)).toBeNull();
    expect(view.container.querySelector('[data-tab-id*=":pending:"]')).toBeNull();
    // The failure must be visible, not silently swallowed.
    await waitFor(()=>expect(view.container.querySelector('[data-testid="upload-error-banner"],[role="alert"]')).not.toBeNull());
    // Every persisted snapshot keeps the pending id consistent — a pending
    // tab may appear transiently but the FINAL state is always clean.
    const last=mocks.putBodies.at(-1) as {tabs:string[];appTabs?:{id:string}[]}|undefined;
    expect(last?.tabs?.some(id=>id.includes(':pending:'))??false).toBe(false);
    expect(last?.appTabs?.some(tab=>tab.id.includes(':pending:'))??false).toBe(false);
  });
  it('network failure cleans up the same way',async()=>{
    stubApi('throw');
    const view=await mount();
    await clickBrowser();
    await waitFor(()=>{
      const stored=normalizeTabs(JSON.parse(localStorage.getItem('canvas-workspace:tabs:p')||'null'));
      expect(stored?.appTabs?.some(tab=>tab.id.includes(':pending:'))??false).toBe(false);
    });
    expect(view.container.querySelector('[data-tab-id*=":pending:"]')).toBeNull();
  });
  it('sweeps a stale browser pending marker on load instead of pinning the tab',async()=>{
    stubApi();
    // A dead session's pending marker in the persisted state must not
    // resurrect a permanent "正在准备浏览器" tab.
    localStorage.setItem('canvas-workspace:tabs:p',JSON.stringify({tabs:['app:browser:pending:dead-1','app:browser:b-9'],active:'app:browser:pending:dead-1',appTabs:[{id:'app:browser:pending:dead-1',appId:'browser',label:'浏览器'},{id:'app:browser:b-9',appId:'browser',target:'b-9',label:'浏览器'}],updatedAt:Date.now()}));
    const view=await mount();
    // The real browser tab survives; only the dead pending marker is gone.
    await waitFor(()=>expect(view.container.querySelector('[title="browser · b-9"]')).not.toBeNull());
    expect(view.container.querySelector('[data-tab-id*=":pending:"]')).toBeNull();
    const stored=normalizeTabs(JSON.parse(localStorage.getItem('canvas-workspace:tabs:p')||'null'));
    expect(stored?.tabs).toEqual(['app:browser:b-9']);
    expect(stored?.appTabs?.map(t=>t.id)).toEqual(['app:browser:b-9']);
  });
  it('a persisted pending tab normalizes back through the real tabs channel',()=>{
    const state=normalizeTabs({tabs:['app:browser:pending:u-1','app:browser:b-9'],active:'app:browser:pending:u-1',appTabs:[{id:'app:browser:pending:u-1',appId:'browser',label:'浏览器'},{id:'app:browser:b-9',appId:'browser',target:'b-9',label:'浏览器'}]});
    expect(state?.tabs).toEqual(['app:browser:pending:u-1','app:browser:b-9']);
    expect(state?.appTabs?.map(t=>t.id)).toEqual(['app:browser:pending:u-1','app:browser:b-9']);
  });
});
