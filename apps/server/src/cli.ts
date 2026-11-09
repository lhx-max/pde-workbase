#!/usr/bin/env node
import path from 'node:path';
import {maAuthorityFromEnvironment,createAppWriteAuthorizer} from '@ks-designai/app-authority';
import { createCanvasServer } from './server.js';
import {createHttpMediaAdapter,createHttpCapabilityAdapter,createHttpAssetAdapter} from './http-adapters.js';
import {AppwriteWriterLock,assertPrivateAppwriteStorage} from '@ks-designai/app-cloud-state';
import {AppwriteClient} from './storage/appwrite-client.js';
import {canvasRuntimeConfigErrors} from './runtime-config.js';
const args=process.argv.slice(2);
if(args[0]==='request'||args[0]==='browser'||args[0]==='assets'||args[0]==='apps'){await (await import('./http-cli.js')).runHttpCli(args);process.exit(process.exitCode??0);}
function option(name:string):string|undefined{const index=args.indexOf(name);return index<0?undefined:args[index+1];}
if(args.includes('--help')){console.log('canvas-server --data-dir ABSOLUTE_PATH [--host 127.0.0.1] [--port 17456]\nRequires explicit DATA ROOT. CANVAS_DATA_DIR, CANVAS_PORT, CANVAS_AUTH_TOKEN, CANVAS_WEB_URL, CANVAS_BROWSER_HOST_URL, CANVAS_DESKTOP_AUTH_TOKEN are supported.');process.exit(0);}
const configErrors=canvasRuntimeConfigErrors({...process.env,...(option('--data-dir')?{CANVAS_DATA_DIR:option('--data-dir')}: {})});
if(configErrors.length)throw new Error(`Invalid canvas runtime configuration:\n - ${configErrors.join('\n - ')}`);
const dataRoot=option('--data-dir')??process.env.CANVAS_DATA_DIR;
if(!dataRoot||!path.isAbsolute(dataRoot))throw new Error('--data-dir or CANVAS_DATA_DIR must be an explicit absolute path');
const host=option('--host')??'127.0.0.1';
const authority=maAuthorityFromEnvironment(process.env);
if(!['127.0.0.1','::1','localhost'].includes(host)&&!process.env.CANVAS_AUTH_TOKEN&&!authority)throw new Error('Non-loopback binding requires verified MA authority or CANVAS_AUTH_TOKEN');
const port=Number(option('--port')??process.env.CANVAS_PORT??17456);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('invalid port');
const appwrite=process.env.APPWRITE_ENDPOINT?{endpoint:process.env.APPWRITE_ENDPOINT,projectId:process.env.APPWRITE_PROJECT??'',databaseId:process.env.APPWRITE_DATABASE??'canvas_app',bucketId:process.env.APPWRITE_BUCKET??'canvas_assets',...(process.env.APPWRITE_SESSION_COOKIE?{sessionCookie:process.env.APPWRITE_SESSION_COOKIE}:{}),...(process.env.APPWRITE_API_KEY?{apiKey:process.env.APPWRITE_API_KEY}:{}),...(process.env.APPWRITE_SESSION_SECRET?{sessionSecret:process.env.APPWRITE_SESSION_SECRET}:{}),...(process.env.APPWRITE_SESSION_MODE==='admin'?{sessionMode:'admin' as const}:{})}:undefined;
if(!appwrite&&process.env.CANVAS_STORAGE_MODE!=='local-test')throw new Error('Appwrite storage is required; isolated tests may explicitly set CANVAS_STORAGE_MODE=local-test');
if(appwrite){if(!process.env.APPWRITE_RUNTIME_COLLECTION||!process.env.CANVAS_RUNTIME_NAMESPACE||process.env.CANVAS_APPWRITE_SINGLE_WRITER!=='true'||process.env.CANVAS_REPLICAS!=='1')throw new Error('Cloud runtime requires APPWRITE_RUNTIME_COLLECTION, CANVAS_RUNTIME_NAMESPACE, CANVAS_APPWRITE_SINGLE_WRITER=true and CANVAS_REPLICAS=1');}
const independentImage=process.env.CANVAS_IMAGE_APP_ORIGIN&&process.env.CANVAS_IMAGE_APPLICATION_ID?{origin:process.env.CANVAS_IMAGE_APP_ORIGIN,applicationId:process.env.CANVAS_IMAGE_APPLICATION_ID}:undefined;
const createRuntime=()=>createCanvasServer({dataRoot,host,...(independentImage?{independentImage}:{}),trustedAppOrigins:process.env.CANVAS_TRUSTED_APP_ORIGINS?.split(',').map(x=>x.trim()).filter(Boolean),authorizeAction:createAppWriteAuthorizer(process.env.APP_WRITE_GRANTS_JSON),...(authority?{authority}:{}),...(appwrite?{appwrite:{...appwrite,runtime:{collectionId:process.env.APPWRITE_RUNTIME_COLLECTION!,namespace:process.env.CANVAS_RUNTIME_NAMESPACE!,singleWriter:true}}}:{}),...(process.env.CANVAS_MEDIA_ADAPTER_URL?{media:createHttpMediaAdapter(process.env.CANVAS_MEDIA_ADAPTER_URL,process.env.CANVAS_MEDIA_ADAPTER_TOKEN)}:{}),...(process.env.CANVAS_CAPABILITY_ADAPTER_URL?{capabilities:createHttpCapabilityAdapter(process.env.CANVAS_CAPABILITY_ADAPTER_URL,process.env.CANVAS_CAPABILITY_ADAPTER_TOKEN)}:{}),...(process.env.CANVAS_ASSET_ADAPTER_URL?{assets:createHttpAssetAdapter(process.env.CANVAS_ASSET_ADAPTER_URL,process.env.CANVAS_ASSET_ADAPTER_TOKEN)}:{}),...(process.env.CANVAS_AUTH_TOKEN?{authToken:process.env.CANVAS_AUTH_TOKEN}:{}),allowedOrigins:process.env.CANVAS_WEB_URL?[new URL(process.env.CANVAS_WEB_URL).origin]:[]});
const writerClient=appwrite?new AppwriteClient(appwrite):undefined;
const writer=appwrite&&writerClient?new AppwriteWriterLock({client:writerClient,databaseId:appwrite.databaseId,collectionId:process.env.APPWRITE_RUNTIME_COLLECTION!,serviceId:'canvas'}):undefined;
const server=await(async()=>{
 let api:ReturnType<typeof createCanvasServer>|undefined;
 try{if(process.env.NODE_ENV==='production'&&appwrite&&writerClient)await assertPrivateAppwriteStorage({client:writerClient,databaseId:appwrite.databaseId,collectionIds:['canvases','canvas_files','canvas_operations','apps','card_packs','card_grants',process.env.APPWRITE_RUNTIME_COLLECTION!],bucketId:appwrite.bucketId});await writer?.acquire();api=createRuntime();await api.ready;return api;}
 catch(error){await api?.close().catch(()=>{});await writer?.release().catch(()=>{});throw error;}
})();
const listener=server.app.listen(port,host,()=>console.log(JSON.stringify({service:'canvas-workspace',address:listener.address()})));
listener.on('upgrade',server.handleUpgrade);
let closing=false;
const shutdown=async()=>{
 if(closing)return;closing=true;
 const stopped=new Promise<void>(resolve=>listener.close(()=>resolve()));
 listener.closeIdleConnections();
 const deadline=setTimeout(()=>listener.closeAllConnections(),10000);deadline.unref();
 try{await Promise.all([stopped,server.close()]);await writer?.release();}
 catch{console.error('Canvas shutdown could not confirm durability; inspect the writer lock before restarting');process.exitCode=1;}
 finally{clearTimeout(deadline);}
};
listener.once('error',()=>{process.exitCode=1;void shutdown();});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void shutdown();});
