// @vitest-environment jsdom
import {useMemo,useState} from 'react';
import {act,cleanup,fireEvent,render} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ProjectTabsState} from '@bezier/contracts';
import {DesignBrowserPanel,type BrowserPageInfo} from '../src/components/DesignBrowserPanel';
import {updateBrowserTabInfo} from '../src/state/workspace-tabs';
const mocks=vi.hoisted(()=>({t:(key:string)=>key,received:vi.fn(),persisted:vi.fn()}));
vi.mock('../src/components/BrowserAssetCapture',()=>({useBrowserAssetCapture:()=>({toolbar:null,busy:false,saveImage:vi.fn(),saveSelection:vi.fn()})}));
vi.mock('../src/browser-resources/BrowserResourcePlugin',()=>({useBrowserResourcePlugin:()=>({trigger:null,panel:null})}));
vi.mock('../src/providers/registry',()=>({requestJson:vi.fn(),writeProjectBase64File:vi.fn(),writeProjectTextFile:vi.fn(),projectRawUrl:vi.fn(),openExternalUrl:vi.fn()}));
vi.mock('../src/i18n',()=>({useT:()=>mocks.t,useI18n:()=>({t:mocks.t,locale:'en'})}));
vi.mock('@bezier/host',()=>({isBezierHostAvailable:()=>true,getBezierHost:()=>({browser:{readImage:()=>{}}}),clearHostBrowserData:vi.fn()}));
const noop=()=>{};
function Parent({inline=false}:{inline?:boolean}){
 const [tabs,setTabs]=useState<ProjectTabsState>({tabs:['browser'],active:'browser',browserTabs:[{id:'browser',label:'Browser'}]});const [count,setCount]=useState(0);
 const update=(info:BrowserPageInfo)=>{mocks.received(info);setTabs(current=>{const next=updateBrowserTabInfo(current,'browser',info);if(next!==current)mocks.persisted(next);return next;});};
 const callbacks=useMemo(()=>Object.fromEntries(tabs.tabs.map(id=>[id,update])),[tabs.tabs]);
 const browser=tabs.browserTabs![0]!;
 return <><button onClick={()=>setCount(count+1)}>Parent update {count}</button><output data-testid="metadata">{JSON.stringify(browser)}</output><DesignBrowserPanel projectId="p" browserTabId="browser" initialUrl={browser.url} initialTitle={browser.title} initialIconUrl={browser.iconUrl} onOpenFile={noop} onRefreshFiles={noop} onPageInfoChange={inline?update:callbacks.browser}/></>;
}
beforeEach(()=>{vi.useFakeTimers();mocks.received.mockClear();mocks.persisted.mockClear();vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
describe('native browser metadata with a real stateful parent',()=>{
 it('mounts blank home and survives unrelated parent rerenders without metadata writes looping',async()=>{let view!:ReturnType<typeof render>;await act(async()=>{view=render(<Parent/>);});expect(mocks.persisted).toHaveBeenCalledTimes(1);const first=mocks.received.mock.calls.length;fireEvent.click(view.getByText('Parent update 0'));expect(view.getByText('Parent update 1')).toBeTruthy();expect(mocks.received).toHaveBeenCalledTimes(first);expect(mocks.persisted).toHaveBeenCalledTimes(1);expect(JSON.parse(view.getByTestId('metadata').textContent!)).toMatchObject({id:'browser',url:''});});
 it('also protects legacy inline parents from repeated equal page-info updates',async()=>{let view!:ReturnType<typeof render>;await act(async()=>{view=render(<Parent inline/>);});expect(mocks.persisted).toHaveBeenCalledTimes(1);fireEvent.click(view.getByText('Parent update 0'));expect(view.getByText('Parent update 1')).toBeTruthy();expect(mocks.persisted).toHaveBeenCalledTimes(1);expect(mocks.received.mock.calls.length).toBeLessThan(8);});
 it('preserves state identity for duplicates and ignores late closed-tab metadata',()=>{const state:ProjectTabsState={tabs:['browser'],active:'browser',browserTabs:[{id:'browser',label:'Browser',title:'A',url:'https://a.test'}]};expect(updateBrowserTabInfo(state,'browser',{title:'A',url:'https://a.test'})).toBe(state);expect(updateBrowserTabInfo(state,'closed',{title:'B',url:'https://b.test'})).toBe(state);const next=updateBrowserTabInfo(state,'browser',{title:'B',url:'https://b.test',iconUrl:'https://b.test/icon.png'});expect(next.browserTabs?.[0]).toMatchObject({title:'B',url:'https://b.test',iconUrl:'https://b.test/icon.png'});expect(next.tabs).toBe(state.tabs);});
});
