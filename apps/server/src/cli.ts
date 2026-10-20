#!/usr/bin/env node
import path from 'node:path';
import { createCanvasServer, createBrowserHostAdapter } from './server.js';
import {createHttpMediaAdapter,createHttpCapabilityAdapter,createHttpAssetAdapter} from './http-adapters.js';
const args=process.argv.slice(2);
if(args[0]==='request'||args[0]==='browser'||args[0]==='assets'){await (await import('./http-cli.js')).runHttpCli(args);process.exit(process.exitCode??0);}
function option(name:string):string|undefined{const index=args.indexOf(name);return index<0?undefined:args[index+1];}
if(args.includes('--help')){console.log('canvas-server --data-dir ABSOLUTE_PATH [--host 127.0.0.1] [--port 17456]\nRequires explicit DATA ROOT. CANVAS_DATA_DIR, CANVAS_PORT, CANVAS_AUTH_TOKEN, CANVAS_WEB_URL, CANVAS_BROWSER_HOST_URL, CANVAS_DESKTOP_AUTH_TOKEN are supported.');process.exit(0);}
const dataRoot=option('--data-dir')??process.env.CANVAS_DATA_DIR;
if(!dataRoot||!path.isAbsolute(dataRoot))throw new Error('--data-dir or CANVAS_DATA_DIR must be an explicit absolute path');
const host=option('--host')??'127.0.0.1';
if(!['127.0.0.1','::1','localhost'].includes(host)&&!process.env.CANVAS_AUTH_TOKEN)throw new Error('Non-loopback binding requires CANVAS_AUTH_TOKEN');
const port=Number(option('--port')??process.env.CANVAS_PORT??17456);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('invalid port');
const appwrite=process.env.APPWRITE_ENDPOINT?{endpoint:process.env.APPWRITE_ENDPOINT,projectId:process.env.APPWRITE_PROJECT??'',databaseId:process.env.APPWRITE_DATABASE??'canvas_app',bucketId:process.env.APPWRITE_BUCKET??'canvas_assets',...(process.env.APPWRITE_SESSION_COOKIE?{sessionCookie:process.env.APPWRITE_SESSION_COOKIE}:{})}:undefined;
const server=createCanvasServer({dataRoot,host,...(appwrite?{appwrite}:{}),...(process.env.CANVAS_MEDIA_ADAPTER_URL?{media:createHttpMediaAdapter(process.env.CANVAS_MEDIA_ADAPTER_URL,process.env.CANVAS_MEDIA_ADAPTER_TOKEN)}:{}),...(process.env.CANVAS_CAPABILITY_ADAPTER_URL?{capabilities:createHttpCapabilityAdapter(process.env.CANVAS_CAPABILITY_ADAPTER_URL,process.env.CANVAS_CAPABILITY_ADAPTER_TOKEN)}:{}),...(process.env.CANVAS_ASSET_ADAPTER_URL?{assets:createHttpAssetAdapter(process.env.CANVAS_ASSET_ADAPTER_URL,process.env.CANVAS_ASSET_ADAPTER_TOKEN)}:{}),...(process.env.CANVAS_AUTH_TOKEN?{authToken:process.env.CANVAS_AUTH_TOKEN}:{}),allowedOrigins:process.env.CANVAS_WEB_URL?[new URL(process.env.CANVAS_WEB_URL).origin]:[],...(process.env.CANVAS_BROWSER_HOST_URL&&process.env.CANVAS_DESKTOP_AUTH_TOKEN?{browserResources:createBrowserHostAdapter(process.env.CANVAS_BROWSER_HOST_URL,process.env.CANVAS_DESKTOP_AUTH_TOKEN)}:{})});
await server.ready;
const listener=server.app.listen(port,host,()=>console.log(JSON.stringify({service:'canvas-workspace',address:listener.address()})));
listener.on('upgrade',server.handleUpgrade);
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{const stopped=new Promise<void>(resolve=>listener.close(()=>resolve()));void Promise.all([stopped,server.close()]).finally(()=>process.exit(0));});
