import {it,expect} from 'vitest';
import {emptyAssetFilters,matchesAssetFilters} from '../src/components/asset-filters';
import type {PersonalAsset} from '@bezier/contracts';
const a={parentId:'folder',createdAt:new Date('2026-09-01').getTime(),updatedAt:Date.now(),versions:[{filename:'a.png',size:1000,imageMetadata:{width:200,height:100,colors:[{hex:'#ff0000',weight:1}]}}]} as PersonalAsset;
it('combines color, shape, size, format, location and date filters',()=>{
 expect(matchesAssetFilters(a,{...emptyAssetFilters,color:'#ef4444',shape:'landscape',format:'png',location:'folder',minWidth:'100',maxSize:'1',addedAfter:'2026-08-01'})).toBe(true);
 for(const f of [{color:'#0000ff'},{shape:'portrait'},{minHeight:'200'},{location:'root'},{addedAfter:'2026-10-01'},{maxSize:'0.0001'}]) expect(matchesAssetFilters(a,{...emptyAssetFilters,...f})).toBe(false);
});
it('does not match images without extracted metadata',()=>{expect(matchesAssetFilters({...a,versions:[]},{...emptyAssetFilters,color:'#ff0000'})).toBe(false);});
it('filters minimum rating and treats old assets as unrated',()=>{
 expect(matchesAssetFilters({...a,rating:4},{...emptyAssetFilters,rating:'3'})).toBe(true);
 expect(matchesAssetFilters({...a,rating:2},{...emptyAssetFilters,rating:'3'})).toBe(false);
 expect(matchesAssetFilters(a,{...emptyAssetFilters,rating:'unrated'})).toBe(true);
 expect(matchesAssetFilters({...a,rating:4},{...emptyAssetFilters,rating:'unrated'})).toBe(false);
});
