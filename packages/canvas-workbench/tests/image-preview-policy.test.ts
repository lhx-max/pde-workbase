import {expect,it} from 'vitest';
import {canvasImageDisplayUrl} from '../src/workbench/CanvasPreviewImage';
it('loads a suitable preview for overview and the untouched original for detailed zoom',()=>{
 const src='/api/projects/canvas-a/files/image.png?workspaceId=w&v=3';
 expect(canvasImageDisplayUrl(src,300)).toBe(src+'&odCanvasPreview=image&odPreviewWidth=512');
 expect(canvasImageDisplayUrl(src,1200)).toBe(src+'&odCanvasPreview=image&odPreviewWidth=2048');
 expect(canvasImageDisplayUrl(src,2400)).toBe(src);
 expect(canvasImageDisplayUrl(src,300,true)).toBe(src);
 expect(canvasImageDisplayUrl('https://cdn.example/image.png',300)).toBe('https://cdn.example/image.png');
});
