import type {CanvasTransport} from './api-base';

/** Host supplies its SDK credential getter; the surface never logs in, stores
 * JWTs, or treats a browser actor object as authorization. The same fetcher
 * can be injected into the App-owned Provider wrapper. Browser navigations
 * (img/frame) additionally need a host cookie proxy or scoped resourceUrl.
 */
export function createMaCanvasTransport(options:{baseUrl:string;tenantId:string;applicationInstanceId:string;getCredential:()=>Promise<string>;fetcher?:typeof fetch;resourceUrl?:(url:string)=>string}):CanvasTransport{
 const base=new URL(options.baseUrl);
 if(base.username||base.password||base.search||base.hash||!['http:','https:'].includes(base.protocol)||(base.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw new Error('Invalid App API URL');
 const prefix=base.pathname.replace(/\/+$/,'');
 const request=async(url:string,init?:RequestInit)=>{
  const target=new URL(url,base);
  if(target.origin!==base.origin||(prefix&&target.pathname!==prefix&&!target.pathname.startsWith(`${prefix}/`)))throw new Error('MA credentials must remain under the configured App API');
  const credential=await options.getCredential();
  if(!/^Bearer [A-Za-z0-9\-._~+/]+=*$/i.test(credential))throw new Error('MA SDK credential unavailable');
  const headers=new Headers(init?.headers);headers.set('x-mav-sso-authorization',credential);headers.set('x-mav-tenant',options.tenantId);headers.set('x-mav-application-instance-id',options.applicationInstanceId);
  return (options.fetcher??fetch)(target.href,{...init,headers,redirect:'error'});
 };
 return{baseUrl:options.baseUrl,fetch:request,...(options.resourceUrl?{resourceUrl:options.resourceUrl}:{})};
}
