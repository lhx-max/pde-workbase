import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { ClipExportJobReceipts } from '../../src/media/clip-export-jobs.js';

it('restores completed receipts, isolates projects, and marks interrupted renders retryable',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'clip-receipts-'));
  try {
    const first=new ClipExportJobReceipts(dir);
    const jobId=randomUUID();
    await first.save({ok:true,jobId,projectId:'p',status:'running',progress:0.3});
    const restarted=new ClipExportJobReceipts(dir);
    expect((await restarted.read(jobId,'p'))?.status).toBe('failed');
    expect(await restarted.read(jobId,'other')).toBeNull();
    expect(await restarted.read('../../secret','p')).toBeNull();
    await first.save({ok:true,jobId,projectId:'p',status:'complete',progress:1,file:{name:'result.mp4',path:'result.mp4',kind:'video',size:1,mtime:1,mime:'video/mp4'}});
    expect((await restarted.read(jobId,'p'))?.file?.path).toBe('result.mp4');
  } finally {await rm(dir,{recursive:true,force:true});}
});
