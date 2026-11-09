'use client';

import React from 'react';
import { Button } from '@bezier/components';
import { useReactFlow, useStore } from '@xyflow/react';
import { requireCanvasMenuRenderer, useCanvasUiHost } from '../platform/ui-host';
import { CanvasSelectionItem } from './CanvasSelectionItem';
import { buildAnnotationRegenerateInstruction } from './annotation-regenerate';
import { CompositionSafeTextarea } from './CompositionSafeField';
import { IMAGE_EDITOR_TOOL_IDS, imageEditorCopy } from '../locales/chrome';
import { useCanvasLocale } from '../platform/canvas-locale';

type Props = {
  src: string;
  name: string;
  saving?: boolean;
  presentation?: 'modal' | 'inline';
  onClose: () => void;
  onCommit: (file: File, meta: { width: number; height: number }) => void | Promise<void>;
  onRegenerate: (file: File, instruction: string) => void | Promise<void>;
};

type Point = { x: number; y: number };
type Bounds = { x: number; y: number; width: number; height: number };
type Tool = 'select' | 'rectangle' | 'ellipse' | 'arrow' | 'line' | 'brush' | 'text' | 'tag' | 'mosaic';
type TextVariant = 'plain' | 'filled' | 'outlined';
type MosaicMode = 'mosaic' | 'blur';
type MosaicShape = 'brush' | 'rectangle';
type ShapeStyle = {
  stroke: string;
  strokeWidth: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  textVariant: TextVariant;
  mosaicMode: MosaicMode;
  mosaicShape: MosaicShape;
  mosaicBlockSize: number;
  mosaicBrushSize: number;
  blurRadius: number;
  tagBackground: string;
  tagTextColor: string;
};
type MosaicBase = { id: string; type: 'mosaic'; mode: MosaicMode; strength: number; brushSize: number; style: ShapeStyle };
type Shape =
  | { id: string; type: 'rectangle'; x: number; y: number; width: number; height: number; style: ShapeStyle }
  | { id: string; type: 'ellipse'; x: number; y: number; width: number; height: number; style: ShapeStyle }
  | { id: string; type: 'line'; x1: number; y1: number; x2: number; y2: number; style: ShapeStyle }
  | { id: string; type: 'arrow'; x1: number; y1: number; x2: number; y2: number; style: ShapeStyle }
  | { id: string; type: 'brush'; points: Point[]; style: ShapeStyle }
  | { id: string; type: 'text'; x: number; y: number; width: number; height: number; text: string; style: ShapeStyle }
  | { id: string; type: 'tag'; x: number; y: number; width: number; height: number; anchorX: number; anchorY: number; text: string; side: 'left' | 'right' | 'top' | 'bottom'; style: ShapeStyle }
  | (MosaicBase & { shape: 'rectangle'; x: number; y: number; width: number; height: number })
  | (MosaicBase & { shape: 'brush'; points: Point[] });

type EditState = { id: string; before: Shape[]; originalText: string; isNew: boolean };
type Interaction =
  | { kind: 'draw'; id: string; start: Point; before: Shape[] }
  | { kind: 'move'; id: string; start: Point; before: Shape[] }
  | { kind: 'resize'; id: string; corner: 0 | 1 | 2 | 3; before: Shape[]; original: Bounds }
  | null;

const FONT_FAMILY = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const TAG_ANCHOR_OFFSET = 7.5;
const DEFAULT_STYLE: ShapeStyle = {
  stroke: '#FF3B30', strokeWidth: 2, fontSize: 12, fontFamily: FONT_FAMILY, fontWeight: 500,
  textVariant: 'plain', mosaicMode: 'mosaic', mosaicShape: 'rectangle', mosaicBlockSize: 4.5,
  mosaicBrushSize: 6, blurRadius: 4.5, tagBackground: 'rgba(0, 0, 0, 0.6)', tagTextColor: '#FFFFFF',
};
const COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#AF52DE', '#1C1C1E', '#FFFFFF'];
const STROKES = [{ value: 2, dot: 4 }, { value: 4, dot: 7 }, { value: 8, dot: 11 }];
const MOSAIC_BRUSHES = [{ value: 6, dot: 4 }, { value: 12, dot: 7 }, { value: 18, dot: 11 }];
const FONT_SIZES = [12, 16, 24, 36, 48, 60, 72, 96];

const clone = (shapes: Shape[]): Shape[] => structuredClone(shapes) as Shape[];
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const normalized = (x: number, y: number, width: number, height: number): Bounds => ({
  x: width < 0 ? x + width : x, y: height < 0 ? y + height : y, width: Math.abs(width), height: Math.abs(height),
});
const pointDistance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  if (!dx && !dy) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
const pointsBounds = (points: Point[], pad = 0): Bounds => {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map(point => point.x); const ys = points.map(point => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
};

function shapeBounds(shape: Shape): Bounds {
  if (shape.type === 'rectangle' || shape.type === 'ellipse') return normalized(shape.x, shape.y, shape.width, shape.height);
  if (shape.type === 'line' || shape.type === 'arrow') return pointsBounds([{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }]);
  if (shape.type === 'brush') return pointsBounds(shape.points);
  if (shape.type === 'mosaic') return shape.shape === 'rectangle'
    ? normalized(shape.x, shape.y, shape.width, shape.height)
    : pointsBounds(shape.points, shape.brushSize / 2);
  if (shape.type === 'tag') {
    const minX = Math.min(shape.x, shape.anchorX); const minY = Math.min(shape.y, shape.anchorY);
    const maxX = Math.max(shape.x + shape.width, shape.anchorX); const maxY = Math.max(shape.y + shape.height, shape.anchorY);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  const px = shape.style.textVariant === 'filled' ? Math.max(4, shape.style.fontSize * .45) : 0;
  const py = shape.style.textVariant === 'filled' ? Math.max(2, shape.style.fontSize * .18) : 0;
  return { x: shape.x - px, y: shape.y - py, width: Math.max(shape.width + px * 2, shape.style.fontSize), height: Math.max(shape.height + py * 2, shape.style.fontSize) };
}

function hitShape(shape: Shape, point: Point) {
  const bounds = shapeBounds(shape); const pad = Math.max(7, shape.style.strokeWidth);
  if (shape.type === 'line' || shape.type === 'arrow') return pointDistance(point, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) <= pad;
  if (shape.type === 'brush') return shape.points.some((value, index) => index > 0 && pointDistance(point, shape.points[index - 1]!, value) <= pad);
  if (shape.type === 'mosaic' && shape.shape === 'brush') return shape.points.some((value, index) => index === 0
    ? Math.hypot(point.x - value.x, point.y - value.y) <= shape.brushSize / 2
    : pointDistance(point, shape.points[index - 1]!, value) <= shape.brushSize / 2);
  if (shape.type === 'ellipse') {
    const rx = bounds.width / 2; const ry = bounds.height / 2;
    if (!rx || !ry) return false;
    const q = ((point.x - bounds.x - rx) / rx) ** 2 + ((point.y - bounds.y - ry) / ry) ** 2;
    return Math.abs(q - 1) <= Math.max(.1, pad / Math.min(rx, ry));
  }
  const inBounds = (padding: number) => point.x >= bounds.x - padding && point.x <= bounds.x + bounds.width + padding
    && point.y >= bounds.y - padding && point.y <= bounds.y + bounds.height + padding;
  if (shape.type === 'rectangle') return inBounds(pad) && !inBounds(-pad);
  if (shape.type === 'tag') {
    const inCard = point.x >= shape.x - 4 && point.x <= shape.x + shape.width + 4 && point.y >= shape.y - 4 && point.y <= shape.y + shape.height + 4;
    return inCard || Math.hypot(point.x - shape.anchorX, point.y - shape.anchorY) <= 6.5;
  }
  return inBounds(shape.type === 'mosaic' ? 0 : 4);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath(); context.moveTo(x + r, y); context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r); context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r); context.closePath();
}

