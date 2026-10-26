import { describe,it,expect } from 'vitest';
import {createMaAuthority} from '../src/index.js';

const headers={'x-mav-sso-authorization':'Bearer user-token','x-mav-tenant':'team-a','x-mav-application-instance-id':'ai_a','x-team-id':'forged','x-user-id':'forged'};
describe('MA authority adapter',()=>{
 it('derives actor and instance scope from successful upstream reads, ignoring self-reported actor',async()=>{
  const calls:Array<{url:string;headers:Headers}>=[];
  const resolve=createMaAuthority({transport:{origin:'http://127.0.0.1:1234'},fetcher:async(url,init)=>{
   calls.push({url:String(url),headers:new Headers(init?.headers)});
   return Response.json({data:String(url).endsWith('/me')?{userId:'verified-user',status:'active'}:{applicationInstanceId:'ai_a',applicationId:'app_a',providerInstanceId:'provider-a',bizId:'biz-a',status:'active'}});
  }});
  expect(await resolve(headers)).toEqual({teamId:'team-a',userId:'verified-user',bizId:'biz-a',applicationId:'app_a',applicationInstanceId:'ai_a',providerInstanceId:'provider-a'});
  expect(calls).toHaveLength(2);expect(calls[1]!.headers.get('authorization')).toBe('Bearer user-token');expect(calls[1]!.headers.has('x-user-id')).toBe(false);
 });
 it('never downgrades missing credentials to local or header identity',async()=>{
  const resolve=createMaAuthority({transport:{origin:'https://ma.example.test'}});
  await expect(resolve({'x-team-id':'team-a','x-user-id':'admin'})).rejects.toMatchObject({status:401});
 });
 it('rejects a valid user without access to the selected instance',async()=>{
  const resolve=createMaAuthority({transport:{origin:'https://ma.example.test'},fetcher:async(url)=>String(url).endsWith('/me')?Response.json({data:{userId:'user',status:'active'}}):Response.json({}, {status:403})});
  await expect(resolve(headers)).rejects.toMatchObject({status:403});
 });
 it('unwraps Function execution status and rejects mismatched returned identity',async()=>{
  const resolve=createMaAuthority({transport:{endpoint:'https://cloud.example.test/v1/functions/mavapi/executions',projectId:'ma'},fetcher:async(_url,init)=>{
   const request=JSON.parse(String(init?.body));
   const data=request.path.endsWith('/me')?{userId:'verified-user',status:'active'}:{applicationInstanceId:'ai_other',status:'active'};
   return Response.json({status:'completed',responseStatusCode:200,responseBody:JSON.stringify({data})});
  }});
  await expect(resolve(headers)).rejects.toMatchObject({status:403});
 });
 it('treats outages and malformed responses as unavailable, never allow-all',async()=>{
  const resolve=createMaAuthority({transport:{origin:'https://ma.example.test'},fetcher:async()=>{throw Error('network')}});
  await expect(resolve(headers)).rejects.toMatchObject({status:503});
 });
});
