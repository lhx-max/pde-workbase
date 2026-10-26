import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../src/platform/canvas-persistence',()=>({flushCanvasForProject:vi.fn()}));
vi.mock('../src/platform/canvas-file-upload',()=>({uploadCanvasAttachment:vi.fn()}));
vi.mock('../src/platform/api-base',()=>({getCanvasHostContext:vi.fn(),platformFetchWithContext:vi.fn(),projectFileUrl:vi.fn((p:string)=>`/authorized/${p}`)}));
import {flushCanvasForProject} from '../src/platform/canvas-persistence';
import {getCanvasHostContext,platformFetchWithContext} from '../src/platform/api-base';
import {loadCanvasImageTools,runCanvasImageTool,createCanvasImageToolRunner} from '../src/platform/image-tools';
const context={projectId:'project-a'};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(getCanvasHostContext).mockReturnValue(context);vi.mocked(flushCanvasForProject).mockResolvedValue();vi.stubGlobal('window',new EventTarget());});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('flushes drafts before the versioned App action, preserves params and uses an idempotency key',async()=>{
 const observed:string[]=[];vi.mocked(flushCanvasForProject).mockImplementation(async()=>{observed.push('flush');});
 vi.mocked(platformFetchWithContext).mockImplementation(async(_c,url,init)=>{observed.push(url);if(url.endsWith('/state'))return Response.json({data:{revision:8}});expect(init?.method).toBe('POST');expect(JSON.parse(String(init?.body))).toEqual({input:{nodeId:'image-a',kind:'vectorize',params:{}},expectedRevision:8});expect(new Headers(init?.headers).get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);return Response.json({data:{receiptId:'receipt-a',status:'succeeded'}});});
 await runCanvasImageTool(context,'image-a','vectorize',{},new AbortController().signal);
 expect(observed[0]).toBe('flush');expect(observed[2]).toContain('/actions/image.tool');
});
it('does not dispatch a tool after a failed save or a canvas switch',async()=>{
 vi.mocked(flushCanvasForProject).mockRejectedValueOnce(Error('save conflict'));
 await expect(runCanvasImageTool(context,'image-a','vectorize',{},new AbortController().signal)).rejects.toThrow('save conflict');expect(platformFetchWithContext).not.toHaveBeenCalled();
 vi.mocked(flushCanvasForProject).mockImplementationOnce(async()=>{vi.mocked(getCanvasHostContext).mockReturnValue({projectId:'other'});});
 await expect(runCanvasImageTool(context,'image-a','vectorize',{},new AbortController().signal)).rejects.toThrow('实例已切换');expect(platformFetchWithContext).not.toHaveBeenCalled();
});
it('propagates explicit unavailable/failed status instead of treating accepted work as successful',async()=>{
 vi.mocked(platformFetchWithContext).mockResolvedValueOnce(Response.json({data:{revision:1}})).mockResolvedValueOnce(Response.json({data:{receiptId:'receipt-a',status:'failed',result:{error:'GPU服务未配置'}}}));
 await expect(runCanvasImageTool(context,'image-a','upscale',{scale:2},new AbortController().signal)).rejects.toThrow('GPU服务未配置');
 expect(platformFetchWithContext).toHaveBeenCalledTimes(2);
});
it('does not accept a capability list from another project lifetime or a malformed service',async()=>{
 vi.mocked(platformFetchWithContext).mockResolvedValueOnce(Response.json({data:{tools:[{id:'vectorize',configured:true}]}}));
 expect(await loadCanvasImageTools(context)).toEqual([{id:'vectorize',configured:true}]);
 vi.mocked(platformFetchWithContext).mockResolvedValueOnce(Response.json({data:{configured:true}}));await expect(loadCanvasImageTools(context)).rejects.toThrow('无效能力清单');
});

it('a retry after an unknown HTTP outcome reuses the same logical operation key',async()=>{
 const keys:string[]=[];let posts=0;
 vi.mocked(platformFetchWithContext).mockImplementation(async(_context,url,init)=>{
  if(url.endsWith('/state'))return Response.json({data:{revision:posts+1}});
  keys.push(new Headers(init?.headers).get('idempotency-key')!);posts++;if(posts===1)throw Error('connection lost after acceptance');
  return Response.json({data:{receiptId:keys.at(-1),status:'succeeded'}});
 });
 const run=createCanvasImageToolRunner(context,'image-a',()=>new AbortController().signal);
 await expect(run('vectorize',{})).rejects.toThrow('connection lost');await run('vectorize',{});expect(keys).toHaveLength(2);expect(keys[1]).toBe(keys[0]);
});