function drawText(context: CanvasRenderingContext2D, shape: Extract<Shape, { type: 'text' }>) {
  if (!shape.text) return;
  const style = shape.style; const lineHeight = style.fontSize * 1.4; const lines = (shape.text || ' ').split('\n');
  context.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
  const width = Math.max(...lines.map(line => context.measureText(line || ' ').width), style.fontSize);
  shape.width = width; shape.height = Math.max(lineHeight, lines.length * lineHeight);
  if (style.textVariant === 'filled') {
    const px = Math.max(4, style.fontSize * .45); const py = Math.max(2, style.fontSize * .18);
    context.fillStyle = style.stroke; context.fillRect(shape.x - px, shape.y - py, width + px * 2, shape.height + py * 2);
    context.fillStyle = ['#FFFFFF', '#FFCC00'].includes(style.stroke) ? '#1c1c1e' : '#fff';
  } else context.fillStyle = style.stroke;
  context.textBaseline = 'top'; context.textAlign = 'left';
  lines.forEach((line, index) => {
    const y = shape.y + index * lineHeight;
    if (style.textVariant === 'outlined') { context.lineWidth = .5; context.strokeStyle = style.stroke; context.strokeText(line, shape.x, y); }
    else context.fillText(line, shape.x, y);
  });
}

function drawTag(context: CanvasRenderingContext2D, shape: Extract<Shape, { type: 'tag' }>) {
  const size = shape.style.fontSize || 13; const lines = (shape.text || ' ').split('\n'); const lineHeight = size * 1.4;
  context.font = `${shape.style.fontWeight} ${size}px ${shape.style.fontFamily}`;
  shape.width = Math.max(size, ...lines.map(line => context.measureText(line || ' ').width)) + 12;
  shape.height = Math.max(lineHeight, lines.length * lineHeight) + 4;
  const cardCx = shape.x + shape.width / 2; const cardCy = shape.y + shape.height / 2;
  const cardSide = shape.side; const pointerSide = oppositeSide(cardSide); const base = 4; const pointer = 4;
  if (pointerSide === 'left') { shape.anchorX = shape.x - TAG_ANCHOR_OFFSET; shape.anchorY = cardCy; }
  else if (pointerSide === 'right') { shape.anchorX = shape.x + shape.width + TAG_ANCHOR_OFFSET; shape.anchorY = cardCy; }
  else if (pointerSide === 'top') { shape.anchorX = cardCx; shape.anchorY = shape.y - TAG_ANCHOR_OFFSET; }
  else { shape.anchorX = cardCx; shape.anchorY = shape.y + shape.height + TAG_ANCHOR_OFFSET; }
  roundedRect(context, shape.x, shape.y, shape.width, shape.height, 6);
  if (pointerSide === 'left') { context.moveTo(shape.x, cardCy - base); context.lineTo(shape.x - pointer, cardCy); context.lineTo(shape.x, cardCy + base); }
  else if (pointerSide === 'right') { context.moveTo(shape.x + shape.width, cardCy - base); context.lineTo(shape.x + shape.width + pointer, cardCy); context.lineTo(shape.x + shape.width, cardCy + base); }
  else if (pointerSide === 'top') { context.moveTo(cardCx - base, shape.y); context.lineTo(cardCx, shape.y - pointer); context.lineTo(cardCx + base, shape.y); }
  else { context.moveTo(cardCx - base, shape.y + shape.height); context.lineTo(cardCx, shape.y + shape.height + pointer); context.lineTo(cardCx + base, shape.y + shape.height); }
  context.closePath(); context.fillStyle = shape.style.tagBackground; context.fill();
  context.beginPath(); context.arc(shape.anchorX, shape.anchorY, 2.5, 0, Math.PI * 2);
  context.fillStyle = shape.style.stroke; context.fill();
  context.fillStyle = shape.style.tagTextColor; context.textAlign = 'center'; context.textBaseline = 'middle';
  lines.forEach((line, index) => context.fillText(line, cardCx, shape.y + 2 + lineHeight * (index + .5)));
}

function oppositeSide(side: 'left' | 'right' | 'top' | 'bottom') {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  if (side === 'top') return 'bottom';
  return 'top';
}

function placeTagCard(anchor: Point, side: 'left' | 'right' | 'top' | 'bottom', width: number, height: number) {
  if (side === 'left') return { x: anchor.x - TAG_ANCHOR_OFFSET - width, y: anchor.y - height / 2 };
  if (side === 'right') return { x: anchor.x + TAG_ANCHOR_OFFSET, y: anchor.y - height / 2 };
  if (side === 'top') return { x: anchor.x - width / 2, y: anchor.y - TAG_ANCHOR_OFFSET - height };
  return { x: anchor.x - width / 2, y: anchor.y + TAG_ANCHOR_OFFSET };
}

function makeProcessed(source: HTMLCanvasElement, mode: MosaicMode, strength: number) {
  const output = document.createElement('canvas'); output.width = source.width; output.height = source.height;
  const context = output.getContext('2d')!;
  if (mode === 'blur') {
    const radius = Math.max(1, Math.round(strength)); const pad = radius * 2;
    const padded = document.createElement('canvas'); padded.width = source.width + pad * 2; padded.height = source.height + pad * 2;
    const pc = padded.getContext('2d')!; pc.drawImage(source, pad, pad);
    pc.drawImage(source, 0, 0, source.width, 1, pad, 0, source.width, pad);
    pc.drawImage(source, 0, source.height - 1, source.width, 1, pad, source.height + pad, source.width, pad);
    pc.drawImage(source, 0, 0, 1, source.height, 0, pad, pad, source.height);
    pc.drawImage(source, source.width - 1, 0, 1, source.height, source.width + pad, pad, pad, source.height);
    context.filter = `blur(${radius}px)`; context.drawImage(padded, -pad, -pad); context.filter = 'none';
  } else {
    const block = Math.max(2, Math.round(strength)); const small = document.createElement('canvas');
    small.width = Math.max(1, Math.ceil(source.width / block)); small.height = Math.max(1, Math.ceil(source.height / block));
    const smallContext = small.getContext('2d')!; smallContext.drawImage(source, 0, 0, small.width, small.height);
    context.imageSmoothingEnabled = false; context.drawImage(small, 0, 0, small.width, small.height, 0, 0, output.width, output.height);
  }
  return output;
}

