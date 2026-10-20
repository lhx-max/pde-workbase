// @vitest-environment jsdom
import {act,cleanup,render,screen,fireEvent} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FileWorkspace} from '../src/components/FileWorkspace';
import {OPEN_ASSET_LIBRARY_EVENT} from '../src/state/asset-library-navigation';
import {OPEN_COLLECTOR_TAB_EVENT} from '../src/components/browser-collector-tools';
const mocks=vi.hoisted(()=>({t:(key:string)=>key,browser:{} as any,sidebar:{} as any,submit:vi.fn(),persist:vi.fn()}));
vi.mock('../src/i18n',()=>({useT:()=>mocks.t,useI18n:()=>({t:mocks.t,locale:'en'})}));
vi.mock('@bezier/canvas-workbench',()=>({clipEditorTabId:(id:string)=>`clip:${id}`,clipNodeIdFromTab:()=>null,createCanvasTaskSubmitter:()=>({submit:mocks.submit,dispose:vi.fn(),recover:vi.fn()})}));
vi.mock('../src/providers/registry',()=>({fetchProjectFiles:vi.fn().mockResolvedValue([]),projectFileUrl:vi.fn(),requestJson:vi.fn().mockResolvedValue({available:false,reason:'MF_NOT_CONFIGURED',uiPath:'/mf-ui/',capabilities:{chat:false,webMcp:false,artifacts:false}}),deleteProjectFile:vi.fn(),fetchProjectFileText:vi.fn(),renameProjectFile:vi.fn(),uploadProjectFiles:vi.fn(),writeProjectTextFile:vi.fn(),WorkspaceApiError:class extends Error{}}));
vi.mock('../src/state/workspace-tabs',()=>({loadTabs:vi.fn().mockResolvedValue({tabs:['__browser__:one'],active:'__browser__:one',browserTabs:[{id:'__browser__:one',label:'Browser',url:'https://first.test/'}]}),cacheTabs:(_id:string,tabs:any)=>tabs,persistTabs:(...args:any[])=>mocks.persist(...args),moveWorkspaceTab:vi.fn(),updateBrowserTabInfo:vi.fn()}));
vi.mock('../src/components/HtmlViewer',()=>({IframeKeepAliveProvider:({children}:any)=>children,createManualEditRetention:()=>({protectedFiles:()=>new Set(),isProtected:()=>false,settleAll:async()=>true,settle:async()=>true})}));
vi.mock('../src/components/DesignBrowserPanel',()=>({DesignBrowserPanel:(props:any)=>{mocks.browser=props;return <div data-testid="browser">{props.initialUrl}</div>;}}));
vi.mock('../src/components/CanvasAssetsSidebar',()=>({CanvasAssetsSidebar:(props:any)=>{mocks.sidebar=props;return <div data-testid="sidebar"/>;}}));
vi.mock('../src/components/AssetLibraryBrowser',()=>({AssetLibraryBrowser:()=> <div data-testid="full-library"/>}));
vi.mock('../src/components/SaveAssetDialog',()=>({SaveAssetDialogHost:()=> <div data-testid="save-host"/>}));
vi.mock('../src/components/BrowserExtensionCaptureHost',()=>({BrowserExtensionCaptureHost:()=> <div data-testid="capture-host"/>}));
vi.mock('../src/components/WorkspaceReferenceTray',()=>({WorkspaceReferenceTray:({references}:any)=> <output data-testid="references">{references.map((item:any)=>item.path).join(',')}</output>}));
vi.mock('../src/components/workspace/CanvasWorkspace',()=>({CanvasWorkspace:()=>null}));
vi.mock('../src/components/workspace/CanvasSketchCard',()=>({CanvasSketchCard:()=>null}));
vi.mock('../src/components/workspace/SketchWorkspaceTab',()=>({SketchWorkspaceTab:()=>null}));
vi.mock('../src/components/SketchEnginePrewarm',()=>({SketchEnginePrewarm:()=>null}));
vi.mock('../src/components/workspace/TabLauncherMenu',()=>({TabLauncherMenu:()=>null}));
vi.mock('../src/components/FileViewer',()=>({FileViewer:()=>null}));
vi.mock('../src/components/QuickSwitcher',()=>({QuickSwitcher:()=>null}));
const attachment={path:'collected/reference.png',name:'Reference',mime:'image/png'};
beforeEach(()=>{mocks.submit.mockReset().mockResolvedValue(undefined);mocks.persist.mockReset().mockResolvedValue(undefined);Element.prototype.scrollIntoView=vi.fn();});
afterEach(()=>cleanup());
async function mount(ports:any={}){const view=render(<FileWorkspace projectId="p" ports={{onSubmitAgentTask:mocks.submit,...ports}}/>);await screen.findByTestId('browser');return view;}
describe('workspace catalogue and neutral reference integration',()=>{
 it('queues a browser image without submitting an agent task',async()=>{await mount();await act(async()=>{await mocks.browser.onAddImageToChat(attachment);});expect(screen.getByTestId('references').textContent).toBe(attachment.path);expect(mocks.submit).not.toHaveBeenCalled();expect(screen.getAllByTestId('save-host')).toHaveLength(1);expect(screen.getAllByTestId('capture-host')).toHaveLength(1);});
 it('includes queued references only on the next explicit task and clears them after acceptance',async()=>{await mount();await act(async()=>mocks.browser.onAddImageToChat(attachment));expect(mocks.submit).not.toHaveBeenCalled();await act(async()=>mocks.browser.onExtractPage({url:'https://reference.test',title:'Reference'}));expect(mocks.submit).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({inputPaths:[attachment.path],executionContext:expect.objectContaining({skillIds:['page-recreation']})}),undefined);expect(screen.getByTestId('references').textContent).toBe('');});
 it('retains staged references when an explicit task is rejected',async()=>{await mount();await act(async()=>mocks.browser.onAddImageToChat(attachment));mocks.submit.mockRejectedValueOnce(new Error('Task rejected'));await expect(mocks.browser.onExtractPage({url:'https://reference.test',title:'Reference'})).rejects.toThrow('Task rejected');expect(screen.getByTestId('references').textContent).toBe(attachment.path);});
 it('awaits host acceptance and propagates staging failures without auto-running',async()=>{const stage=vi.fn().mockRejectedValue(new Error('Draft is closed'));await mount({onStageReference:stage});await expect(mocks.browser.onAddImageToChat(attachment)).rejects.toThrow('Draft is closed');expect(stage).toHaveBeenCalledWith(attachment);expect(screen.getByTestId('references').textContent).toBe('');expect(mocks.submit).not.toHaveBeenCalled();});
 it('routes a collector maximize event into a persisted browser tab',async()=>{await mount();await act(async()=>window.dispatchEvent(new CustomEvent(OPEN_COLLECTOR_TAB_EVENT,{detail:{projectId:'p',url:'https://captured.test/path'}})));expect(screen.getAllByTestId('browser').some(node=>node.textContent==='https://captured.test/path')).toBe(true);expect(mocks.persist).toHaveBeenCalledWith('p',expect.objectContaining({browserTabs:expect.arrayContaining([expect.objectContaining({url:'https://captured.test/path'})])}),undefined);});
 it('opens the library at the requested scope and cancels a stale picker on close',async()=>{await mount();const controller=new AbortController();await act(async()=>window.dispatchEvent(new CustomEvent(OPEN_ASSET_LIBRARY_EVENT,{detail:{projectId:'p',spaceId:'brand',kind:'text',selection:{controller,onSelect:vi.fn()}}})));expect(mocks.sidebar.openRequest).toMatchObject({spaceId:'brand',kind:'text'});expect(mocks.sidebar.active).toBe(true);act(()=>mocks.sidebar.onClose());expect(controller.signal.aborted).toBe(true);});
 it('opens the complete catalogue via the sidebar expansion callback',async()=>{await mount();await act(async()=>mocks.sidebar.onOpenAssetLibrary({spaceId:'brand',kind:'image',full:true}));expect(screen.getByTestId('full-library')).toBeTruthy();expect(mocks.submit).not.toHaveBeenCalled();});
});
