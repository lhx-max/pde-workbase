// @vitest-environment jsdom
import React from 'react';
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FileWorkspace} from '../src/components/FileWorkspace';

const mocks=vi.hoisted(()=>({
  t:(key:string)=>key,
  submit:vi.fn(),persist:vi.fn(),
  launcher:undefined as unknown as {actions:{id:string;run:(ctx:unknown)=>void}[];launcherContext:{openAppTab?:(app:{appId:string;name:string;endpoint:string})=>void;openTab?:(id:string)=>void}},
  workspace:undefined as unknown as {nodeCreationRequest?:unknown},
  surface:undefined as unknown as {tab:{id:string;appId:string;target?:string};app?:{appId:string}} | undefined,
  tabsByProject:{} as Record<string,{tabs:string[];active:string|null;appTabs:{id:string;appId:string;target?:string;label:string}[]}>,
  createGate:undefined as Promise<void> | undefined,
}));

vi.mock('../src/i18n',()=>({useT:()=>mocks.t,useI18n:()=>({t:mocks.t,locale:'en'})}));
vi.mock('@bezier/canvas-workbench',()=>({clipEditorTabId:(id:string)=>`clip:${id}`,clipNodeIdFromTab:()=>null,createCanvasTaskSubmitter:()=>({submit:mocks.submit,dispose:vi.fn(),recover:vi.fn()}),flushCanvasForProject:vi.fn()}));
vi.mock('../src/providers/registry',()=>({fetchProjectFiles:vi.fn().mockResolvedValue([]),projectFileUrl:vi.fn(),requestJson:vi.fn().mockResolvedValue({available:false}),deleteProjectFile:vi.fn(),fetchProjectFileText:vi.fn(),renameProjectFile:vi.fn(),uploadProjectFiles:vi.fn(),writeProjectTextFile:vi.fn(),WorkspaceApiError:class extends Error{}}));
vi.mock('../src/state/workspace-tabs',()=>({loadTabs:vi.fn(async(projectId:string)=>({...(mocks.tabsByProject[projectId]??{tabs:[],active:'__design_files__',appTabs:[]})})),cacheTabs:(_id:string,tabs:any)=>tabs,persistTabs:(...args:any[])=>mocks.persist(...args),moveWorkspaceTab:vi.fn(),updateBrowserTabInfo:vi.fn()}));
vi.mock('../src/components/HtmlViewer',()=>({IframeKeepAliveProvider:({children}:any)=>children,createManualEditRetention:()=>({protectedFiles:()=>new Set(),isProtected:()=>false,settleAll:async()=>true,settle:async()=>true})}));
// The app-surfaces module is isolated so this suite verifies the create flow
// regardless of whether the surface package is installed yet.
vi.mock('../src/app-surfaces',()=>({
  AppTabSurface:(props:any)=>{mocks.surface=props;return <div data-testid={`app-surface-${props.tab.appId}`}/>;},
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

function stubApi(create?:{calls:number}){
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=typeof input==='string'?input:input instanceof Request?input.url:input.href;
    calls.push(`${init?.method??'GET'} ${url}`);
    if(url==='/api/apps')return Response.json({data:{apps:[BROWSER_APP]}});
    if(url==='/api/apps/browser/actions/browser.create'){
      if(create)create.calls+=1;
      if(mocks.createGate)await mocks.createGate;
      return Response.json({data:{instanceId:'b-1',name:'浏览器'}});}
    if(url.startsWith('/api/apps/canvas/'))return Response.json({data:{bindings:[]}});
    return Response.json({error:{message:'unhandled '+url}},{status:404});
  }));
  return calls;
}

