import type {TenantContext} from '../tenant.js';
const record=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const same=(value:unknown,expected:unknown)=>typeof value==='string'&&value.length>0&&value===expected;
/** Canvas stores the complete MA ownership either in appAuthority or in the
 * Provider mapping + its creation record. Neither a reused MA instance id nor
 * a partial legacy record grants access to a different application/provider. */
export function canvasProjectMatchesAuthority(project:{teamId?:string;metadata?:unknown},actor:Readonly<TenantContext>):boolean{
 if((project.teamId??'local')!==actor.teamId)return false;
 const metadata=record(project.metadata);if(!metadata)return false;
 if(Object.hasOwn(metadata,'appAuthority')){
  const mapping=record(metadata.appAuthority);return Boolean(mapping&&(['bizId','applicationId','applicationInstanceId','providerInstanceId'] as const).every(key=>same(mapping[key],actor[key])));
 }
 const mapping=record(metadata.canvasProvider),creation=record(metadata.canvasProviderCreation);
 return Boolean(mapping&&creation&&mapping.protocolVersion==='1.0'
  &&same(mapping.tenantId,actor.teamId)&&same(mapping.applicationId,actor.applicationId)&&same(mapping.providerInstanceId,actor.providerInstanceId)
  &&same(creation.bizId,actor.bizId)&&same(creation.applicationInstanceId,actor.applicationInstanceId));
}
