/** Explicit operator-only real storage acceptance. MA remains a protocol
 * fixture; the maintenance session stays in this host process, never Docker. */
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createProvisionClient} from '../../tools/provision/src/http.js';
import {createProvisionPlan} from '../../tools/provision/src/private-storage.js';
import {writerLockDocumentId} from '../../packages/app-cloud-state/src/index.js';

const APPS=['canvas','doc','sketch','image'] as const;
type App=typeof APPS[number];
type Plan=ReturnType<typeof createProvisionPlan>;
const ENDPOINT='https://frontend-cloud.corp.kuaishou.com/v1';
export function ownedAcceptanceRoute(method:string,path:string,plans:Plan[]):boolean{
  if(!['GET','POST','PUT','PATCH','DELETE'].includes(method)||/[\\#\r\n]/.test(path)||/%(?:2e|2f|5c)/i.test(path.split('?')[0]!))return false;
  const pathname=path.split('?')[0]!;
  if(!pathname.startsWith('/')||pathname.startsWith('//')||/(?:^|\/)\.\.?(?:\/|$)/.test(pathname))return false;
  for(const plan of plans){
    const db='/databases/'+plan.databaseId,bucket='/storage/buckets/'+plan.bucketId;
    const ownDb=pathname===db||pathname.startsWith(db+'/collections/');
    const ownBucket=pathname===bucket||pathname===bucket+'/files'||pathname.startsWith(bucket+'/files/');
    if(method==='GET'&&(ownDb||ownBucket))return true;
    if(method!=='PUT'&&ownDb&&/^\/databases\/[^/]+\/collections\/[^/]+\/documents(?:\/[^/]+)?$/.test(pathname))return true;
    if(ownBucket&&/^\/storage\/buckets\/[^/]+\/files(?:\/[^/]+)?$/.test(pathname))return method!=='PUT'||pathname!==bucket+'/files';
  }
  return false;
}

export class OwnedCloudAcceptance{
  requests=0;
  readonly events:Array<{method:string;path:string;status:number}>=[];
  readonly #channelKey=randomUUID();
  get channelKey(){return this.#channelKey;}
  readonly projectId='grworkspace';
  readonly plans:Record<App,Plan>;
  readonly nativeImageEntry:string;
  readonly nativeImageEntrySha256:string;
  readonly #cookie:string;
  readonly #prefsFile:string;
  private constructor(plans:Record<App,Plan>,cookie:string,prefsFile:string,entry:string,entrySha:string){this.plans=plans;this.#cookie=cookie;this.#prefsFile=prefsFile;this.nativeImageEntry=entry;this.nativeImageEntrySha256=entrySha;}
  static async load(configPath:string):Promise<OwnedCloudAcceptance>{
    if(process.env.NODE_ENV==='production'||!isAbsolute(configPath))throw Error('Owned-cloud acceptance requires explicit nonproduction absolute config');
    let config:any;
    try{config=JSON.parse(await readFile(configPath,'utf8'));}catch{throw Error('Explicit owned-cloud acceptance config unavailable');}
    if(config.profile!=='owned-private-acceptance-only'||config.allowTestBusinessWrites!==true||!isAbsolute(config.prefsFile??''))throw Error('Explicit isolated acceptance profile and test writes required');
    if(!isAbsolute(config.nativeImageEntry??'')||!config.nativeImageEntry.endsWith('/dist/app-backend/serve.js')||!/^\w{64}$/.test(config.nativeImageEntrySha256??''))throw Error('Exact installed Image CLI and digest required for native maintenance mode');
    const entrySha=createHash('sha256').update(await readFile(config.nativeImageEntry)).digest('hex');
    if(entrySha!==config.nativeImageEntrySha256)throw Error('Installed Image CLI digest changed');
    const plans={} as Record<App,Plan>;
    for(const app of APPS){
      const r=config.resources?.[app];
      if(!r||typeof r.databaseId!=='string'||typeof r.bucketId!=='string'||!r.databaseId.startsWith(app+'_accept_')||!r.bucketId.startsWith(app+'_accept_'))throw Error('Only newly owned app_accept_ resources are permitted');
      if(app!=='sketch'&&typeof r.namespace!=='string')throw Error('Explicit string namespace required');
      plans[app]=createProvisionPlan(app,r.databaseId,r.bucketId,r.namespace);
    }
    let prefs:any;
    try{prefs=JSON.parse(await readFile(config.prefsFile,'utf8'));}catch{throw Error('Maintenance session unavailable');}
    const raw=prefs[prefs.current]?.cookie;
    if(typeof raw!=='string'||/[\r\n\x00]/.test(raw))throw Error('Maintenance session unavailable');
    const match=/(?:^|;\s*)a_session_console=([^;\s]+)/.exec(raw);
    if(!match)throw Error('Maintenance session unavailable');
    return new OwnedCloudAcceptance(plans,'a_session_console='+match[1],config.prefsFile,config.nativeImageEntry,entrySha);
  }
  nativeImageArgs(){return [this.nativeImageEntry,'--maintenance-prefs',this.#prefsFile];}
  nativeImageEndpoint(){return ENDPOINT;}
  redact(value:string){return value.split(this.#cookie.slice('a_session_console='.length)).join('[redacted]');}
  provisionClient(app:App){
    return createProvisionClient({endpoint:ENDPOINT,projectId:this.projectId,app,databaseId:this.plans[app].databaseId,bucketId:this.plans[app].bucketId,consoleCookie:this.#cookie,fetcher:async(url,init)=>{
      if(init?.method!=='GET')throw Error('Acceptance provisioning inspection is read-only');
      const target=new URL(String(url));if(target.origin!=='https://frontend-cloud.corp.kuaishou.com'||!target.pathname.startsWith('/v1/'))throw Error('Acceptance inspection origin rejected');
      return this.request('GET',target.pathname.slice(3)+target.search);
    }});
  }
  async request(method:string,path:string,headers?:Headers,body?:Uint8Array):Promise<Response>{
    if(!ownedAcceptanceRoute(method,path,Object.values(this.plans)))throw Error('Cloud acceptance request outside own test data boundary');
    if(method==='PUT'){
      let data:any;try{data=JSON.parse(new TextDecoder().decode(body));}catch{throw Error('File privacy finalization must be JSON');}
      if(Object.keys(data??{}).length!==1||!Array.isArray(data.permissions)||data.permissions.length)throw Error('Only empty grants are permitted when finalizing fresh test files');
    }
    const out:Record<string,string>={'x-appwrite-project':this.projectId,'x-appwrite-mode':'admin',cookie:this.#cookie};
    for(const key of ['content-type','content-range','x-appwrite-id','range']){const value=headers?.get(key);if(value)out[key]=value;}
    this.requests++;
    try{const response=await fetch(ENDPOINT+path,{method,headers:out,redirect:'error',signal:AbortSignal.timeout(30_000),...(body?.byteLength?{body:new Uint8Array(body)}:{})});this.events.push({method,path,status:response.status});return response;}
    catch{throw Error('Owned-cloud acceptance transport unavailable');}
  }
  async gateway(method:string,path:string,headers:Headers,body:Uint8Array):Promise<Response>{
    if(headers.get('x-appwrite-project')!==this.projectId||headers.get('x-appwrite-key')!==this.channelKey)throw Error('Test container channel identity rejected');
    return this.request(method,path,headers,body);
  }
  async lockAbsent(app:App):Promise<boolean>{
    const r=await this.request('GET',`/databases/${this.plans[app].databaseId}/collections/app_runtime_state/documents/${writerLockDocumentId(app)}`);
    await r.arrayBuffer();if(r.status!==200&&r.status!==404)throw Error('Unable to inspect owned test writer lock');return r.status===404;
  }
}
