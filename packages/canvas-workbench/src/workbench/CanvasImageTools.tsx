'use client';
import React from 'react';
import {ImageCardTools} from '@ks-designai/image-card-pack/react';
import type {CanvasImageReference} from '@bezier/contracts';
import {createIndependentImageToolSession} from '../platform/independent-image-tools';
import {getCanvasHostContext} from '../platform/api-base';
import {createCanvasImageEditSession,loadCanvasImageTools,createCanvasImageToolRunner,uploadImageToolInput,listCanvasImageToolCandidates} from '../platform/image-tools';
/** Adapter only: original panels, styles and interaction stay owned by the image App package. */
export function CanvasImageTools(props:Omit<React.ComponentProps<typeof ImageCardTools>,'loadCapabilities'|'onSubmit'|'onUpload'|'getToolbarViewport'|'onLoadEditState'|'onSaveEditState'> & {nodeId:string;imageReference?:CanvasImageReference;x?:number;y?:number}){
 const {nodeId,imageReference,x=0,y=0,...rest}=props;const context=getCanvasHostContext();const abort=React.useRef(new AbortController());
 React.useEffect(()=>{const controller=new AbortController();abort.current=controller;return()=>controller.abort();},[context,nodeId]);
 const referenceKey=JSON.stringify(imageReference);
 const independent=React.useMemo(()=>imageReference?createIndependentImageToolSession(context,nodeId,imageReference,{x,y},()=>abort.current.signal):undefined,[context,nodeId,referenceKey]);
 const run=React.useMemo(()=>createCanvasImageToolRunner(context,nodeId,()=>abort.current.signal),[context,nodeId]);
 const edit=React.useMemo(()=>createCanvasImageEditSession(context,nodeId),[context,nodeId]);
 const load=React.useCallback(()=>independent?independent.loadCapabilities():loadCanvasImageTools(context),[context,independent]);
 const getViewport=()=>{
  const root=rest.target()?.closest('.xy-flow-host');
  if(!root)return null;
  const {left,top,width,height}=root.getBoundingClientRect();return {left,top,width,height};
 };
 return <ImageCardTools {...rest} onLoadEditState={independent?undefined:edit.load} onSaveEditState={independent?undefined:edit.save} onCreateImages={independent?.createImages} getToolbarViewport={getViewport} loadCapabilities={load} getCandidates={independent?undefined:()=>listCanvasImageToolCandidates(context)} onUpload={independent?independent.upload:file=>uploadImageToolInput(context,file)} onSubmit={independent?independent.run:run}/>;
}