function drawShape(context: CanvasRenderingContext2D, shape: Shape, processed: (mode: MosaicMode, strength: number) => HTMLCanvasElement, logical: { width: number; height: number }) {
  context.save(); context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = shape.style.stroke;
  context.fillStyle = shape.style.stroke; context.lineWidth = shape.style.strokeWidth;
  if (shape.type === 'rectangle') context.strokeRect(shape.x, shape.y, shape.width, shape.height);
  else if (shape.type === 'ellipse') {
    const b = normalized(shape.x, shape.y, shape.width, shape.height); context.beginPath();
    context.ellipse(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, b.height / 2, 0, 0, Math.PI * 2); context.stroke();
  } else if (shape.type === 'line' || shape.type === 'arrow') {
    const dx = shape.x2 - shape.x1; const dy = shape.y2 - shape.y1; const length = Math.hypot(dx, dy);
    if (length) {
      const ux = dx / length; const uy = dy / length; const head = Math.max(12, shape.style.strokeWidth * 4);
      context.beginPath(); context.moveTo(shape.x1, shape.y1); context.lineTo(shape.type === 'arrow' ? shape.x2 - ux * head * .5 : shape.x2, shape.type === 'arrow' ? shape.y2 - uy * head * .5 : shape.y2); context.stroke();
      if (shape.type === 'arrow') { const px = -uy; const py = ux; const wing = Math.max(8, shape.style.strokeWidth * 3); context.beginPath(); context.moveTo(shape.x2, shape.y2); context.lineTo(shape.x2 - ux * head + px * wing / 2, shape.y2 - uy * head + py * wing / 2); context.lineTo(shape.x2 - ux * head - px * wing / 2, shape.y2 - uy * head - py * wing / 2); context.closePath(); context.fill(); }
    }
  } else if (shape.type === 'brush') {
    context.beginPath();
    if (shape.points.length === 1) { context.arc(shape.points[0]!.x, shape.points[0]!.y, shape.style.strokeWidth / 2, 0, Math.PI * 2); context.fill(); }
    else { context.moveTo(shape.points[0]!.x, shape.points[0]!.y); for (let index = 1; index < shape.points.length - 1; index++) { const point = shape.points[index]!; const next = shape.points[index + 1]!; context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2); } const last = shape.points.at(-1)!; context.lineTo(last.x, last.y); context.stroke(); }
  } else if (shape.type === 'text') drawText(context, shape);
  else if (shape.type === 'tag') drawTag(context, shape);
  else {
    const source = processed(shape.mode, shape.strength);
    if (shape.shape === 'rectangle') {
      context.beginPath(); context.rect(shape.x, shape.y, shape.width, shape.height); context.clip();
      context.drawImage(source, 0, 0, logical.width, logical.height);
    } else {
      const bounds = pointsBounds(shape.points, shape.brushSize / 2); const layer = document.createElement('canvas'); layer.width = Math.max(1, Math.ceil(bounds.width)); layer.height = Math.max(1, Math.ceil(bounds.height));
      const layerContext = layer.getContext('2d')!; layerContext.drawImage(source, -bounds.x, -bounds.y);
      layerContext.globalCompositeOperation = 'destination-in'; layerContext.lineWidth = shape.brushSize;
      layerContext.lineCap = 'round'; layerContext.lineJoin = 'round'; layerContext.strokeStyle = '#000'; layerContext.fillStyle = '#000'; layerContext.beginPath();
      if (shape.points.length === 1) { layerContext.arc(shape.points[0]!.x - bounds.x, shape.points[0]!.y - bounds.y, shape.brushSize / 2, 0, Math.PI * 2); layerContext.fill(); }
      else { layerContext.moveTo(shape.points[0]!.x - bounds.x, shape.points[0]!.y - bounds.y); for (let index = 1; index < shape.points.length - 1; index++) { const point = shape.points[index]!; const next = shape.points[index + 1]!; layerContext.quadraticCurveTo(point.x - bounds.x, point.y - bounds.y, (point.x + next.x) / 2 - bounds.x, (point.y + next.y) / 2 - bounds.y); } const last = shape.points.at(-1)!; layerContext.lineTo(last.x - bounds.x, last.y - bounds.y); layerContext.stroke(); }
      layerContext.globalCompositeOperation = 'source-over'; context.drawImage(layer, bounds.x, bounds.y);
    }
  }
  context.restore();
}

function Icon({ name }: { name: Tool | 'undo' | 'redo' | 'clear' | 'close' | 'save' | 'regenerate' }) {
  const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (name === 'select') return <svg {...p}><path d="m5 3 12 9-6 1.5L8 19z" /></svg>;
  if (name === 'rectangle') return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="1.5" /></svg>;
  if (name === 'ellipse') return <svg {...p}><circle cx="12" cy="12" r="8" /></svg>;
  if (name === 'arrow') return <svg {...p}><path d="M5 19 19 5m-7 0h7v7" /></svg>;
  if (name === 'line') return <svg {...p}><path d="m5 19 14-14" /></svg>;
  if (name === 'brush') return <svg {...p}><path d="m5 19 4-1 9-9-3-3-9 9zM14 7l3 3" /></svg>;
  if (name === 'text') return <svg {...p}><path d="M5 5h14M12 5v14M8 19h8" /></svg>;
  if (name === 'tag') return <svg {...p}><path d="M4 6v9l5 4 11-11-4-4H7z" /><circle cx="8" cy="8" r="1" /></svg>;
  if (name === 'mosaic') return <svg {...p}><path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" /></svg>;
  if (name === 'undo') return <svg {...p}><path d="m9 7-4 4 4 4M5 11h8a6 6 0 0 1 6 6" /></svg>;
  if (name === 'redo') return <svg {...p}><path d="m15 7 4 4-4 4M19 11h-8a6 6 0 0 0-6 6" /></svg>;
  if (name === 'clear') return <svg {...p}><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" /></svg>;
  if (name === 'close') return <svg {...p}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === 'regenerate') return <svg {...p}><path d="M12 3.5 13.2 7l3.3 1.2-3.3 1.2L12 13l-1.2-3.6-3.3-1.2L10.8 7 12 3.5ZM18 13l.7 2.1 2 .7-2 .7L18 19l-.7-2.5-2-.7 2-.7L18 13ZM6 14l.6 1.7 1.7.6-1.7.6L6 19l-.6-2.1-1.7-.6 1.7-.6L6 14Z" /></svg>;
  return <svg {...p}><path d="M12 19V5m0 0-5 5m5-5 5 5" /></svg>;
}

function CheckIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.2 2.8 2.8 6.2-6.2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function ChevronIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6 3.5 3.5L11.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function DropletIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s5 5.3 5 9.3a5 5 0 0 1-10 0C7 8.3 12 3 12 3Z" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>; }
function HandIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.8 11.5V7.2a1.3 1.3 0 0 1 2.6 0v3.1-5a1.3 1.3 0 0 1 2.6 0v5-3.7a1.3 1.3 0 0 1 2.6 0v4-2a1.3 1.3 0 0 1 2.6 0v5.1c0 4.4-2.7 7.3-6.7 7.3-3.2 0-5-1.8-6.2-4l-1.7-3a1.4 1.4 0 0 1 2.2-1.7l2 1.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function DashedRectIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 2" /></svg>; }
function TextVariantIcon({ variant }: { variant: TextVariant }) {
  if (variant === 'filled') return <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M4.5 4.6h7v1.6h-.85v-.7H8.65V11h.95v.9H6.4V11h.95V5.5h-2v.7H4.5z" fill="currentColor" /></svg>;
  if (variant === 'outlined') return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10v2.2h-1V4.1H8.7V12h1.2v1.1H6.1V12h1.2V4.1H4v1.1H3z" fill="none" stroke="currentColor" strokeWidth=".7" /></svg>;
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10v2.2h-1V4.1H8.7V12h1.2v1.1H6.1V12h1.2V4.1H4v1.1H3z" fill="currentColor" /></svg>;
}

