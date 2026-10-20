import type { PersonalAsset } from '@bezier/contracts';
import type { AssetLibrarySelection } from '../components/asset-ui-ports';
export type { AssetLibrarySelection } from '../components/asset-ui-ports';
export const OPEN_ASSET_LIBRARY_EVENT = 'bezier-design:open-asset-library';
export type AssetLibraryRequest = { spaceId:string; kind:PersonalAsset['kind']; projectId?:string; selection?:AssetLibrarySelection; full?:boolean;readOnly?:boolean };
/** The caller owns cancellation and acceptance; opening never runs an agent. */
export function openAssetLibrary(asset:Pick<PersonalAsset,'spaceId'|'kind'>,selection?:AssetLibrarySelection,projectId?:string) {
 window.dispatchEvent(new CustomEvent<AssetLibraryRequest>(OPEN_ASSET_LIBRARY_EVENT,{detail:{spaceId:asset.spaceId||'default-project',kind:asset.kind,selection,projectId}}));
}
export function assetKindTab(kind:PersonalAsset['kind']):string {return ({slides:'Slides',webpage:'Prototype',image:'Image',motion:'HyperFrames'} as Record<string,string>)[kind]??kind;}