beforeEach(()=>{
  mocks.submit.mockReset().mockResolvedValue(undefined);
  mocks.persist.mockReset().mockResolvedValue(undefined);
  mocks.tabsByProject={};
  mocks.createGate=undefined;
  mocks.surface=undefined;
  Element.prototype.scrollIntoView=vi.fn();
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

async function mount(projectId='p'){
  const view=render(<FileWorkspace projectId={projectId} ports={{onSubmitAgentTask:mocks.submit}}/>);
  await screen.findByTestId('canvas');
  await waitFor(()=>expect(mocks.launcher?.actions?.some(a=>a.id==='app:browser')).toBe(true));
  return view;
}
async function clickBrowser(){const action=mocks.launcher.actions.find(a=>a.id==='app:browser')!;await act(async()=>{action.run(mocks.launcher.launcherContext);await Promise.resolve();});}

describe('browser app tab creation',()=>{
  it('creates a standalone instance from the + menu — one browser.create, no canvas card',async()=>{
    const create={calls:0};
    const calls=stubApi(create);
    await mount();
    const action=mocks.launcher.actions.find(a=>a.id==='app:browser')!;
    await clickBrowser();
    await waitFor(()=>expect(mocks.surface?.tab?.target).toBe('b-1'));
    expect(create.calls).toBe(1);
    expect(calls.filter(c=>c.endsWith('/api/apps/browser/actions/browser.create'))).toHaveLength(1);
    // No canvas node creation was ever requested — the tab is card-free.
    expect(mocks.workspace?.nodeCreationRequest).toBeFalsy();
    expect(mocks.surface?.tab).toMatchObject({id:'app:browser:b-1',appId:'browser',target:'b-1'});
    expect(mocks.persist).toHaveBeenCalledWith('p',expect.objectContaining({appTabs:expect.arrayContaining([expect.objectContaining({id:'app:browser:b-1',target:'b-1'})])}),undefined);
    // browser.create carries only name + host context — never a nodeId.
    const createCall=(vi.mocked(fetch).mock.calls.find(c=>String(c[0]).endsWith('/actions/browser.create'))??[])[1] as RequestInit;
    expect(JSON.parse(String(createCall.body))).toMatchObject({input:{name:'浏览器',canvasId:'p'}});
    expect(JSON.parse(String(createCall.body)).input).not.toHaveProperty('nodeId');
  });
  it('restores the same instance from a persisted tab without calling create',async()=>{
    const create={calls:0};
    stubApi(create);
    mocks.tabsByProject.p={tabs:['app:browser:b-1'],active:'app:browser:b-1',appTabs:[{id:'app:browser:b-1',appId:'browser',target:'b-1',label:'浏览器'}]};
    await mount();
    await waitFor(()=>expect(mocks.surface?.tab?.target).toBe('b-1'));
    expect(create.calls).toBe(0);
  });
  it('reactivating an existing tab keeps the same target — no re-create',async()=>{
    const create={calls:0};
    stubApi(create);
    mocks.tabsByProject.p={tabs:['app:browser:b-1'],active:'__design_files__',appTabs:[{id:'app:browser:b-1',appId:'browser',target:'b-1',label:'浏览器'}]};
    await mount();
    await act(async()=>{mocks.launcher.launcherContext.openTab?.('app:browser:b-1');});
    await waitFor(()=>expect(mocks.persist).toHaveBeenCalledWith('p',expect.objectContaining({active:'app:browser:b-1'}),undefined));
    expect(create.calls).toBe(0);
  });
});

describe('browser app tab reuse',()=>{
  it('does not mistake a malformed tab without a target for a usable instance',async()=>{
    const create={calls:0};
    stubApi(create);
    mocks.tabsByProject.p={tabs:['app:browser:broken'],active:'__design_files__',appTabs:[{id:'app:browser:broken',appId:'browser',label:'浏览器'}]};
    await mount();
    await clickBrowser();
    await waitFor(()=>expect(mocks.surface?.tab?.target).toBe('b-1'));
    expect(create.calls).toBe(1);
  });
  it('a second + activates the existing tab — exactly one create, same target',async()=>{
    const create={calls:0};
    stubApi(create);
    const view=await mount();
    await clickBrowser();
    await waitFor(()=>expect(mocks.surface?.tab?.target).toBe('b-1'));
    await act(async()=>{mocks.launcher.launcherContext.openTab?.('__design_files__');});
    await waitFor(()=>expect(view.container.querySelector('[title="browser · b-1"]')).not.toBeNull());
    await clickBrowser();
    expect(create.calls).toBe(1);
    await waitFor(()=>expect(mocks.persist).toHaveBeenCalledWith('p',expect.objectContaining({active:'app:browser:b-1'}),undefined));
    expect(mocks.surface?.tab).toMatchObject({id:'app:browser:b-1',target:'b-1'});
  });
  it('a second + during pending focuses the pending tab without another API call',async()=>{
    const create={calls:0};
    stubApi(create);
    let release!:()=>void;
    mocks.createGate=new Promise<void>(r=>{release=r;});
    const view=await mount();
    await clickBrowser();
    // browser.create is still in flight; the pending tab is already active.
    await waitFor(()=>expect(view.container.querySelector('[data-testid="app-surface-browser"]')).not.toBeNull());
    const pendingId=mocks.surface!.tab.id;
    expect(pendingId).toContain('app:browser:pending:');
    // The reuse path must not wait on the hanging create — this click
    // activates synchronously and never issues a second create.
    await clickBrowser();
    expect(create.calls).toBe(1);
    expect(mocks.surface!.tab.id).toBe(pendingId);
    await act(async()=>{release();});
    await waitFor(()=>expect(mocks.surface?.tab?.target).toBe('b-1'));
  });
  it('a closed browser tab can be created again',async()=>{
    const create={calls:0};
    stubApi(create);
    const view=await mount();
    await clickBrowser();
    await waitFor(()=>expect(mocks.surface?.tab?.target).toBe('b-1'));
    const close=view.container.querySelector('[title="browser · b-1"] .ws-tab-close');
    expect(close).not.toBeNull();
    await act(async()=>{(close as HTMLElement).click();});
    await waitFor(()=>expect(view.container.querySelector('[title="browser · b-1"]')).toBeNull());
    await clickBrowser();
    await waitFor(()=>expect(create.calls).toBe(2));
    await waitFor(()=>expect(mocks.surface?.tab?.target).toBe('b-1'));
  });
  it('a different project never borrows this workspace’s browser tab',async()=>{
    const create={calls:0};
    stubApi(create);
    const first=await mount('p');
    await clickBrowser();
    await waitFor(()=>expect(mocks.surface?.tab?.target).toBe('b-1'));
    first.unmount();
    // project q loads its own (empty) tabs — the p browser is out of scope.
    await mount('q');
    await clickBrowser();
    await waitFor(()=>expect(create.calls).toBe(2));
    await waitFor(()=>expect(mocks.persist).toHaveBeenCalledWith('q',expect.objectContaining({appTabs:expect.arrayContaining([expect.objectContaining({appId:'browser'})])}),undefined));
  });
});
