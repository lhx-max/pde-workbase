// @vitest-environment jsdom
import React from 'react';
import {cleanup,fireEvent,render,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ImageCropTool,ImageAdjustTool} from '@ks-designai/image-card-pack/react';
let workers: FakeWorker[]=[];
class FakeWorker {
 onmessage:((e:MessageEvent)=>void)|null=null;
 onerror:(()=>void)|null=null;
 terminate=vi.fn();
 constructor(){workers.push(this);}
 postMessage(value:{id:number}){queueMicrotask(()=>this.onmessage?.({data:{id:value.id,result:{blob:new Blob(['png'],{type:'image/png'}),width:450,height:600}}} as MessageEvent));}
}
beforeEach(()=>{
 workers=[];
 vi.stubGlobal('Worker',FakeWorker);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Blob(['source'],{type:'image/png'}))));
 vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:800,height:600,close:vi.fn()})));
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(performance.now()),16));
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>clearTimeout(id));
 URL.createObjectURL=vi.fn(()=> 'blob:preview');URL.revokeObjectURL=vi.fn();
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function originalPanel(){const host=document.querySelector('[data-image-app-tools="original"]')!;return within(host.shadowRoot as unknown as HTMLElement);}
it('packed crop consumer retains editor when cloud commit returns false, then closes after retry succeeds',async()=>{
 const close=vi.fn(),commit=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(undefined);
 render(<ImageCropTool src="/authorized-original.png" name="source.png" onCancel={close} onCommit={commit}/>);
 const ui=originalPanel();
 await waitFor(()=>expect((ui.getByLabelText('宽度像素') as HTMLInputElement).value).toBe('800'));
 fireEvent.click(ui.getByRole('radio',{name:'3:4',exact:true}));
 expect((ui.getByLabelText('宽度像素') as HTMLInputElement).value).toBe('450');
 fireEvent.click(ui.getByRole('button',{name:'完成',exact:true}));
 await waitFor(()=>expect(ui.getByRole('alert').textContent).toContain('保存未完成'));
 expect(close).not.toHaveBeenCalled();
 fireEvent.click(ui.getByRole('button',{name:'完成',exact:true}));
 await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(commit).toHaveBeenCalledTimes(2);
});
it('packed adjustment consumer uses original tabs, reports failed save and terminates worker when unmounted',async()=>{
 const commit=vi.fn().mockRejectedValue(new Error('云端暂不可用')),close=vi.fn();
 const view=render(<ImageAdjustTool src="/authorized-original.png" name="source.png" onCancel={close} onCommit={commit}/>);
 const ui=originalPanel();
 await waitFor(()=>expect((ui.getByRole('slider',{name:'曝光',exact:true}) as HTMLInputElement).disabled).toBe(false));
 fireEvent.input(ui.getByRole('slider',{name:'曝光',exact:true}),{target:{value:'30'}});
 fireEvent.click(ui.getByRole('button',{name:'关闭调整弹窗'}));
 await waitFor(()=>expect(ui.getByRole('alert').textContent).toContain('云端暂不可用'));
 expect(close).not.toHaveBeenCalled();expect(ui.queryByRole('button',{name:'完成',exact:true})).toBeNull();
 view.unmount();expect(workers[0].terminate).toHaveBeenCalledOnce();
});
