import {PERSONAL_ASSET_CHANGED_EVENT,type PersonalAsset} from '@bezier/contracts';
import {personalAssets} from '../providers/asset-library';
import {OPEN_ASSET_LIBRARY_EVENT,type AssetLibraryRequest} from '../state/asset-library-navigation';
import {personalAssetPreviewSource} from './AssetContentPreview';
import type {QuestionReferenceAdapter,QuestionReferenceAsset} from './question-form-reference-adapter';
const reference=(asset:PersonalAsset):QuestionReferenceAsset=>({...asset,preview:personalAssetPreviewSource(asset)});
/** The built-in catalogue is the default, with identical selection semantics for injected sources. */
export function createAssetLibraryReferenceAdapter(projectId:string):QuestionReferenceAdapter{
 return {
  query:async({signal})=>{signal?.throwIfAborted();const {assets}=await personalAssets.list();signal?.throwIfAborted();return assets.filter(asset=>!asset.deletedAt&&asset.kind!=='folder').map(reference);},
  subscribe:refresh=>{window.addEventListener(PERSONAL_ASSET_CHANGED_EVENT,refresh);return()=>window.removeEventListener(PERSONAL_ASSET_CHANGED_EVENT,refresh);},
  open:({initial,signal,readOnly,onSelect})=>{
   if(signal.aborted)return;const controller=new AbortController();
   const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});controller.signal.addEventListener('abort',()=>signal.removeEventListener('abort',abort),{once:true});
   const request:AssetLibraryRequest={projectId,spaceId:initial?.spaceId||'default-project',kind:(initial?.kind||'image') as PersonalAsset['kind'],readOnly,selection:readOnly?undefined:{purpose:'reference',controller,onSelect:async asset=>{if(controller.signal.aborted)return false;const accepted=await onSelect(reference(asset));if(accepted)controller.abort();return accepted;}}};
   window.dispatchEvent(new CustomEvent(OPEN_ASSET_LIBRARY_EVENT,{detail:request}));
  },
 };
}
