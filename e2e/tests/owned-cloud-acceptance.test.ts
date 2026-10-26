import {test,expect} from 'vitest';
import {ownedAcceptanceRoute,OwnedCloudAcceptance} from '../lib/owned-cloud-acceptance.js';
import {mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';
import{tmpdir}from'node:os';import{join}from'node:path';import{createHash}from'node:crypto';
import {createProvisionPlan} from '../../tools/provision/src/private-storage.js';
const plans=[createProvisionPlan('doc','doc_accept_unit','doc_accept_assets','accept-unit')];
test('real-cloud acceptance limits mutations to own test documents and files',()=>{
 for(const [method,path]of [['GET','/databases/doc_accept_unit'],['GET','/databases/doc_accept_unit/collections/documents'],['POST','/databases/doc_accept_unit/collections/documents/documents'],['PATCH','/databases/doc_accept_unit/collections/documents/documents/d1'],['DELETE','/databases/doc_accept_unit/collections/app_runtime_state/documents/lock1'],['GET','/storage/buckets/doc_accept_assets/files/f1/download'],['POST','/storage/buckets/doc_accept_assets/files'],['DELETE','/storage/buckets/doc_accept_assets/files/f1']])expect(ownedAcceptanceRoute(method!,path!,plans),method+' '+path).toBe(true);
});
test('real-cloud acceptance refuses schema/admin/cross-resource and noncanonical routes',()=>{
 for(const [method,path]of [['POST','/databases'],['DELETE','/databases/doc_accept_unit'],['POST','/databases/doc_accept_unit/collections'],['DELETE','/databases/doc_accept_unit/collections/documents'],['PATCH','/storage/buckets/doc_accept_assets'],['POST','/storage/buckets'],['GET','/databases/doc_app_dev'],['GET','/storage/buckets/doc_accept_assets2/files/f1'],['POST','/storage/buckets/doc_accept_assets/files-other'],['GET','/databases/doc_accept_unit/../doc_app_dev'],['GET','/storage/buckets/doc_accept_assets/files/%2e%2e'],['GET','//databases/doc_accept_unit'],['GET','/databases/doc_accept_unit\\bad'],['GET','/databases/doc_accept_unit#bad']])expect(ownedAcceptanceRoute(method!,path!,plans),method+' '+path).toBe(false);
});
test('PUT only permits file metadata finalization, never database documents or bucket policy',()=>{
 expect(ownedAcceptanceRoute('PUT','/storage/buckets/doc_accept_assets/files/f1',plans)).toBe(true);
 for(const path of ['/storage/buckets/doc_accept_assets/files','/storage/buckets/doc_accept_assets','/databases/doc_accept_unit/collections/documents/documents/d1'])expect(ownedAcceptanceRoute('PUT',path,plans)).toBe(false);
 expect(ownedAcceptanceRoute('GET','/storage/buckets/doc_accept_assets/files-other',plans)).toBe(false);
});
test('operator boundary rejects bad namespaces, hides secrets and forbids inspection mutations without network I/O',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'owned-cloud-guard-'));
 try{
  const entry=join(dir,'dist/app-backend/serve.js'),config=join(dir,'config.json'),prefs=join(dir,'prefs.json');await mkdir(join(dir,'dist/app-backend'),{recursive:true});const source='/* inert test CLI; never executed */';await writeFile(entry,source);
  const token='FAKE-CONSOLE-TEST-ONLY-abcdef123';await writeFile(prefs,JSON.stringify({current:'test',test:{cookie:'a_session_console='+token}}));
  const resources:any={};for(const app of ['canvas','doc','sketch','image'])resources[app]={databaseId:app+'_accept_unit',bucketId:app+'_accept_assets',...(app==='sketch'?{}:{namespace:'accept-'+app+'-unit'})};
  const value={profile:'owned-private-acceptance-only',allowTestBusinessWrites:true,prefsFile:prefs,nativeImageEntry:entry,nativeImageEntrySha256:createHash('sha256').update(source).digest('hex'),resources};
  await writeFile(config,JSON.stringify(value));const cloud=await OwnedCloudAcceptance.load(config);expect(JSON.stringify(cloud)).not.toContain(token);expect(JSON.stringify(cloud)).not.toContain(cloud.channelKey);expect(cloud.redact('error '+token)).toBe('error [redacted]');
  const client=cloud.provisionClient('canvas');await expect(client.call('POST',client.docsPath('canvas_accept_unit','app_runtime_state'),{})).rejects.toThrow();expect(cloud.requests).toBe(0);
  for(const invalid of [undefined,123]){resources.canvas.namespace=invalid;await writeFile(config,JSON.stringify(value));await expect(OwnedCloudAcceptance.load(config)).rejects.toThrow('string namespace');}
  resources.canvas.namespace='accept-canvas-unit';resources.sketch.namespace='not-used';await writeFile(config,JSON.stringify(value));await expect(OwnedCloudAcceptance.load(config)).rejects.toThrow('Sketch does not use');
 }finally{await rm(dir,{recursive:true,force:true});}
});
