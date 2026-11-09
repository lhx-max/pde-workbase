import assert from 'node:assert/strict';
import handler from '../functions/canvas-coi/src/main.js';

for(const [method,path,status] of [
  ['GET','/api/health',200],['GET','/api/apps/canvas',200],
  ['GET','/debug/env',501],['POST','/api/apps/canvas/actions/canvas.create',501],
  ['GET','/api/apps/canvas/instances/foreign/state',501],
  ['POST','/open-platform/v1/instances/foreign/actions/canvas.operations',501],
] as const){
  let result:unknown;
  await handler({req:{method,path,bodyText:JSON.stringify({actor:{userId:'forged',tenantId:'foreign'}}),headers:{}},res:{json(body,actual){assert.equal(actual,status);result=body;}},log(){},error(){}});
  const body=result as {error?:{code:string};data?:{status?:string;actions?:unknown[]}};
  if(status===501)assert.equal(body.error?.code,'CANVAS_FUNCTION_PARTIAL');
  else{assert.equal(body.data?.status,'partial');if(path.endsWith('/canvas'))assert.deepEqual(body.data?.actions,[]);}
}
console.log(JSON.stringify({passed:true,checks:6,network:'none',businessWrites:'unavailable',deployed:false}));