export default function ImageEditorView({ src, name, saving, onClose, onCommit, onRegenerate }: Props) {
  const copy = imageEditorCopy(useCanvasLocale());
  const { getNode, getViewport, setViewport } = useReactFlow();
  const uiHost = useCanvasUiHost();
  const renderMenu = requireCanvasMenuRenderer(uiHost);
  const flowWidth = useStore(state => state.width);
  const flowHeight = useStore(state => state.height);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null); const imageRef = React.useRef<HTMLImageElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const sourceRef = React.useRef<HTMLCanvasElement | null>(null); const shapesRef = React.useRef<Shape[]>([]);
  const cacheRef = React.useRef(new Map<string, HTMLCanvasElement>()); const interactionRef = React.useRef<Interaction>(null);
  const actionPendingRef = React.useRef(false);
  const pastRef = React.useRef<Shape[][]>([]); const futureRef = React.useRef<Shape[][]>([]);
  const [natural, setNatural] = React.useState({ width: 0, height: 0 }); const [editorWidth, setEditorWidth] = React.useState(360); const [revision, setRevision] = React.useState(0);
  const [tool, setTool] = React.useState<Tool>('rectangle'); const [style, setStyleState] = React.useState(DEFAULT_STYLE);
  const [selectedId, setSelectedId] = React.useState<string | null>(null); const [editing, setEditing] = React.useState<EditState | null>(null);
  const [, setHistoryVersion] = React.useState(0); const [error, setError] = React.useState('');
  const [fontSizeOpen, setFontSizeOpen] = React.useState(false); const [brushSizeOpen, setBrushSizeOpen] = React.useState(false);
  const [canvasCursor, setCanvasCursor] = React.useState('crosshair');
  const logical = React.useMemo(() => natural.width ? { width: editorWidth, height: editorWidth * natural.height / natural.width } : { width: 0, height: 0 }, [editorWidth, natural]);
  const pixelScale = natural.width && logical.width ? natural.width / logical.width : 1;

  const invalidate = React.useCallback(() => setRevision(value => value + 1), []);
  const refreshHistory = React.useCallback(() => setHistoryVersion(value => value + 1), []);
  const commit = React.useCallback((before: Shape[]) => {
    if (JSON.stringify(before) === JSON.stringify(shapesRef.current)) return;
    pastRef.current = [...pastRef.current.slice(-49), clone(before)]; futureRef.current = []; refreshHistory();
  }, [refreshHistory]);

  const entryFocusAppliedRef = React.useRef(false);
  React.useLayoutEffect(() => {
    // Entering annotation may focus the image once. Later sidebar/layout
    // changes must not recenter an editor the user is already working in.
    if (entryFocusAppliedRef.current) return;
    const root = rootRef.current; if (!root || !flowWidth || !flowHeight) return;
    const nodeElement = root.closest<HTMLElement>('.react-flow__node'); const nodeId = nodeElement?.dataset.id;
    const node = nodeId ? getNode(nodeId) : undefined; if (!node) return;
    const nodeWidth = node.measured?.width || node.width || nodeElement?.offsetWidth || 1;
    const nodeHeight = node.measured?.height || node.height || nodeElement?.offsetHeight || 1;
    const safeHorizontal = 72; const safeTop = 80 + 100; const safeBottom = 88;
    const availableWidth = Math.max(1, flowWidth - safeHorizontal * 2);
    const availableHeight = Math.max(1, flowHeight - safeTop - safeBottom);
    const zoom = Math.max(.1, Math.min(2, availableWidth / nodeWidth, availableHeight / nodeHeight));
    const centerX = safeHorizontal + availableWidth / 2; const centerY = safeTop + availableHeight / 2;
    const current = getViewport(); const x = centerX - (node.position.x + nodeWidth / 2) * zoom; const y = centerY - (node.position.y + nodeHeight / 2) * zoom;
    const distance = Math.hypot(x - current.x, y - current.y); const duration = Math.max(200, Math.min(1200, 200 + distance * .35 + Math.abs(zoom - current.zoom) * 500));
    entryFocusAppliedRef.current = true;
    void setViewport({ x, y, zoom }, { duration });
  }, [flowHeight, flowWidth, getNode, getViewport, setViewport]);

  React.useLayoutEffect(() => {
    const root = rootRef.current; if (!root) return;
    const sync = () => { const width = Math.round(root.clientWidth); if (width > 0) setEditorWidth(width); };
    sync(); const observer = new ResizeObserver(sync); observer.observe(root); return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    let cancelled = false; const image = new Image(); image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) return; imageRef.current = image; setNatural({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => { if (!cancelled) setError(copy.loadFailed); }; image.src = src;
    return () => { cancelled = true; };
  }, [copy.loadFailed, src]);

  React.useEffect(() => {
    const image = imageRef.current; if (!image || !logical.width || !logical.height) return;
    const source = document.createElement('canvas'); source.width = Math.round(logical.width); source.height = Math.round(logical.height);
    source.getContext('2d')?.drawImage(image, 0, 0, source.width, source.height); sourceRef.current = source; cacheRef.current.clear(); invalidate();
  }, [invalidate, logical.height, logical.width]);

  const processed = React.useCallback((mode: MosaicMode, strength: number) => {
    const source = sourceRef.current!; const key = `${mode}:${strength}`; const cached = cacheRef.current.get(key); if (cached) return cached;
    const output = makeProcessed(source, mode, strength); cacheRef.current.set(key, output);
    if (cacheRef.current.size > 8) cacheRef.current.delete(cacheRef.current.keys().next().value as string); return output;
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current; const image = imageRef.current; if (!canvas || !image || !logical.width) return;
    canvas.width = natural.width; canvas.height = natural.height; const context = canvas.getContext('2d'); if (!context) return;
    context.setTransform(pixelScale, 0, 0, pixelScale, 0, 0); context.clearRect(0, 0, logical.width, logical.height);
    context.drawImage(image, 0, 0, logical.width, logical.height);
    shapesRef.current.forEach(shape => drawShape(context, shape, processed, logical));
    const selected = selectedId ? shapesRef.current.find(shape => shape.id === selectedId) : null;
    if (selected && editing?.id !== selected.id) {
      const b = shapeBounds(selected); const cssScale = canvas.getBoundingClientRect().width / logical.width || 1; const inv = 1 / cssScale;
      context.save(); context.strokeStyle = '#3370FF'; context.lineWidth = inv; context.setLineDash([4 * inv, 4 * inv]);
      context.strokeRect(b.x - 2 * inv, b.y - 2 * inv, b.width + 4 * inv, b.height + 4 * inv); context.setLineDash([]);
      [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]].forEach(([x, y]) => {
        const size = 8 * inv; context.fillStyle = '#fff'; context.strokeStyle = '#3370FF'; context.lineWidth = 1.5 * inv;
        context.fillRect(x! - size / 2, y! - size / 2, size, size); context.strokeRect(x! - size / 2, y! - size / 2, size, size);
      }); context.restore();
    }
  }, [editing?.id, logical, natural, pixelScale, processed, revision, selectedId]);

  const selectShape = React.useCallback((shape: Shape | null) => {
    setSelectedId(shape?.id || null); if (shape) setStyleState({ ...shape.style }); invalidate();
  }, [invalidate]);
  const undo = React.useCallback(() => {
    const previous = pastRef.current.pop(); if (!previous) return; futureRef.current.push(clone(shapesRef.current)); shapesRef.current = clone(previous);
    setEditing(null); setSelectedId(null); invalidate(); refreshHistory();
  }, [invalidate, refreshHistory]);
  const redo = React.useCallback(() => {
    const next = futureRef.current.pop(); if (!next) return; pastRef.current.push(clone(shapesRef.current)); shapesRef.current = clone(next);
    setEditing(null); setSelectedId(null); invalidate(); refreshHistory();
  }, [invalidate, refreshHistory]);
  const clear = React.useCallback(() => {
    if (!shapesRef.current.length) return; const before = clone(shapesRef.current); shapesRef.current = []; setSelectedId(null); commit(before); invalidate();
  }, [commit, invalidate]);
  const deleteSelected = React.useCallback(() => {
    if (!selectedId) return; const before = clone(shapesRef.current); shapesRef.current = shapesRef.current.filter(shape => shape.id !== selectedId);
    setSelectedId(null); commit(before); invalidate();
  }, [commit, invalidate, selectedId]);

  const beginEdit = React.useCallback((shape: Extract<Shape, { type: 'text' | 'tag' }>, isNew: boolean, before?: Shape[]) => {
    setEditing({ id: shape.id, before: before || clone(shapesRef.current), originalText: shape.text, isNew });
  }, []);
  React.useLayoutEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      const textarea = textareaRef.current; if (!textarea) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [editing?.id]);
  const finishEdit = React.useCallback((cancelled = false) => {
    if (!editing) return; const shape = shapesRef.current.find(item => item.id === editing.id);
    if (cancelled) {
      shapesRef.current = clone(editing.before); setSelectedId(editing.isNew ? null : editing.id);
    } else if (!shape || !('text' in shape) || !shape.text.trim()) {
      shapesRef.current = shapesRef.current.filter(item => item.id !== editing.id); setSelectedId(null); commit(editing.before);
    } else { shape.text = shape.text.trim(); commit(editing.before); }
    setEditing(null); invalidate();
  }, [commit, editing, invalidate]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null; if (target?.tagName === 'TEXTAREA') return;
      const command = event.metaKey || event.ctrlKey; const key = event.key.toLowerCase();
      if (command && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (command && key === 'y') { event.preventDefault(); redo(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) { event.preventDefault(); deleteSelected(); }
      else if (event.key === 'Escape') { if (selectedId) selectShape(null); else onClose(); }
    };
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelected, onClose, redo, selectShape, selectedId, undo]);

  React.useEffect(() => { setFontSizeOpen(false); setBrushSizeOpen(false); setCanvasCursor(tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair'); }, [tool]);

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - rect.left) / rect.width * logical.width, y: (event.clientY - rect.top) / rect.height * logical.height };
  }
  function findShape(point: Point) { return [...shapesRef.current].reverse().find(shape => hitShape(shape, point)) || null; }
  function handleAt(shape: Shape, point: Point): 0 | 1 | 2 | 3 | null {
    const b = shapeBounds(shape); const canvas = canvasRef.current; const cssScale = canvas ? canvas.getBoundingClientRect().width / logical.width : 1; const tolerance = 8 / Math.max(.01, cssScale);
    const corners: Point[] = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }];
    const index = corners.findIndex(value => Math.abs(value.x - point.x) <= tolerance && Math.abs(value.y - point.y) <= tolerance);
    return index < 0 ? null : index as 0 | 1 | 2 | 3;
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || editing) return; event.currentTarget.setPointerCapture(event.pointerId); const point = canvasPoint(event);
    const selected = selectedId ? shapesRef.current.find(shape => shape.id === selectedId) : null; const corner = selected ? handleAt(selected, point) : null;
    if (selected && corner !== null) { interactionRef.current = { kind: 'resize', id: selected.id, corner, before: clone(shapesRef.current), original: shapeBounds(selected) }; return; }
    const hit = selected && hitShape(selected, point) ? selected : findShape(point);
    if (hit) { selectShape(hit); interactionRef.current = { kind: 'move', id: hit.id, start: point, before: clone(shapesRef.current) }; return; }
    selectShape(null); if (tool === 'select') return;
    const before = clone(shapesRef.current); let shape: Shape;
    if (tool === 'text') {
      const padX = style.textVariant === 'filled' ? Math.max(4, style.fontSize * .45) : 0;
      shape = { id: uid('text'), type: 'text', x: Math.max(padX, Math.min(logical.width - style.fontSize - padX, point.x)), y: Math.max(0, Math.min(logical.height - style.fontSize, point.y)), width: 0, height: style.fontSize * 1.4, text: '', style: { ...style } };
      shapesRef.current.push(shape); beginEdit(shape, true, before); invalidate(); return;
    }
    if (tool === 'tag') {
      const position = placeTagCard(point, 'right', 44, 26);
      shape = { id: uid('tag'), type: 'tag', ...position, width: 44, height: 26, anchorX: point.x, anchorY: point.y, text: '', side: 'right', style: { ...style, fontSize: style.fontSize || 13 } };
      shapesRef.current.push(shape); interactionRef.current = { kind: 'draw', id: shape.id, start: point, before }; invalidate(); return;
    }
    if (tool === 'rectangle' || tool === 'ellipse') shape = { id: uid(tool), type: tool, x: point.x, y: point.y, width: 0, height: 0, style: { ...style } };
    else if (tool === 'line' || tool === 'arrow') shape = { id: uid(tool), type: tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, style: { ...style } };
    else if (tool === 'brush') shape = { id: uid('brush'), type: 'brush', points: [point], style: { ...style } };
    else if (style.mosaicShape === 'rectangle') shape = { id: uid('mosaic'), type: 'mosaic', shape: 'rectangle', x: point.x, y: point.y, width: 0, height: 0, mode: style.mosaicMode, strength: style.mosaicMode === 'blur' ? style.blurRadius : style.mosaicBlockSize, brushSize: style.mosaicBrushSize, style: { ...style } };
    else shape = { id: uid('mosaic'), type: 'mosaic', shape: 'brush', points: [point], mode: style.mosaicMode, strength: style.mosaicMode === 'blur' ? style.blurRadius : style.mosaicBlockSize, brushSize: style.mosaicBrushSize, style: { ...style } };
    shapesRef.current.push(shape); interactionRef.current = { kind: 'draw', id: shape.id, start: point, before }; invalidate();
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const interaction = interactionRef.current; const point = canvasPoint(event);
    if (!interaction) {
      const selected = selectedId ? shapesRef.current.find(shape => shape.id === selectedId) : null; const corner = selected ? handleAt(selected, point) : null;
      if (corner !== null) setCanvasCursor(corner === 0 || corner === 2 ? 'nwse-resize' : 'nesw-resize');
      else if (findShape(point)) setCanvasCursor('move');
      else setCanvasCursor(tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair');
      return;
    }
    const shape = shapesRef.current.find(item => item.id === interaction.id); if (!shape) return;
    if (interaction.kind === 'draw') {
      if (shape.type === 'rectangle' || shape.type === 'ellipse') Object.assign(shape, normalized(interaction.start.x, interaction.start.y, point.x - interaction.start.x, point.y - interaction.start.y));
      else if (shape.type === 'line' || shape.type === 'arrow') { shape.x2 = point.x; shape.y2 = point.y; }
      else if (shape.type === 'brush' || (shape.type === 'mosaic' && shape.shape === 'brush')) shape.points.push(point);
      else if (shape.type === 'mosaic') Object.assign(shape, normalized(interaction.start.x, interaction.start.y, point.x - interaction.start.x, point.y - interaction.start.y));
      else if (shape.type === 'tag') {
        const dx = point.x - interaction.start.x; const dy = point.y - interaction.start.y;
        shape.side = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
        const position = placeTagCard(interaction.start, shape.side, shape.width, shape.height);
        shape.x = position.x; shape.y = position.y; shape.anchorX = interaction.start.x; shape.anchorY = interaction.start.y;
      }
    } else {
      const original = interaction.before.find(item => item.id === shape.id); if (!original) return;
      if (interaction.kind === 'move') {
        const dx = point.x - interaction.start.x; const dy = point.y - interaction.start.y; moveShape(shape, original, dx, dy);
      } else resizeShape(shape, original, resizeBounds(interaction.original, interaction.corner, point));
    }
    invalidate();
  }

  function onPointerUp() {
    const interaction = interactionRef.current; interactionRef.current = null; if (!interaction) return;
    const shape = shapesRef.current.find(item => item.id === interaction.id); if (!shape) return;
    if (shape.type === 'tag' && interaction.kind === 'draw') { beginEdit(shape, true, interaction.before); return; }
    const b = shapeBounds(shape); const lineLength = shape.type === 'line' || shape.type === 'arrow' ? Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) : Infinity;
    const tooSmall = shape.type === 'brush' ? shape.points.length < 2
      : shape.type === 'line' || shape.type === 'arrow' ? lineLength < 4
        : shape.type === 'mosaic' && shape.shape === 'brush' ? false
          : shape.type === 'text' ? false : b.width < 4 || b.height < 4;
    if (interaction.kind === 'draw' && tooSmall) {
      shapesRef.current = shapesRef.current.filter(item => item.id !== interaction.id); setSelectedId(null); invalidate(); return;
    }
    commit(interaction.before); invalidate();
  }

  function onDoubleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect(); const point = { x: (event.clientX - rect.left) / rect.width * logical.width, y: (event.clientY - rect.top) / rect.height * logical.height };
    const shape = findShape(point); if (shape?.type === 'text') { setTool('text'); beginEdit(shape, false, clone(shapesRef.current)); }
    else if (shape?.type === 'tag') { setTool('select'); beginEdit(shape, false, clone(shapesRef.current)); }
  }

  function updateStyle(patch: Partial<ShapeStyle>) {
    const selected = selectedId ? shapesRef.current.find(shape => shape.id === selectedId) : null;
    const before = clone(shapesRef.current); const next = { ...(selected?.style || style), ...patch }; setStyleState(next);
    if (selected) {
      selected.style = { ...selected.style, ...patch };
      if (selected.type === 'mosaic') { selected.mode = next.mosaicMode; selected.strength = next.mosaicMode === 'blur' ? next.blurRadius : next.mosaicBlockSize; selected.brushSize = next.mosaicBrushSize; }
      commit(before); invalidate();
    }
  }

  async function exportAnnotatedFile() {
    const image = imageRef.current; if (!image || !logical.width) throw new Error(copy.notReady);
    const canvas = document.createElement('canvas'); canvas.width = natural.width; canvas.height = natural.height; const context = canvas.getContext('2d');
    if (!context) throw new Error(copy.unsupported); context.scale(pixelScale, pixelScale); context.drawImage(image, 0, 0, logical.width, logical.height);
    shapesRef.current.forEach(shape => drawShape(context, shape, processed, logical));
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error(copy.exportFailed);
    const base = name.replace(/\.[^.]+$/, '') || 'image';
    return {
      file: new File([blob], `${base}-annotated.png`, { type: 'image/png' }),
      meta: { width: natural.width, height: natural.height },
    };
  }

  async function save() {
    if (saving || actionPendingRef.current) return; setError(''); actionPendingRef.current = true;
    try {
      const exported = await exportAnnotatedFile();
      await onCommit(exported.file, exported.meta);
    } catch (reason) { setError(reason instanceof Error ? reason.message : copy.saveFailed); }
    finally { actionPendingRef.current = false; }
  }

  async function regenerate() {
    if (saving || actionPendingRef.current || !shapesRef.current.length) return; setError(''); actionPendingRef.current = true;
    try {
      const exported = await exportAnnotatedFile();
      const annotationTexts = shapesRef.current.flatMap(shape => ('text' in shape && shape.text.trim()) ? [shape.text] : []);
      await onRegenerate(exported.file, buildAnnotationRegenerateInstruction(annotationTexts));
    } catch (reason) { setError(reason instanceof Error ? reason.message : copy.regenerateFailed); }
    finally { actionPendingRef.current = false; }
  }

  const selected = selectedId ? shapesRef.current.find(shape => shape.id === selectedId) : null;
  const optionTool = tool;
  const activeStyle = selected?.style || style;
  const editShape = editing ? shapesRef.current.find(shape => shape.id === editing.id) : null;
  const editBounds = editShape?.type === 'text' || editShape?.type === 'tag' ? (() => {
    if (editShape.type === 'tag') {
      const width = Math.max(editShape.style.fontSize * 2, editShape.width - 12);
      const height = Math.max(editShape.style.fontSize * 1.4, editShape.height - 4);
      return { x: editShape.x + (editShape.width - width) / 2, y: editShape.y + (editShape.height - height) / 2, width, height };
    }
    return { x: editShape.x, y: editShape.y, width: Math.max(8, editShape.width + 2), height: Math.max(editShape.style.fontSize * 1.4, editShape.height) };
  })() : null;

  return (
    <div ref={rootRef} className="minimax-annotation-v2 nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      <div className="minimax-annotation-toolbar" role="toolbar" aria-label={copy.toolbar}>
        <div className="minimax-annotation-tools">
          {IMAGE_EDITOR_TOOL_IDS.map(id => <Button key={id} variant="ghost" size="icon" className={tool === id ? 'is-active' : ''} data-tooltip={copy.tools[id].tooltip} data-tool={id} aria-label={copy.tools[id].label} aria-pressed={tool === id} onClick={() => { setTool(id); if (id !== 'select') selectShape(null); }}><Icon name={id} /></Button>)}
        </div>
        <span className="minimax-annotation-divider" />
        <Button variant="ghost" size="icon" onClick={undo} disabled={!pastRef.current.length} aria-label={copy.undo} data-tooltip={copy.undoTip}><Icon name="undo" /></Button>
        <Button variant="ghost" size="icon" onClick={redo} disabled={!futureRef.current.length} aria-label={copy.redo} data-tooltip={copy.redoTip}><Icon name="redo" /></Button>
        <Button variant="ghost" size="icon" onClick={clear} disabled={!shapesRef.current.length} aria-label={copy.clear} data-tooltip={copy.clearTip}><Icon name="clear" /></Button>
        <span className="minimax-annotation-divider" />
        <Button variant="ghost" size="icon" onClick={onClose} disabled={saving} aria-label={copy.cancel} data-tooltip={copy.cancelTip}><Icon name="close" /></Button>
        <Button variant="primary" size="icon" className="minimax-annotation-save" onClick={() => void save()} disabled={saving} aria-label={copy.save} data-tooltip={copy.saveTip}><Icon name="save" /></Button>
        <Button variant="primary" size="icon" className="minimax-annotation-regenerate" onClick={() => void regenerate()} disabled={saving || !shapesRef.current.length} aria-label={copy.regenerate} data-tooltip={copy.regenerateTip}><Icon name="regenerate" /></Button>
        {optionTool !== 'select' && <div className={`minimax-annotation-options is-${optionTool}`}>
          <i className="minimax-annotation-options-arrow" aria-hidden="true" />
          {(optionTool === 'text' || optionTool === 'tag') ? <>
            {optionTool === 'text' && <><div className="minimax-annotation-variant">{(['plain', 'filled', 'outlined'] as TextVariant[]).map(value => <CanvasSelectionItem key={value} selected={activeStyle.textVariant === value} data-tooltip={copy[value]} aria-label={copy[value]} onClick={() => updateStyle({ textVariant: value })}><TextVariantIcon variant={value} /></CanvasSelectionItem>)}</div><span className="minimax-annotation-divider" /></>}
            <div className="minimax-annotation-menu-wrap">{renderMenu({
              open: fontSizeOpen,
              onOpenChange: setFontSizeOpen,
              ariaLabel: copy.fontSize,
              contentClassName: 'minimax-annotation-font-menu',
              side: 'bottom',
              align: 'start',
              selectedValue: String(activeStyle.fontSize),
              onSelectedValueChange: value => updateStyle({ fontSize: Number(value) }),
              trigger: <Button variant="ghost" className={`minimax-annotation-font-button ${fontSizeOpen ? 'is-open' : ''}`} aria-label={copy.fontSizeValue(activeStyle.fontSize)}>{activeStyle.fontSize}pt <ChevronIcon /></Button>,
              items: FONT_SIZES.map(value => ({
                id: `font-${value}`,
                value: String(value),
                content: <span>{value}pt</span>,
              })),
            })}</div>
            <ColorPicker value={activeStyle.stroke} onChange={value => updateStyle({ stroke: value })} />
          </> : optionTool === 'mosaic' ? <>
            <div className="minimax-annotation-mosaic-modes"><CanvasSelectionItem selected={activeStyle.mosaicMode === 'mosaic'} data-tooltip={copy.mosaic} aria-label={copy.mosaic} onClick={() => updateStyle({ mosaicMode: 'mosaic' })}><Icon name="mosaic" /></CanvasSelectionItem><CanvasSelectionItem selected={activeStyle.mosaicMode === 'blur'} data-tooltip={copy.blur} aria-label={copy.blur} onClick={() => updateStyle({ mosaicMode: 'blur' })}><DropletIcon /></CanvasSelectionItem></div>
            <span className="minimax-annotation-divider" />
            <div className="minimax-annotation-mosaic-shapes">
              <CanvasSelectionItem selected={activeStyle.mosaicShape === 'brush'} data-tooltip={copy.brushPaint} aria-label={copy.brushPaint} onClick={() => updateStyle({ mosaicShape: 'brush' })}><HandIcon /></CanvasSelectionItem>
              <div className="minimax-annotation-menu-wrap">{renderMenu({
                open: brushSizeOpen,
                onOpenChange: setBrushSizeOpen,
                ariaLabel: copy.brushSize,
                contentClassName: 'minimax-annotation-brush-menu',
                side: 'bottom',
                align: 'start',
                selectedValue: String(activeStyle.mosaicBrushSize),
                onSelectedValueChange: value => updateStyle({ mosaicBrushSize: Number(value), mosaicShape: 'brush' }),
                trigger: <Button variant="ghost" size="icon" className={`minimax-annotation-brush-toggle ${brushSizeOpen ? 'is-open' : ''}`} aria-label={copy.brushSizeValue(activeStyle.mosaicBrushSize)}><ChevronIcon /></Button>,
                items: MOSAIC_BRUSHES.map(item => ({
                  id: `brush-${item.value}`,
                  value: String(item.value),
                  content: <><i className="minimax-annotation-brush-dot" style={{ width: item.dot, height: item.dot }} /><span>{item.value}px</span></>,
                })),
              })}</div>
              <CanvasSelectionItem selected={activeStyle.mosaicShape === 'rectangle'} data-tooltip={copy.rectangleSelect} aria-label={copy.rectangleSelect} onClick={() => updateStyle({ mosaicShape: 'rectangle' })}><DashedRectIcon /></CanvasSelectionItem>
            </div>
            <span className="minimax-annotation-divider" />
            <label className="minimax-annotation-strength"><span>{activeStyle.mosaicMode === 'blur' ? copy.blurStrength : copy.mosaicStrength}</span><input type="range" min="0" max="100" step="1" value={Math.round((activeStyle.mosaicMode === 'blur' ? activeStyle.blurRadius : activeStyle.mosaicBlockSize) * 10)} style={{ '--annotation-strength': `${Math.round((activeStyle.mosaicMode === 'blur' ? activeStyle.blurRadius : activeStyle.mosaicBlockSize) * 10)}%` } as React.CSSProperties} onChange={event => updateStyle(activeStyle.mosaicMode === 'blur' ? { blurRadius: Number(event.currentTarget.value) / 10 } : { mosaicBlockSize: Number(event.currentTarget.value) / 10 })} /><output>{Math.round((activeStyle.mosaicMode === 'blur' ? activeStyle.blurRadius : activeStyle.mosaicBlockSize) * 10)}%</output></label>
          </> : <><DotPicker values={STROKES} value={activeStyle.strokeWidth} tooltipPrefix={copy.strokeWidth} onChange={value => updateStyle({ strokeWidth: value })} /><span className="minimax-annotation-divider" /><ColorPicker value={activeStyle.stroke} onChange={value => updateStyle({ stroke: value })} /></>}
        </div>}
      </div>
      <canvas ref={canvasRef} className={`minimax-annotation-canvas tool-${tool}`} style={{ cursor: canvasCursor }} aria-label={copy.canvasLabel(name)} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick} />
      {editing && editShape && editBounds && ('text' in editShape) && <CompositionSafeTextarea
        ref={textareaRef} className={`minimax-annotation-textarea is-${editShape.type} is-${editShape.style.textVariant}`} value={editShape.text}
        aria-label={editShape.type === 'tag' ? copy.inputTag : copy.inputText} rows={Math.max(1, editShape.text.split('\n').length)} spellCheck={false}
        style={{ left: `${editBounds.x}px`, top: `${editBounds.y}px`, width: `${editBounds.width}px`, height: `${editBounds.height}px`, maxWidth: `${Math.max(8, logical.width - editBounds.x)}px`, color: 'transparent', WebkitTextFillColor: 'transparent', caretColor: editShape.type === 'tag' ? editShape.style.tagTextColor : editShape.style.textVariant === 'filled' ? (['#FFFFFF', '#FFCC00'].includes(editShape.style.stroke) ? '#1c1c1e' : '#fff') : editShape.style.stroke, fontSize: `${editShape.style.fontSize}px`, fontFamily: editShape.style.fontFamily, fontWeight: editShape.style.fontWeight, lineHeight: '1.4' }}
        onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onValueChange={value => { editShape.text = value; invalidate(); }}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); finishEdit(true); } else if (editShape.type === 'tag' && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finishEdit(false); } }}
        onBlur={() => finishEdit(false)}
      />}
      {error && <div className="minimax-annotation-error" role="alert">{error}</div>}
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const colors = imageEditorCopy(useCanvasLocale()).colors;
  return <div className="minimax-annotation-colors">{COLORS.map(color => <CanvasSelectionItem key={color} selected={value.toLowerCase() === color.toLowerCase()} aria-label={colors[color] || color} data-tooltip={colors[color] || color} style={{ '--annotation-color': color } as React.CSSProperties} onClick={() => onChange(color)}>{value.toLowerCase() === color.toLowerCase() && <CheckIcon />}</CanvasSelectionItem>)}</div>;
}

