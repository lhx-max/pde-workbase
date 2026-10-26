import {createServer} from 'node:http';import {expect,it} from 'vitest';
import {createHttpMediaAdapter} from '../src/http-adapters.js';import {parseToolResultPayload,planToolDelivery} from '../src/media/tool-delivery.js';
it('HTTP tool transport decodes every artifact without retaining wire-only fields',async()=>{
 const bytes=Buffer.from('<svg/>');const base={contentBase64:bytes.toString('base64'),mime:'image/svg+xml'};
 const server=createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({path:'outputs/result.svg',...base,toolResult:{kind:'vectorize',artifacts:[{...base,role:'vector',width:8,height:4}]}}));});server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const adapter=createHttpMediaAdapter(`http://127.0.0.1:${(server.address() as {port:number}).port}`);const result=await adapter.generate({taskId:'task',projectId:'project',request:{},inputs:[],signal:AbortSignal.timeout(3000),onProgress:()=>{}});expect(result.content).toEqual(bytes);expect(result.toolResult?.artifacts).toHaveLength(1);expect(Array.from(result.toolResult?.artifacts[0]?.content??[])).toEqual(Array.from(bytes));expect(result.toolResult?.artifacts[0]).not.toHaveProperty('contentBase64');expect(planToolDelivery('task','project',result.path,result.toolResult!).artifacts[0]?.path).toBe('outputs/result.svg');}
 finally{await new Promise<void>(r=>server.close(()=>r()));}
});
it('snapshots provider-owned bytes and rejects unsafe metadata before asynchronous persistence',()=>{
 const content=new Uint8Array([1,2,3]);const result=parseToolResultPayload({kind:'reflow',artifacts:[{content,mime:'image/png',width:8,height:8}]});content[0]=99;expect(result.artifacts[0]?.content[0]).toBe(1);
 expect(()=>parseToolResultPayload({kind:'reflow',artifacts:[{content,mime:'image/png'}],layering:{authorization:'secret'}})).toThrow('凭据');
});
