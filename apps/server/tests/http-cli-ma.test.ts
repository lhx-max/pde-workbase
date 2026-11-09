import {afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildHttpCliRequest} from '../src/http-cli.js';
const roots:string[]=[];
afterEach(async()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function setup(){const root=await mkdtemp(path.join(tmpdir(),'cli-ma-'));roots.push(root);const file=path.join(root,'credential');await writeFile(file,'Bearer fixture-token',{mode:0o600});vi.stubEnv('CANVAS_MA_CREDENTIAL_FILE',file);vi.stubEnv('MAV_TENANT_ID','team-a');vi.stubEnv('MAV_APPLICATION_INSTANCE_ID','ai_a');}
it('forwards an executor-provided credential with MA scope without persisting it into request bodies',async()=>{
 await setup();const request=await buildHttpCliRequest(['request','GET','/api/apps/canvas','--server-url','https://canvas.example.test']);const headers=new Headers(request.init.headers);
 expect(headers.get('x-mav-sso-authorization')).toBe('Bearer fixture-token');expect(headers.get('x-mav-tenant')).toBe('team-a');expect(request.init.body).toBeUndefined();
});
it('rejects incomplete MA scope and plaintext remote transport',async()=>{
 await setup();await expect(buildHttpCliRequest(['request','GET','/api/apps/canvas','--server-url','http://canvas.example.test'])).rejects.toThrow('HTTPS');
 vi.stubEnv('MAV_TENANT_ID',undefined);await expect(buildHttpCliRequest(['request','GET','/api/apps/canvas','--server-url','https://canvas.example.test'])).rejects.toThrow('required together');
});
