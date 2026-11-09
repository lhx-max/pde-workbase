/** Add optional business-resource MA mapping attributes; never adopts rows or changes ACL. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {AppwriteClient,appwriteEnc as enc} from '../apps/server/src/storage/appwrite-client.js';
const{values}=parseArgs({options:{prefs:{type:'string'},database:{type:'string'},collection:{type:'string'},output:{type:'string'},apply:{type:'boolean',default:false}}});
if(!values.database||!values.collection||!values.output||!path.isAbsolute(values.output)||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,35}$/.test(values.database)||!['documents','sketches'].includes(values.collection))throw Error('Explicit database, documents/sketches collection and absolute output required');
if(values.prefs&&(!path.isAbsolute(values.prefs)||!values.database.endsWith('_dev')))throw Error('Maintenance prefs are limited to explicit development databases');
const credentials=values.prefs?await(async()=>{const p=JSON.parse(await readFile(values.prefs!,'utf8'));return{endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',sessionCookie:p[p.current].cookie,sessionMode:'admin' as const};})():{endpoint:process.env.APPWRITE_ENDPOINT!,projectId:process.env.APPWRITE_PROJECT!,apiKey:process.env.APPWRITE_API_KEY!};
const client=new AppwriteClient(credentials);
const base='/databases/'+enc(values.database)+'/collections/'+enc(values.collection)+'/attributes';
const fields=['maApplicationId','maApplicationInstanceId','maProviderInstanceId'];type Attribute={type:string;status:string;required:boolean;size?:number;array?:boolean};
const attributes:Array<{field:string;ready:boolean;created:boolean}>=[];
for(const field of fields){
 let attribute=await client.getOrNull<Attribute>(base+'/'+field);let created=false;
 if(attribute&&(attribute.type!=='string'||attribute.required||attribute.size!==160||attribute.array))throw Error('Existing MA scope attribute differs; no automatic repair');
 if(values.apply&&!attribute){await client.call('POST',base+'/string',{key:field,required:false,size:160,array:false});created=true;}
 if(values.apply)for(let attempt=0;attempt<30;attempt++){attribute=await client.getOrNull<Attribute>(base+'/'+field);if(attribute?.status==='failed')throw Error('MA mapping schema failed');if(attribute?.status==='available')break;await new Promise(resolve=>setTimeout(resolve,500));}
 attributes.push({field,ready:attribute?.status==='available',created});
}
const report={checkedAt:new Date().toISOString(),database:values.database,collection:values.collection,applied:values.apply,ready:attributes.every(row=>row.ready),attributes,aclChanged:false,rowsBackfilled:false,legacyResourcesAdopted:false};
await mkdir(path.dirname(values.output),{recursive:true});await writeFile(values.output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(values.apply&&!report.ready)process.exitCode=1;
