'use client';
import React from 'react';
import {I18nProvider,SketchEditorPane,serializeExcalidrawSketchScene} from '@sketch/surface';
type Props=Omit<React.ComponentProps<typeof SketchEditorPane>,'onSceneChange'>&{onSceneSerialized:(content:string)=>void};
/** Excalidraw requires a browser document; load only when a sketch tab mounts. */
export default function SketchAppPane({onSceneSerialized,...props}:Props){
 return <I18nProvider><SketchEditorPane {...props} onSceneChange={scene=>onSceneSerialized(serializeExcalidrawSketchScene(scene,props.sketch.name))}/></I18nProvider>;
}
