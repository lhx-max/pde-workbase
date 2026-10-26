import { afterEach, expect, it, vi } from 'vitest';
import { createHttpMediaAdapter } from '../src/http-adapters.js';
afterEach(() => vi.unstubAllGlobals());
const input = {taskId:'t',projectId:'p',request:{},inputs:[],signal:new AbortController().signal,onProgress:()=>{}};
it('preserves the image authorization error without retrying the paid generation',async()=>{
 const fetcher=vi.fn(async()=>Response.json({error:{code:'IMAGE_AUTH_REQUIRED',message:'请完成生图授权'}},{status:401}));vi.stubGlobal('fetch',fetcher);
 await expect(createHttpMediaAdapter('http://127.0.0.1:17465').generate(input)).rejects.toMatchObject({code:'IMAGE_AUTH_REQUIRED',status:401,message:'请完成生图授权'});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not expose arbitrary upstream bodies as an image authorization message',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:{code:'OTHER_PROVIDER',message:'private upstream diagnostics'}},{status:502})));
 await expect(createHttpMediaAdapter('http://127.0.0.1:17465').generate(input)).rejects.toThrow('Adapter returned HTTP 502');
});
