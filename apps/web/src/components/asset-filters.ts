import type { PersonalAsset } from '@bezier/contracts';
export type AssetFilters = { rating:string; color:string; format:string; location:string; shape:string; minWidth:string; minHeight:string; maxSize:string; addedAfter:string; modifiedAfter:string };
export const emptyAssetFilters: AssetFilters = {rating:'',color:'',format:'',location:'',shape:'',minWidth:'',minHeight:'',maxSize:'',addedAfter:'',modifiedAfter:''};
export const assetFilterLabels: Record<keyof AssetFilters,string> = {rating:'Rating',color:'Color',format:'Format',location:'Location',shape:'Shape',minWidth:'Min width',minHeight:'Min height',maxSize:'Max size MB',addedAfter:'Added after',modifiedAfter:'Modified after'};
export function assetFormat(asset:PersonalAsset) { const v=asset.versions.at(-1); return (v?.imageMetadata?.format || v?.filename.split('.').pop() || '').toLowerCase().replace('jpeg','jpg'); }
function rgb(hex:string) { return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)); }
export function colorDistance(a:string,b:string) { const x=rgb(a),y=rgb(b); return Math.sqrt(x.reduce((s,v,i)=>s+(v-y[i]!)**2,0)); }
export function matchesAssetFilters(a:PersonalAsset,f:AssetFilters) {
  const v=a.versions.at(-1), m=v?.imageMetadata;
  if(f.rating && (f.rating==='unrated' ? !!a.rating : (a.rating||0)<Number(f.rating))) return false;
  if(f.location && (a.parentId||'root')!==f.location) return false;
  if(f.format && assetFormat(a)!==f.format) return false;
  if(f.color && !m?.colors.some(c=>c.weight>=0.02 && colorDistance(c.hex,f.color)<105)) return false;
  if(f.minWidth && !(m?.width && m.width>=Number(f.minWidth))) return false;
  if(f.minHeight && !(m?.height && m.height>=Number(f.minHeight))) return false;
  if(f.maxSize && (!v || v.size>Number(f.maxSize)*1024*1024)) return false;
  if(f.shape) { if(!m?.width || !m.height) return false; const r=m.width/m.height; if(f.shape==='square'?Math.abs(r-1)>.05:f.shape==='landscape'?r<=1.05:r>=.95) return false; }
  if(f.addedAfter && a.createdAt<new Date(f.addedAfter+'T00:00:00').getTime()) return false;
  if(f.modifiedAfter && a.updatedAt<new Date(f.modifiedAfter+'T00:00:00').getTime()) return false;
  return true;
}
