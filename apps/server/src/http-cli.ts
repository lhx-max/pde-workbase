import {readFile} from 'node:fs/promises';
/** Generic API CLI keeps every canvas capability scriptable without a second store. */
export async function runHttpCli(args:string[]):Promise<void>{
 const flag=(name:string)=>{const i=args.indexOf(`--${name}`);return i<0?undefined:args[i+1];};
 const base=flag('server-url')??process.env.CANVAS_SERVER_URL;
 if(!base)throw new Error('--server-url or CANVAS_SERVER_URL is required for API commands');
 const headers:Record<string,string>={'Content-Type':'application/json',...(process.env.CANVAS_AUTH_TOKEN?{Authorization:`Bearer ${process.env.CANVAS_AUTH_TOKEN}`}:{})};
 let endpoint:string,method:string,body:string|undefined;
 if(args[0]==='browser'){
  if(args[1]!=='resources')throw new Error('Expected browser resources start|stop|list|scan|read');
  const action=args[2]==='list'?'snapshot':args[2];
  if(!action||!['start','stop','snapshot','scan','read'].includes(action))throw new Error('Invalid browser resource action');
  const project=flag('project'),sessionId=flag('session'),token=flag('token')??process.env.CANVAS_BROWSER_RESOURCE_TOKEN;
  if(!project||!sessionId||!token)throw new Error('--project --session and CANVAS_BROWSER_RESOURCE_TOKEN are required');
  endpoint=`/api/projects/${encodeURIComponent(project)}/browser-resources/${action}`;method='POST';headers['x-browser-resource-token']=token;
  body=JSON.stringify({sessionId,...(action==='read'?{resourceId:flag('id'),navigationId:Number(flag('navigation'))}:{})});
 }else{
  method=(args[1]??'GET').toUpperCase();endpoint=args[2]??'';
  if(!['GET','POST','PATCH','PUT','DELETE'].includes(method)||!endpoint.startsWith('/api/'))throw new Error('request METHOD /api/path [--body-file JSON_PATH|-] [--json]');
  const file=flag('body-file');if(file)body=file==='-'?await new Promise<string>((resolve,reject)=>{let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>text+=chunk);process.stdin.once('end',()=>resolve(text));process.stdin.once('error',reject);}):await readFile(file,'utf8');
 }
 const response=await fetch(new URL(endpoint,base),{method,headers,...(body!==undefined?{body}: {})});
 const text=await response.text();process.stdout.write(text+'\n');if(!response.ok)process.exitCode=1;
}
