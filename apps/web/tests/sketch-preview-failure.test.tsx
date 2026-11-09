// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {SketchPreview} from '../src/components/SketchPreview';
import {CanvasSketchCard} from '../src/components/workspace/CanvasSketchCard';
import {sketchPreviewChannel,sketchPreviewKey} from '../src/state/sketch-preview-channel';
const mocks=vi.hoisted(()=>({read:vi.fn(),t:(key:string)=>key}));
vi.mock('../src/providers/registry',()=>({fetchProjectFileText:mocks.read}));
vi.mock('../src/i18n',()=>({useT:()=>mocks.t}));
afterEach(()=>{cleanup();mocks.read.mockReset();});
const scene=JSON.stringify({type:'excalidraw',version:2,elements:[],files:{},appState:{}});
it('leaves loading on 404 and can retry after the file is available',async()=>{
 mocks.read.mockRejectedValueOnce(Error('404')).mockResolvedValueOnce(scene);
 render(<SketchPreview projectId="retry-project" file={{name:'retry.sketch.json',kind:'sketch',mtime:1}}/>);
 expect(await screen.findByRole('alert')).toBeTruthy();fireEvent.click(screen.getByText('common.retry'));
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 await waitFor(()=>expect(screen.getByTestId('sketch-preview-svg').classList.contains('loading')).toBe(false));
 expect(mocks.read).toHaveBeenCalledTimes(2);
 expect(document.querySelector('.sketch-preview-empty-mark')).toBeNull();
});
it('renders a live scene before file metadata arrives without refetching the server',async()=>{
 render(<CanvasSketchCard projectId="live-project" path="live.sketch.json" previewScope="actor-a" selected={false} onOpen={async()=>{}}/>);
 expect(screen.queryByTestId('sketch-preview-svg')).toBeNull();
 const key=sketchPreviewKey('actor-a','live-project','live.sketch.json');
 await act(async()=>sketchPreviewChannel.publish(key,scene));
 expect(screen.getByTestId('sketch-preview-svg')).toBeTruthy();expect(mocks.read).not.toHaveBeenCalled();
 sketchPreviewChannel.remove(key);
});

it('reports malformed cloud content rather than presenting it as an empty scene',async()=>{
 mocks.read.mockResolvedValue('not valid sketch JSON');
 render(<SketchPreview projectId="invalid-project" file={{name:'invalid.sketch.json',kind:'sketch',mtime:1}}/>);
 expect(await screen.findByRole('alert')).toBeTruthy();
 expect(screen.queryByTestId('sketch-preview-svg')).toBeNull();
});
