// @vitest-environment jsdom
import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {TabLauncherMenu} from '../src/components/workspace/TabLauncherMenu';
import {BrowserCaptureSettings} from '../src/components/BrowserCaptureSettings';
const state=vi.hoisted(()=>({close:undefined as undefined|((event:Event)=>void),t:(key:string)=>key}));
vi.mock('../src/i18n',()=>({useT:()=>state.t,useI18n:()=>({t:state.t,locale:'en'})}));
vi.mock('../src/browser-resources/browser-preferences',()=>({useBrowserPreferences:()=>({capture:{enabled:true,text:true,images:true},ready:true,error:false}),updateBrowserCapture:vi.fn().mockResolvedValue(undefined),reloadBrowserPreferences:vi.fn()}));
vi.mock('../src/components/ui',async()=>{const actual=await vi.importActual<any>('../src/components/ui');return {...actual,
 DropdownMenu:({children}:any)=>children,
 DropdownMenuTrigger:({children}:any)=>children,
 // Model only the deferred Radix unmount boundary; the destination popover and
 // switch are real. Completion is explicit, with no wall-clock sleeps.
 DropdownMenuContent:({children,onCloseAutoFocus,...props}:any)=>{state.close=onCloseAutoFocus;return <div data-testid={props['data-testid']}>{children}</div>;},
 DropdownMenuItem:({children,onSelect}:any)=><button onClick={onSelect}>{children}</button>,
};});
function Host(){const [open,setOpen]=useState(true);return <><TabLauncherMenu open={open} onOpenChange={setOpen} trigger={<button data-testid="launcher-trigger">New tab</button>} launcherContext={{} as any} actions={[{id:'browser',label:'New Browser',iconName:'globe',run:()=>{}} as any]}/><BrowserCaptureSettings/></>;}
function completeLauncherExit(){const event=new Event('focusScope.autoFocusOnUnmount',{cancelable:true});screen.getByTestId('tab-launcher-menu').dispatchEvent(event);state.close?.(event);if(!event.defaultPrevented)screen.getByTestId('launcher-trigger').focus();return event;}
afterEach(()=>{cleanup();state.close=undefined;});
it('does not dismiss a newly focused Capture popover when the old launcher exit completes',async()=>{render(<Host/>);fireEvent.click(screen.getByRole('button',{name:'New Browser'}));fireEvent.click(screen.getByRole('button',{name:'browserCapture.settings.title'}));const toggle=await screen.findByRole('switch',{name:'browserCapture.settings.enabled'});await waitFor(()=>expect(document.activeElement).toBe(toggle));let event!:Event;await act(async()=>{event=completeLauncherExit();});expect(event.defaultPrevented).toBe(true);expect(screen.getByRole('button',{name:'browserCapture.settings.title'}).getAttribute('aria-expanded')).toBe('true');expect(document.activeElement).toBe(toggle);});
it('retains normal keyboard focus restoration if no destination took focus',()=>{render(<Host/>);screen.getByRole('button',{name:'New Browser'}).focus();const event=completeLauncherExit();expect(event.defaultPrevented).toBe(false);expect(document.activeElement).toBe(screen.getByTestId('launcher-trigger'));});
