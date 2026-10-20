import { describe, expect, it } from 'vitest';
import { clipAudioGain, clipCompositionDuration, clipPlaybackRate, clipSourceTime, clipVisualFrame } from '../src/api/clip-composition.js';
import type { ClipEditorTimelineClip } from '../src/api/clip-editor.js';

const clip:ClipEditorTimelineClip={id:'v',kind:'video',name:'v',path:'v.mp4',mimeType:'video/mp4',start:2,sourceIn:0,duration:4,volume:0.8,fadeIn:1,fadeOut:1};
describe('shared clip composition',()=>{
  it('mixes linear fades and mute predictably at both boundaries',()=>{
    expect(clipAudioGain(clip,2)).toBe(0);expect(clipAudioGain(clip,2.5)).toBeCloseTo(0.4);
    expect(clipAudioGain(clip,4)).toBeCloseTo(0.8);expect(clipAudioGain(clip,5.5)).toBeCloseTo(0.4);
    expect(clipAudioGain({...clip,muted:true},4)).toBe(0);
  });
  it('maps composition time through speed and looping source media',()=>{
    expect(clipPlaybackRate({...clip,playbackRate:1.5})).toBe(1.5);
    expect(clipSourceTime({...clip,sourceIn:2,sourceDuration:12,playbackRate:2},4)).toBe(6);
    expect(clipSourceTime({...clip,sourceIn:2,sourceDuration:6,playbackRate:2,loop:true},5)).toBe(2);
  });
  it('shares visual animation geometry and media duration',()=>{
    const v={...clip,visual:{x:10,width:30,animation:'slide' as const,animationDuration:1}};
    expect(clipVisualFrame(v,2)).toMatchObject({x:20,width:30,opacity:0});
    expect(clipVisualFrame(v,3)).toMatchObject({x:10,opacity:1});
    expect(clipVisualFrame(v,6)).toMatchObject({x:0,opacity:0});
    expect(clipCompositionDuration({clips:[clip]})).toBe(6);
  });
});
