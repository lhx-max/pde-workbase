// @vitest-environment jsdom
import React from 'react';
import {act, cleanup, render} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {CanvasResourceThumbnail} from '../src/components/CanvasResourceThumbnail';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('requests a thumbnail only when it approaches the viewport and starts it eagerly',()=>{
 let notify!: IntersectionObserverCallback;
 const disconnect=vi.fn();
 vi.stubGlobal('IntersectionObserver',class{constructor(cb:IntersectionObserverCallback){notify=cb;}observe(){}disconnect=disconnect;});
 const view=render(<CanvasResourceThumbnail src="/thumb.webp"/>);
 const image=view.container.querySelector('img')!;
 expect(image.getAttribute('src')).toBeNull();
 act(()=>notify([{isIntersecting:false}] as IntersectionObserverEntry[],{} as IntersectionObserver));
 expect(image.getAttribute('src')).toBeNull();
 act(()=>notify([{isIntersecting:true}] as IntersectionObserverEntry[],{} as IntersectionObserver));
 expect(image.getAttribute('src')).toBe('/thumb.webp');
 expect(image.getAttribute('loading')).toBe('eager');
 expect(disconnect).toHaveBeenCalled();
});
it('loads normally when intersection observation is unavailable',()=>{
 vi.stubGlobal('IntersectionObserver',undefined);
 const view=render(<CanvasResourceThumbnail src="/thumb.webp"/>);
 expect(view.container.querySelector('img')!.getAttribute('src')).toBe('/thumb.webp');
});
