// @vitest-environment jsdom
import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {CanvasAssetsSidebar} from '../src/components/CanvasAssetsSidebar';
import {createHttpAssetLibrary,configureAssetLibraryAdapter} from '../src/providers/asset-library';
const mocks=vi.hoisted(()=>({t:(key:string)=>key,list:vi.fn(),collect:vi.fn()}));
vi.mock('../src/i18n',()=>({useI18n:()=>({locale:'en',t:mocks.t}),useT:()=>mocks.t,tActive:mocks.t}));
vi.mock('../src/components/SketchPreview',()=>({SketchPreview:()=>null}));
vi.mock('../src/components/workspace/CanvasArtifactThumbnail',()=>({CanvasArtifactThumbnail:()=>null}));
vi.mock('../src/components/BrowserCollectorPanel',()=>({BrowserCollectorPanel:(props:any)=>{mocks.collect(props);const [value,setValue]=useState('');return <input aria-label="Collector URL" value={value} onChange={event=>setValue(event.target.value)}/>;}}));
const props={projectId:'p',files:[],onClose:vi.fn(),onRenameFile:vi.fn(),onDeleteFile:vi.fn(),onRefreshFiles:vi.fn(),onUpload:vi.fn()};
let restore:()=>void;
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});localStorage.clear();mocks.list.mockReset().mockResolvedValue({assets:[]});mocks.collect.mockClear();restore=configureAssetLibraryAdapter({...createHttpAssetLibrary(),list:mocks.list,spaces:vi.fn().mockResolvedValue({folders:[{id:'brand',name:'Brand',createdAt:1}],initialized:true}),info:vi.fn().mockResolvedValue({source:{kind:'external',id:'fixture',name:'Fixture library'},capabilities:{analysis:false,catalogue:false}})});});
afterEach(()=>{cleanup();restore();vi.unstubAllGlobals();});
describe('original three-tab sidebar',()=>{
 it('exposes distinct canvas, library, and collector entrypoints',()=>{const view=render(<CanvasAssetsSidebar {...props}/>);for(const key of ['canvas','assetsShort','collectShort'])expect(view.getByRole('tab',{name:`entry.canvasAssets.tab.${key}`})).toBeTruthy();});
 it('opens the real catalogue, retains the full type rail, and uses a real configured source',async()=>{render(<CanvasAssetsSidebar {...props}/>);fireEvent.click(screen.getByRole('tab',{name:'entry.canvasAssets.tab.assetsShort'}));await screen.findByRole('tab',{name:'Fixture library'});await waitFor(()=>expect(mocks.list).toHaveBeenCalled());for(const label of ['entry.personalAssets.kind.image','entry.canvasAssets.assetType.text','entry.personalAssets.kind.webpage','entry.personalAssets.kind.slides','entry.canvasAssets.assetType.script','entry.personalAssets.kind.motion','entry.canvasAssets.assetType.designSystems'])expect(screen.getByRole('button',{name:label})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'entry.canvasAssets.assetType.designSystems'}));expect(screen.getByText('entry.canvasAssets.emptySystems')).toBeTruthy();fireEvent.click(screen.getByRole('tab',{name:'entry.canvasAssets.tab.canvas'}));expect(screen.getByRole('textbox',{name:'entry.canvasAssets.searchFiles'})).toBeTruthy();});
 it('keeps the collector mounted and its capture state intact across tab switches',()=>{render(<CanvasAssetsSidebar {...props}/>);expect(mocks.collect).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('tab',{name:'entry.canvasAssets.tab.collectShort'}));fireEvent.change(screen.getByRole('textbox',{name:'Collector URL'}),{target:{value:'https://capture.test'}});fireEvent.click(screen.getByRole('tab',{name:'entry.canvasAssets.tab.canvas'}));expect(screen.queryByRole('textbox',{name:'Collector URL'})).toBeNull();fireEvent.click(screen.getByRole('tab',{name:'entry.canvasAssets.tab.collectShort'}));expect((screen.getByRole('textbox',{name:'Collector URL'}) as HTMLInputElement).value).toBe('https://capture.test');expect(mocks.collect.mock.lastCall?.[0]).toMatchObject({projectId:'p',onSaveToAssetSource:expect.any(Function)});});
 it('opens the requested library type for a target-owned reference picker',async()=>{const controller=new AbortController();render(<CanvasAssetsSidebar {...props} openRequest={{spaceId:'default-project',kind:'text',selection:{controller,onSelect:vi.fn()}}}/>);await screen.findByRole('tab',{name:'Fixture library'});expect(screen.getByRole('button',{name:'entry.canvasAssets.assetType.text'}).getAttribute('aria-pressed')).toBe('true');});
});

it('adds an existing image through the same canvas import contract and waits for completion',async()=>{
 const receive=vi.fn((event:Event)=>(event as CustomEvent).detail.onComplete(true));
 window.addEventListener('bezier-design:add-project-file-to-canvas',receive);
 try{
  render(<CanvasAssetsSidebar {...props} files={[{name:'outputs/photo.png',size:24,mtime:1,kind:'image',mime:'image/png'}]}/>);
  fireEvent.click(screen.getByRole('button',{name:'entry.canvasAssets.moreActionsAria'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'entry.canvasAssets.addToCanvas'}));
  await screen.findByText('entry.canvasAssets.addedToCanvas');
  expect(receive).toHaveBeenCalledTimes(1);
  expect((receive.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({projectId:'p',name:'outputs/photo.png',kind:'image'});
 }finally{window.removeEventListener('bezier-design:add-project-file-to-canvas',receive);}
});
it('reports a rejected canvas import instead of showing success',async()=>{
 const receive=(event:Event)=>(event as CustomEvent).detail.onComplete(false);
 window.addEventListener('bezier-design:add-project-file-to-canvas',receive);
 try{
  render(<CanvasAssetsSidebar {...props} files={[{name:'outputs/photo.png',size:24,mtime:1,kind:'image',mime:'image/png'}]}/>);
  fireEvent.click(screen.getByRole('button',{name:'entry.canvasAssets.moreActionsAria'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'entry.canvasAssets.addToCanvas'}));
  await screen.findByText('asset.error.canvasAddFailed');
  expect(screen.queryByText('entry.canvasAssets.addedToCanvas')).toBeNull();
 }finally{window.removeEventListener('bezier-design:add-project-file-to-canvas',receive);}
});

it('has no desktop Finder action in the cloud resource list or its hover preview',async()=>{
 const reveal=vi.fn();
 render(<CanvasAssetsSidebar {...props} onRevealInFinder={reveal} files={[{name:'outputs/photo.png',size:24,mtime:1,kind:'image',mime:'image/png'}]}/>);
 expect(screen.queryByRole('button',{name:'entry.canvasAssets.finderOpen'})).toBeNull();
 const item=screen.getByTestId('canvas-sidebar-file-outputs/photo.png');
 fireEvent.doubleClick(item);
 expect(reveal).not.toHaveBeenCalled();
 fireEvent.mouseEnter(item);
 await screen.findByRole('complementary');
 expect(screen.queryByRole('button',{name:'entry.canvasAssets.finderOpen'})).toBeNull();
});
