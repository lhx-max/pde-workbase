import express from 'express';
import {expect,it} from 'vitest';
import {sendCloudImage} from '../src/media/cloud-image-response.js';
import type {ImageFileStorage} from '../src/storage/cloud-image-files.js';

it('serves an SVG original as a sandboxed private document without script permissions',async()=>{
 const buffer=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="throw new Error(\'active\')"><rect width="1" height="1"/></svg>');
 const file={name:'fixture.svg',path:'fixture.svg',mime:'image/svg+xml',kind:'image' as const,type:'file' as const,size:buffer.length,mtime:1};
 const storage={read:async()=>({buffer,file})} as unknown as ImageFileStorage;
 const app=express();app.get('/raw',async(req,res)=>{await sendCloudImage(req,res,storage,'fixture','fixture.svg');});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 try{
  const response=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/raw`);
  expect(response.status).toBe(200);expect(await response.text()).toContain('<svg');
  expect(response.headers.get('content-security-policy')).toContain('sandbox');
  expect(response.headers.get('content-security-policy')).not.toContain('allow-scripts');
  expect(response.headers.get('cache-control')).toBe('private, no-cache');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