function DotPicker({ values, value, tooltipPrefix, onChange }: { values: Array<{ value: number; dot: number }>; value: number; tooltipPrefix: string; onChange: (value: number) => void }) {
  return <div className="minimax-annotation-dots">{values.map(item => <CanvasSelectionItem key={item.value} selected={value === item.value} aria-label={`${item.value}px`} data-tooltip={`${tooltipPrefix} ${item.value}px`} onClick={() => onChange(item.value)}><i style={{ width: item.dot, height: item.dot }} /></CanvasSelectionItem>)}</div>;
}

function moveShape(target: Shape, source: Shape, dx: number, dy: number) {
  if ((target.type === 'rectangle' || target.type === 'ellipse') && source.type === target.type) { target.x = source.x + dx; target.y = source.y + dy; }
  else if ((target.type === 'line' || target.type === 'arrow') && source.type === target.type) { target.x1 = source.x1 + dx; target.y1 = source.y1 + dy; target.x2 = source.x2 + dx; target.y2 = source.y2 + dy; }
  else if (target.type === 'brush' && source.type === 'brush') target.points = source.points.map(point => ({ x: point.x + dx, y: point.y + dy }));
  else if (target.type === 'text' && source.type === 'text') { target.x = source.x + dx; target.y = source.y + dy; }
  else if (target.type === 'tag' && source.type === 'tag') { target.x = source.x + dx; target.y = source.y + dy; target.anchorX = source.anchorX + dx; target.anchorY = source.anchorY + dy; }
  else if (target.type === 'mosaic' && source.type === 'mosaic' && target.shape === source.shape) {
    if (target.shape === 'rectangle' && source.shape === 'rectangle') { target.x = source.x + dx; target.y = source.y + dy; }
    else if (target.shape === 'brush' && source.shape === 'brush') target.points = source.points.map(point => ({ x: point.x + dx, y: point.y + dy }));
  }
}

