import {it,expect,vi} from 'vitest';
import {AppwriteClient} from '../src/storage/appwrite-client.js';
it('keeps privileged requests at the configured endpoint and sanitizes upstream errors',async()=>{
 const transport=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('internal credential and upstream stack',{status:500}));
 try{
 const client=new AppwriteClient({endpoint:'https://storage.example.test/v1',projectId:'project',apiKey:'fixture-service-key'});
 await expect(client.call('GET','/probe')).rejects.toMatchObject({code:'CANVAS_STORAGE_ERROR',message:'Appwrite storage request failed (HTTP 500)'});
 expect(transport.mock.calls[0]?.[1]?.redirect).toBe('error');
 }finally{transport.mockRestore();}
});

it('narrows only newly-created file grants before acknowledging upload',async()=>{
 const transport=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(Response.json({$id:'owned-file'})).mockResolvedValueOnce(Response.json({$id:'owned-file',$permissions:[]}));
 try{const client=new AppwriteClient({endpoint:'https://storage.example.test/v1',projectId:'project',apiKey:'fixture-service-key'});
 expect(await client.upload('bucket','owned-file','image.png',new Uint8Array([1]),'image/png')).toEqual({$id:'owned-file'});
 expect(transport).toHaveBeenCalledTimes(2);expect(transport.mock.calls[1]?.[1]?.method).toBe('PUT');expect(JSON.parse(String(transport.mock.calls[1]?.[1]?.body))).toEqual({permissions:[]});
 }finally{transport.mockRestore();}
});
it('does not change grants when the immutable file already exists',async()=>{
 const transport=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:409}));
 try{const client=new AppwriteClient({endpoint:'https://storage.example.test/v1',projectId:'project',apiKey:'fixture-service-key'});
 await expect(client.upload('bucket','owned-file','image.png',new Uint8Array([1]),'image/png')).rejects.toMatchObject({status:409});expect(transport).toHaveBeenCalledTimes(1);
 }finally{transport.mockRestore();}
});
it('does not report success when private grants cannot be confirmed',async()=>{
 const transport=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(Response.json({$id:'owned-file'})).mockResolvedValueOnce(Response.json({$id:'owned-file',$permissions:['read("any")']}));
 try{const client=new AppwriteClient({endpoint:'https://storage.example.test/v1',projectId:'project',apiKey:'fixture-service-key'});
 await expect(client.upload('bucket','owned-file','image.png',new Uint8Array([1]),'image/png')).rejects.toMatchObject({status:503});
 }finally{transport.mockRestore();}
});
