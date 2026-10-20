import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ClipEditorTimeline } from '@bezier/contracts';
import {
  buildClipEditorFfmpegArgs,
  renderClipEditorTimeline,
  validateClipEditorTimeline,
} from '../../src/media/clip-export.js';

const timeline: ClipEditorTimeline = {
  version: 1,
  playhead: 0,
  clips: [{
    id: 'still', kind: 'image', name: 'still.ppm', path: 'still.ppm', mimeType: 'image/x-portable-pixmap', start: 0, sourceIn: 0, duration: 0.5,
  }],
};

describe('clip editor export', () => {
  it('rejects invalid effect parameters',()=>{
    for(const visual of [{rotation:NaN},{width:0},{opacity:4},{crop:{top:60,right:0,bottom:0,left:0}},{animation:'evil'}]) {
      expect(()=>validateClipEditorTimeline({...timeline,clips:[{...timeline.clips[0],visual}]})).toThrow();
    }
  });
  it.skipIf(!existsSync('/opt/homebrew/bin/ffmpeg'))('renders real layers, cropped rotated picture-in-picture, animation and faded audio', async()=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'bezier-clip-effects-'));
    const exec=promisify(execFile);
    try {
      const red=path.join(directory,'red.ppm');const blue=path.join(directory,'blue.ppm');const wav=path.join(directory,'a.wav');const output=path.join(directory,'out.mp4');
      await writeFile(red,'P3\n2 2\n255\n255 0 0 255 0 0 255 0 0 255 0 0\n');
      await writeFile(blue,'P3\n2 2\n255\n0 0 255 0 0 255 0 0 255 0 0 255\n');
      await exec('/opt/homebrew/bin/ffmpeg',['-y','-f','lavfi','-i','sine=frequency=440:duration=2',wav]);
      const project=validateClipEditorTimeline({...timeline,width:320,height:180,clips:[
        {...timeline.clips[0],id:'red',path:'red',duration:2,fit:'cover'},
        {...timeline.clips[0],id:'blue',path:'blue',duration:2,track:1,fit:'cover',visual:{x:50,y:25,width:40,height:40,rotation:15,crop:{top:10,right:10,bottom:10,left:10},animation:'slide',animationDuration:0.3}},
        {...timeline.clips[0],id:'audio',kind:'audio',path:'audio',duration:2,fadeIn:0.5,fadeOut:0.5},
      ]});
      await writeFile(output,await renderClipEditorTimeline({timeline:project,sources:new Map([['red',red],['blue',blue],['audio',wav]]),ffmpegPath:'/opt/homebrew/bin/ffmpeg'}));
      const {stdout}=await exec('/opt/homebrew/bin/ffprobe',['-v','error','-show_entries','stream=codec_type,width,height','-of','json',output]);
      expect(JSON.parse(stdout).streams).toContainEqual({codec_type:'audio'});
      const frame=await exec('/opt/homebrew/bin/ffmpeg',['-v','error','-ss','1','-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});
      const pixel=(x:number,y:number)=>Array.from(frame.stdout.subarray((y*320+x)*3,(y*320+x)*3+3));
      expect(pixel(10,10)[0]).toBeGreaterThan(200);
      expect(pixel(220,80)[2]).toBeGreaterThan(180);
      const audio=await exec('/opt/homebrew/bin/ffmpeg',['-v','error','-i',output,'-vn','-ac','1','-ar','8000','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});
      const rms=(from:number,to:number)=>{let sum=0;let count=0;for(let i=Math.floor(from*8000);i<Math.floor(to*8000);i++){sum+=audio.stdout.readFloatLE(i*4)**2;count++;}return Math.sqrt(sum/count);};
      expect(rms(0.02,0.1)).toBeLessThan(rms(0.8,1)*0.5);expect(rms(1.9,1.98)).toBeLessThan(rms(0.8,1)*0.5);
    }finally{await rm(directory,{recursive:true,force:true});}
  },30000);
  it.skipIf(!existsSync('/opt/homebrew/bin/ffmpeg'))('reports missing source files',async()=>{
    await expect(renderClipEditorTimeline({timeline,sources:new Map(),ffmpegPath:'/opt/homebrew/bin/ffmpeg'})).rejects.toThrow('project media not found');
  });
  it('ignores retired text fields from legacy persisted projects', () => {
    const legacy = validateClipEditorTimeline({
      ...timeline,
      texts: [{ id: 'legacy-title', text: '旧标题' }],
      selectedTextId: 'legacy-title',
    });
    expect(legacy).not.toHaveProperty('texts');
    expect(legacy).not.toHaveProperty('selectedTextId');
    expect(legacy.clips).toHaveLength(1);
  });
  it('validates output dimensions and volume and preserves detailed editor settings', () => {
    const result = validateClipEditorTimeline({ ...timeline, width: 720, height: 1280, clips: [{ ...timeline.clips[0], volume: 0.4, fit: 'cover', muted: true }] });
    expect(result).toMatchObject({ width: 720, height: 1280, clips: [{ volume: 0.4, fit: 'cover', muted: true }] });
    expect(() => validateClipEditorTimeline({ ...timeline, width: 721 })).toThrow('dimensions');
    expect(() => validateClipEditorTimeline({ ...timeline, clips: [{ ...timeline.clips[0], volume: 4 }] })).toThrow('volume');
  });

  it('validates and exports speed, looping, and non-destructive picture adjustments', () => {
    const video = {
      ...timeline.clips[0]!, id: 'movie', kind: 'video' as const, path: 'movie.mp4',
      sourceDuration: 3, duration: 5, playbackRate: 1.5, loop: true,
      visual: { adjustments: { brightness: 10, contrast: 120, saturation: 80, blur: 2 } },
    };
    const validated = validateClipEditorTimeline({ ...timeline, clips: [video] });
    expect(validated.clips[0]).toMatchObject({ playbackRate: 1.5, loop: true, visual: video.visual });
    const args = buildClipEditorFfmpegArgs(validated, new Map([['movie.mp4', '/tmp/movie.mp4']]), '/tmp/out.mp4', new Set(['movie.mp4']));
    expect(args).toContain('-stream_loop');
    expect(args.join(' ')).toContain('eq=brightness=0.100:contrast=1.200:saturation=0.800');
    expect(args.join(' ')).toContain('gblur=sigma=2.00');
    expect(args.join(' ')).toContain('setpts=(PTS-STARTPTS)/1.500');
    expect(args.join(' ')).toContain('atempo=1.500');
    expect(() => validateClipEditorTimeline({ ...timeline, clips: [{ ...video, loop: false }] })).toThrow('exceeds source');
    expect(() => validateClipEditorTimeline({ ...timeline, clips: [{ ...video, playbackRate: 4 }] })).toThrow('playbackRate');
  });

  it('mixes video source audio with volume and uses cover framing while honoring mute', () => {
    const video = { ...timeline.clips[0]!, id: 'movie', kind: 'video' as const, path: 'movie.mp4', volume: 0.5, fit: 'cover' as const };
    const args = buildClipEditorFfmpegArgs({ ...timeline, width: 720, height: 1280, clips: [video] }, new Map([['movie.mp4', '/tmp/movie.mp4']]), '/tmp/out.mp4', new Set(['movie.mp4']));
    expect(args.join(' ')).toContain('crop=720:1280');
    expect(args.join(' ')).toContain('volume=0.500');
    expect(args).toContain('[aout]');
    expect(buildClipEditorFfmpegArgs({ ...timeline, clips: [{ ...video, muted: true }] }, new Map([['movie.mp4', '/tmp/movie.mp4']]), '/tmp/out.mp4', new Set(['movie.mp4']))).not.toContain('[aout]');
  });

  it('honors mute and solo track state in the native export graph', () => {
    const clips = [
      { ...timeline.clips[0]!, id: 'base', path: 'base.ppm', track: 0 },
      { ...timeline.clips[0]!, id: 'overlay', path: 'overlay.ppm', track: 1 },
    ];
    const sources = new Map([['base.ppm', '/tmp/base.ppm'], ['overlay.ppm', '/tmp/overlay.ppm']]);
    const args = buildClipEditorFfmpegArgs({ ...timeline, clips, trackStates: [{ kind: 'visual', index: 1, muted: true }] }, sources, '/tmp/out.mp4');
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('[1:v]');
    expect(graph).not.toContain('[2:v]');
    const soloArgs = buildClipEditorFfmpegArgs({ ...timeline, clips, trackStates: [{ kind: 'visual', index: 1, solo: true }] }, sources, '/tmp/out.mp4');
    const soloGraph = soloArgs[soloArgs.indexOf('-filter_complex') + 1]!;
    expect(soloGraph).not.toContain('[1:v]');
    expect(soloGraph).toContain('[2:v]');
  });

  it.skipIf(!existsSync('/opt/homebrew/bin/ffmpeg'))('exports sped-up looping video with original audio and picture adjustments', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bezier-clip-sound-'));
    const source = path.join(directory, 'source.mp4');
    const output = path.join(directory, 'result.mp4');
    const exec = promisify(execFile);
    try {
      await exec('/opt/homebrew/bin/ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=red:s=160x90:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', '-shortest', source]);
      const bytes = await renderClipEditorTimeline({ timeline: { ...timeline, width: 64, height: 128, clips: [{ ...timeline.clips[0]!, kind: 'video', path: 'source.mp4', volume: 0.5, duration: 2, sourceDuration: 1, playbackRate: 1.5, loop: true, visual: { adjustments: { brightness: 8, saturation: 80 } } }] }, sources: new Map([['source.mp4', source]]), ffmpegPath: '/opt/homebrew/bin/ffmpeg' });
      await writeFile(output, bytes);
      const { stdout } = await exec('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', output]);
      const probed=JSON.parse(stdout);
      expect(probed.streams).toEqual(expect.arrayContaining([{ codec_type: 'video', width: 64, height: 128 }, { codec_type: 'audio' }]));
      expect(Number(probed.format.duration)).toBeCloseTo(2,1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('rejects invalid and unsafe timeline values before invoking ffmpeg', () => {
    expect(() => validateClipEditorTimeline({ version: 1, clips: [{ kind: 'video', path: '', start: 0, sourceIn: 0, duration: 1 }] })).toThrow('project path');
    expect(() => validateClipEditorTimeline({ version: 1, clips: [{ kind: 'audio', path: 'x.mp3', start: 0, sourceIn: 0, duration: 0.1 }] })).toThrow('shorter than');
  });

  it('builds a hardware-friendly 720p H.264 export command without a shell', () => {
    const args = buildClipEditorFfmpegArgs(timeline, new Map([['still.ppm', '/tmp/still.ppm']]), '/tmp/out.mp4');
    expect(args).toContain('libx264');
    expect(args).toContain('veryfast');
    expect(args.join(' ')).toContain('scale=1280:720');
    expect(args.at(-1)).toBe('/tmp/out.mp4');
  });

  it('maps export quality and fps into ffmpeg without changing the timeline contract', () => {
    const args = buildClipEditorFfmpegArgs(timeline, new Map([['still.ppm', '/tmp/still.ppm']]), '/tmp/out.mp4', new Set(), { format: 'mp4', quality: 'high', fps: 60 });
    expect(args).toEqual(expect.arrayContaining(['-r', '60', '-preset', 'medium', '-crf', '17']));
    expect(args.join(' ')).toContain(':r=60:');
  });

  it.skipIf(!existsSync('/opt/homebrew/bin/ffmpeg'))('exports the current composition frame as PNG', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bezier-clip-still-'));
    const source = path.join(directory, 'still.ppm');
    try {
      await writeFile(source, 'P3\n2 2\n255\n255 0 0 255 0 0 255 0 0 255 0 0\n');
      const bytes = await renderClipEditorTimeline({ timeline, sources: new Map([['still.ppm', source]]), ffmpegPath: '/opt/homebrew/bin/ffmpeg', options: { format: 'png', quality: 'high', fps: 30, stillTime: 0.25 } });
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('keeps a black video bed when the timeline contains audio only', () => {
    const audioOnly: ClipEditorTimeline = {
      version: 1,
      playhead: 0,
      clips: [{ id: 'voice', kind: 'audio', name: 'voice.mp3', path: 'voice.mp3', mimeType: 'audio/mpeg', start: 0, sourceIn: 0, duration: 2 }],
    };
    const args = buildClipEditorFfmpegArgs(audioOnly, new Map([['voice.mp3', '/tmp/voice.mp3']]), '/tmp/audio.mp4');
    expect(args.join(' ')).toContain('[0:v]null[vbase]');
    expect(args).toContain('[vbase]');
    expect(args).toContain('[aout]');
  });

  it.skipIf(!existsSync('/opt/homebrew/bin/ffmpeg'))('renders a real playable MP4 through the local ffmpeg', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bezier-clip-test-'));
    const source = path.join(directory, 'still.ppm');
    try {
      await writeFile(source, 'P3\n2 2\n255\n255 0 0  0 255 0\n0 0 255  255 255 255\n');
      const bytes = await renderClipEditorTimeline({
        timeline,
        sources: new Map([['still.ppm', source]]),
        ffmpegPath: '/opt/homebrew/bin/ffmpeg',
      });
      expect(bytes.length).toBeGreaterThan(1_000);
      expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
