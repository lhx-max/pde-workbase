import { parseDocument, stringify } from 'yaml';
import type { PersonalAsset } from './personal-assets.js';
export type AssetMetadata = Pick<PersonalAsset, 'name'|'description'|'tags'|'style'|'usage'>;
export function assetMetadataYaml(asset: AssetMetadata): string {
  return stringify({name:asset.name, description:asset.description, tags:asset.tags, style:asset.style || '', usage:asset.usage || ''});
}
export function parseAssetMetadataYaml(source: string): AssetMetadata {
  if (source.length > 30000) throw new Error('YAML 内容过长');
  const doc = parseDocument(source, {uniqueKeys:true});
  if(doc.errors.length) throw new Error(`YAML 格式错误：${doc.errors[0]?.message}`);
  const value = doc.toJS({maxAliasCount:0});
  if(!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请填写 YAML 字段');
  if(Object.keys(value).some(key=>!['name','description','tags','style','usage'].includes(key))) throw new Error('仅支持 name、description、tags、style、usage');
  for(const key of ['name','description','style','usage']) if(typeof value[key] !== 'string' || value[key].length > (key === 'name' ? 240 : 4000)) throw new Error(`${key} 必须是有效文本`);
  if(!value.name.trim()) throw new Error('名称不能为空');
  if(!Array.isArray(value.tags) || value.tags.length > 30 || value.tags.some((t:unknown)=>typeof t!=='string'||t.length>80)) throw new Error('tags 必须是标签列表，每个标签最多 80 字');
  return {name:value.name,description:value.description,tags:value.tags,style:value.style,usage:value.usage};
}
