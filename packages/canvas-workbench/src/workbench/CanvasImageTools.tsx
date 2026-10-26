'use client';
import React from 'react';
import {ImageCardTools} from '@ks-designai/image-card-pack/react';
import {getCanvasHostContext} from '../platform/api-base';
import {createCanvasImageEditSession,loadCanvasImageTools,createCanvasImageToolRunner,uploadImageToolInput,listCanvasImageToolCandidates} from '../platform/image-tools';
/** Adapter only: original panels, styles and interaction stay owned by the image App package. */
export function CanvasImageTools(props:Omit<React.ComponentProps<typeof ImageCardTools>,'loadCapabilities'|'onSubmit'|'onUpload'|'getToolbarViewport'|'onLoadEditState'|'onSaveEditState'> & {nodeId:string}){
 const {nodeId,...rest}=props;const context=getCanvasHostContext();const abort=React.useRef(new AbortController());
 React.useEffect(()=>{const controller=new AbortController();abort.current=controller;return()=>controller.abort();},[context,nodeId]);
 const run=React.useMemo(()=>createCanvasImageToolRunner(context,nodeId,()=>abort.current.signal),[context,nodeId]);
 const edit=React.useMemo(()=>createCanvasImageEditSession(context,nodeId),[context,nodeId]);
 const load=React.useCallback(()=>loadCanvasImageTools(context),[context]);
 const getViewport=()=>{
  const root=rest.target()?.closest('.xy-flow-host');
  if(!root)return null;
  const {left,top,width,height}=root.getBoundingClientRect();return {left,top,width,height};
 };
 return <ImageCardTools {...rest} onLoadEditState={edit.load} onSaveEditState={edit.save} getToolbarViewport={getViewport} loadCapabilities={load} getCandidates={()=>listCanvasImageToolCandidates(context)} onUpload={file=>uploadImageToolInput(context,file)} onSubmit={run}/>;
}
