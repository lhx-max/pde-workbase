/** Original CanvasAssetsSidebar asset pane, reused by its compact and full-library views. */
import {useEffect,useMemo,useRef,useState} from 'react';
import {PERSONAL_ASSET_CHANGED_EVENT,type AssetLibraryInfo,type DesignSystemSummary,type PersonalAsset} from '@bezier/contracts';
import {Button,Input,Tabs,TabsList,TabsTrigger} from './ui';
import {AssetLibrarySpacePicker} from './AssetLibrarySpacePicker';
import {Icon} from './Icon';
import {PersonalAssetLibrary} from './PersonalAssetLibrary';
import {ProjectCard} from './ProjectCard';
import {FilterChipRail} from './FilterChipRail';
import {WorkspaceEmptyState} from './WorkspaceEmptyState';
import {AssetTypeEditor,ASSET_TYPE_IDS,useAssetTypeSettings} from './AssetTypeEditor';
import {useI18n} from '../i18n';
import {getActiveAssetLibraryAdapter,getAssetLibrarySourceId,hasExternalAssetLibrary,selectAssetLibrarySource} from '../providers/asset-library';
import {assetKindTab,type AssetLibraryRequest} from '../state/asset-library-navigation';
import {DEFAULT_PROJECT_FOLDER_ID,PROJECT_FOLDERS_CHANGED_EVENT,readProjectFolders,readSelectedProjectFolderId,writeSelectedProjectFolderId,syncProjectFolders} from '../state/project-folders';
import type {TemplateDemo} from './asset-ui-ports';
import styles from './CanvasAssetsSidebar.module.css';
import sourceStyles from './AssetLibrarySourceSwitch.module.css';
const EMPTY_SYSTEMS:DesignSystemSummary[]=[];
export interface AssetLibraryPanelProps {
 projectId:string; compact?:boolean; viewerOnly?:boolean; openRequest?:AssetLibraryRequest|null;
 installedTemplates?:TemplateDemo[];designSystems?:DesignSystemSummary[];
 onUseTemplate?:(template:TemplateDemo)=>void;onOpenDesignSystem?:(system:DesignSystemSummary)=>void;
 onRefreshFiles?:()=>Promise<void>|void;onCancelSelection?:()=>void;
 onOpenAssetLibrary?:(request:AssetLibraryRequest)=>void;
}
export function AssetLibraryPanel({projectId,compact=true,viewerOnly=false,openRequest,installedTemplates,designSystems=EMPTY_SYSTEMS,onUseTemplate,onOpenDesignSystem,onRefreshFiles,onCancelSelection,onOpenAssetLibrary}:AssetLibraryPanelProps){
 const {t}=useI18n();
 const [sourceId,setSourceId]=useState(getAssetLibrarySourceId);
 const [info,setInfo]=useState<AssetLibraryInfo|null>(null);
 const [spaceRevision,setSpaceRevision]=useState(0);
 const [spaceError,setSpaceError]=useState('');
 const [spaceId,setSpaceId]=useState(()=>readSelectedProjectFolderId('local')||DEFAULT_PROJECT_FOLDER_ID);
 const [assetQuery,setAssetQuery]=useState('');
 const [expandedSystemId,setExpandedSystemId]=useState<string|null>(null);
 const {settings:assetTypeSettings,ready:assetTypeSettingsReady,save:saveTypeSettings,saveError:typeSaveError}=useAssetTypeSettings();
 const [assetType,setAssetType]=useState('Image');
 const latestOpenRequest=useRef(openRequest);
 latestOpenRequest.current=openRequest;
 const spaceChoiceRevision=useRef(0);
 useEffect(()=>{
   let alive=true,generation=0,source=getAssetLibrarySourceId(),adapter=getActiveAssetLibraryAdapter();
   let restored=false,choiceAtStart=spaceChoiceRevision.current;
   const refresh=()=>{
     const ticket=++generation,next=getAssetLibrarySourceId(),nextAdapter=getActiveAssetLibraryAdapter();
     setSourceId(next);
     if(source!==next||adapter!==nextAdapter){
       source=next;adapter=nextAdapter;restored=false;choiceAtStart=spaceChoiceRevision.current;
       setInfo(null);setSpaceId(latestOpenRequest.current?.spaceId??DEFAULT_PROJECT_FOLDER_ID);
     }
     const requestAdapter=nextAdapter;
     const current=()=>alive&&ticket===generation&&requestAdapter===getActiveAssetLibraryAdapter()&&next===getAssetLibrarySourceId();
     void Promise.all([requestAdapter.info(),syncProjectFolders('local')]).then(([value])=>{
       if(!current())return;
       setInfo(value);setSpaceRevision(value=>value+1);setSpaceError('');
       // Restore only after the cache resolves its source namespace. Never replace
       // an explicit request or a user selection made while the source was loading.
       if(!restored){
         restored=true;
         if(!latestOpenRequest.current?.spaceId&&spaceChoiceRevision.current===choiceAtStart){
           const selected=readSelectedProjectFolderId('local')||DEFAULT_PROJECT_FOLDER_ID;
           setSpaceId(readProjectFolders('local').some(space=>space.id===selected)?selected:DEFAULT_PROJECT_FOLDER_ID);
         }
       }
     }).catch(error=>{if(current())setSpaceError(error.message);});
   };
   const spaces=()=>setSpaceRevision(value=>value+1);
   refresh();window.addEventListener(PERSONAL_ASSET_CHANGED_EVENT,refresh);window.addEventListener(PROJECT_FOLDERS_CHANGED_EVENT,spaces);window.addEventListener('focus',refresh);
   return()=>{alive=false;window.removeEventListener(PERSONAL_ASSET_CHANGED_EVENT,refresh);window.removeEventListener(PROJECT_FOLDERS_CHANGED_EVENT,spaces);window.removeEventListener('focus',refresh);};
 },[]);
 const spaceOptions=useMemo(()=>readProjectFolders('local'),[spaceRevision,sourceId]);
 const activeSpace=spaceOptions.find(space=>space.id===spaceId)??spaceOptions[0]!;
 const labels:Record<string,string>={text:t('entry.canvasAssets.assetType.text'),script:t('entry.canvasAssets.assetType.script'),audio:t('entry.canvasAssets.assetType.audio'),Image:t('entry.personalAssets.kind.image'),Slides:t('entry.personalAssets.kind.slides'),Prototype:t('entry.personalAssets.kind.webpage'),HyperFrames:t('entry.personalAssets.kind.motion'),'design-systems':t('entry.canvasAssets.assetType.designSystems')};
 const allAssetTypeItems=ASSET_TYPE_IDS.map(id=>({id,label:labels[id]??id}));
 const assetTypeItems=assetTypeSettings.order.filter(id=>ASSET_TYPE_IDS.includes(id)&&!assetTypeSettings.hidden.includes(id)).map(id=>({id,label:labels[id]??id}));
 const appliedRequest=useRef<AssetLibraryRequest|null>(null);
 useEffect(()=>{if(!openRequest||appliedRequest.current===openRequest||!assetTypeSettingsReady)return;appliedRequest.current=openRequest;spaceChoiceRevision.current++;setSpaceId(openRequest.spaceId);setAssetQuery('');setAssetType(assetKindTab(openRequest.kind));},[openRequest,assetTypeSettingsReady]);
 const previousScope=useRef(`${sourceId}:${activeSpace.id}`);
 useEffect(()=>{if(!assetTypeSettingsReady)return;const scope=`${sourceId}:${activeSpace.id}`;if(previousScope.current!==scope && appliedRequest.current!==openRequest){setAssetType(assetTypeSettings.order.find(id=>!assetTypeSettings.hidden.includes(id))??'Image');}previousScope.current=scope;},[sourceId,activeSpace.id,assetTypeSettings,assetTypeSettingsReady,openRequest]);
 const personalAssetKind=({Image:'image',Slides:'slides',Prototype:'webpage',HyperFrames:'motion'} as Record<string,string>)[assetType]??assetType;
 const visibleDesignSystems=designSystems.filter(system=>!assetQuery.trim()||[system.title,system.summary,system.category].some(value=>value.toLocaleLowerCase().includes(assetQuery.trim().toLocaleLowerCase())));
 const selectSpace=(id:string)=>{spaceChoiceRevision.current++;onCancelSelection?.();setSpaceId(id);writeSelectedProjectFolderId('local',id);setAssetType(assetTypeItems[0]?.id??'Image');};
 return <>{spaceError?<p role="alert">{spaceError}<Button variant="ghost" onClick={()=>window.dispatchEvent(new Event(PERSONAL_ASSET_CHANGED_EVENT))}>{t('common.retry')}</Button></p>:null}
      <div className={styles.assetWorkspace}>
        <div className={styles.assetScopeRow}>
          <Tabs value={sourceId} onValueChange={value => { onCancelSelection?.(); selectAssetLibrarySource(value as 'local'|'external'); }}><TabsList className={`${sourceStyles.scopeList} ${compact?sourceStyles.scopeListCompact:''}`} aria-label={t('assetLibrary.sources')}><TabsTrigger className={`${sourceStyles.scopeButton} ${compact?sourceStyles.scopeButtonCompact:''}`} value="local">{sourceId==='local' && info?.source.kind==='external' ? info.source.name : t('assetLibrary.local')}</TabsTrigger>{hasExternalAssetLibrary() ? <TabsTrigger className={`${sourceStyles.scopeButton} ${compact?sourceStyles.scopeButtonCompact:''}`} value="external">{sourceId==='external' && info ? info.source.name : t('assetLibrary.external')}</TabsTrigger> : null}</TabsList></Tabs>
          <AssetLibrarySpacePicker scope="local" value={activeSpace.id} spaces={spaceOptions} onChange={selectSpace}
            onRefresh={()=>setSpaceRevision(value=>value+1)} viewerOnly={viewerOnly||openRequest?.readOnly}/>
          {onOpenAssetLibrary ? <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`${styles.openLibraryButton} bezier-tooltip`}
            aria-label={t('entry.canvasAssets.openFullLibrary')}
            data-tooltip={t('entry.canvasAssets.openFullLibrary')}
            data-tooltip-placement="bottom"
            onClick={() => onOpenAssetLibrary?.({spaceId:activeSpace.id,kind:personalAssetKind as PersonalAsset['kind'],full:true,selection:openRequest?.selection,readOnly:openRequest?.readOnly})}
          >
            <Icon name="maximize" size={15} />
          </Button> : null}
        </div>

        <>
          <div className={styles.assetFilters}>
            <FilterChipRail
              className={styles.assetTypeRail}
              scrollControls
              ariaLabel={t('entry.canvasAssets.assetTypeAria')}
              items={assetTypeItems}
              value={assetType}
              onValueChange={value => { if (openRequest?.selection?.purpose !== 'reference') onCancelSelection?.(); setAssetType(value); }}
            />
          </div>
          {assetType === 'design-systems' ? <>
            <div className={styles.toolbar}>
              <label className={styles.searchBox}>
                <Icon name="search" size={15} />
                <Input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder={t('entry.canvasAssets.searchDesignSystems')} aria-label={t('entry.canvasAssets.searchDesignSystems')} />
                {assetQuery ? <Button type="button" aria-label={t('entry.canvasAssets.clearSearch')} onClick={() => setAssetQuery('')}><Icon name="close" size={13} /></Button> : null}
              </label>
            </div>
            <div className={`${styles.content} ${styles.assetContent}`}>
              <div className={styles.designSystemList} data-testid="canvas-design-systems-grid">
                {visibleDesignSystems.map((system) => {
                  const swatches = system.swatches?.length ? system.swatches.slice(0, 5) : ['#18181b', '#52525b', '#a1a1aa', '#e4e4e7'];
                  return <ProjectCard key={system.id} layout="list" density="compact" className={styles.designSystemCard} data-testid={`canvas-sidebar-design-system-${system.id}`}>
                    <Button variant="ghost" className={styles.designSystemTrigger} aria-expanded={expandedSystemId === system.id} aria-label={t('entry.canvasAssets.viewSystemAria', { title: system.title })} onClick={() => setExpandedSystemId(current => current === system.id ? null : system.id)}>
                      <span className={styles.designSystemSwatches} aria-hidden>{swatches.map((color, index) => <i key={`${color}-${index}`} style={{ background: color }} />)}</span>
                      <span className={styles.systemIdentity}><strong>{system.title}</strong><span>{system.category}</span></span>
                      <Icon name={expandedSystemId === system.id ? 'chevron-down' : 'chevron-right'} size={14} />
                    </Button>
                    {expandedSystemId === system.id ? <div className={styles.systemDetails}>
                      <p>{system.summary}</p>
                      <div className={styles.systemColors}>{swatches.map((color, index) => <span key={`${color}-${index}`}><i style={{ background: color }} />{color}</span>)}</div>
                      <Button variant="ghost" size="sm" disabled={!onOpenDesignSystem} onClick={() => { onOpenDesignSystem?.(system); }}>{t('entry.canvasAssets.viewFullSystem')}<Icon name="external-link" size={13} /></Button>
                    </div> : null}
                  </ProjectCard>;
                })}
              </div>
              {!visibleDesignSystems.length ? <WorkspaceEmptyState>
                <span><Icon name="search" size={24} /></span>
                <strong>{assetQuery ? t('entry.canvasAssets.emptySystemsFiltered') : t('entry.canvasAssets.emptySystems')}</strong>
                <p>{assetQuery ? t('entry.canvasAssets.emptySystemsFilteredHint') : t('entry.canvasAssets.emptySystemsHint')}</p>
              </WorkspaceEmptyState> : null}
            </div>
          </> : <div className={styles.personalAssetContent}>
            <PersonalAssetLibrary
              conversationSelection={openRequest?.selection}
              key={`${sourceId}:${activeSpace.id}`}
              compact={compact}
              projectId={projectId}
              spaceId={activeSpace.id}
              spaceOptions={spaceOptions}
              installedTemplates={activeSpace.id === DEFAULT_PROJECT_FOLDER_ID ? installedTemplates : undefined}
              kindFilter={personalAssetKind}
              searchValue={assetQuery}
              onSearchChange={setAssetQuery}
              onUseTemplate={onUseTemplate}
              viewerOnly={viewerOnly||openRequest?.readOnly}
              editModeTools={<AssetTypeEditor items={allAssetTypeItems} settings={assetTypeSettings} onChange={saveTypeSettings} saveError={typeSaveError} />}
              onRefreshFiles={onRefreshFiles}
            />
          </div>}
        </>
      </div>
 </>;
}