function resizeBounds(bounds: Bounds, corner: 0 | 1 | 2 | 3, point: Point) {
  let x1 = bounds.x; let y1 = bounds.y; let x2 = bounds.x + bounds.width; let y2 = bounds.y + bounds.height;
  if (corner === 0 || corner === 3) x1 = point.x; else x2 = point.x;
  if (corner === 0 || corner === 1) y1 = point.y; else y2 = point.y;
  return normalized(x1, y1, x2 - x1, y2 - y1);
}

function resizeShape(target: Shape, source: Shape, next: Bounds) {
  const current = shapeBounds(source); const sx = current.width ? next.width / current.width : 1; const sy = current.height ? next.height / current.height : 1;
  const map = (point: Point): Point => ({ x: next.x + (point.x - current.x) * sx, y: next.y + (point.y - current.y) * sy });
  if ((target.type === 'rectangle' || target.type === 'ellipse') && source.type === target.type) { target.x = next.x; target.y = next.y; target.width = next.width; target.height = next.height; }
  else if ((target.type === 'line' || target.type === 'arrow') && source.type === target.type) { const p1 = map({ x: source.x1, y: source.y1 }); const p2 = map({ x: source.x2, y: source.y2 }); target.x1 = p1.x; target.y1 = p1.y; target.x2 = p2.x; target.y2 = p2.y; }
  else if (target.type === 'brush' && source.type === 'brush') target.points = source.points.map(map);
  else if (target.type === 'text' && source.type === 'text') { target.x = next.x; target.y = next.y; target.style.fontSize = Math.max(8, source.style.fontSize * sy); }
  else if (target.type === 'tag' && source.type === 'tag') moveShape(target, source, next.x - current.x, next.y - current.y);
  else if (target.type === 'mosaic' && source.type === 'mosaic' && target.shape === source.shape) {
    if (target.shape === 'rectangle' && source.shape === 'rectangle') { target.x = next.x; target.y = next.y; target.width = next.width; target.height = next.height; }
    else if (target.shape === 'brush' && source.shape === 'brush') target.points = source.points.map(map);
  }
}
