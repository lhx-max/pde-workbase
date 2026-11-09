'use client';
import { ia } from '../locales/image-adjust';

import React from 'react';
import { Button, Select } from '@bezier/components';
import { CanvasHostedDialog } from '../platform/ui-host';
import styles from './ImageAdjustOverlay.module.css';

export type ImageAdjustments = {
  vibrance: number;
  saturation: number;
  temperature: number;
  tint: number;
  hue: number;
  brightness: number;
  exposure: number;
  contrast: number;
  blacks: number;
  whites: number;
  highlights: number;
  shadows: number;
  sharpen: number;
  clarity: number;
  smooth: number;
  blur: number;
  grain: number;
  vignette: number;
  glamour: number;
  bloom: number;
  dehaze: number;
};

type Props = {
  src: string;
  name: string;
  busy?: boolean;
  onCancel: () => void;
  onCommit: (file: File, meta: { width: number; height: number }) => void | Promise<void>;
};

type LutCube = {
  name: string;
  size: number;
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
};

type LutChoice = { id: string; label: string; preset?: true; cube?: LutCube };

const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  vibrance: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  brightness: 0,
  exposure: 0,
  contrast: 0,
  blacks: 0,
  whites: 0,
  highlights: 0,
  shadows: 0,
  sharpen: 0,
  clarity: 0,
  smooth: 0,
  blur: 0,
  grain: 0,
  vignette: 0,
  glamour: 0,
  bloom: 0,
  dehaze: 0,
};

const PRESET_LUTS: LutChoice[] = [
  { id: 'portrait-warm', label: ia().portraitWarm, preset: true },
  { id: 'portrait-soft', label: ia().portraitSoft, preset: true },
  { id: 'landscape-vivid', label: ia().landscapeVivid, preset: true },
  { id: 'natural-slide', label: ia().naturalFilm, preset: true },
  { id: 'travel-bright', label: ia().travelBright, preset: true },
  { id: 'classic-bw', label: ia().classicBw, preset: true },
  { id: 'modern-bw', label: ia().modernBw, preset: true },
  { id: 'magazine-look', label: ia().magazine, preset: true },
  { id: 'smooth-bw', label: ia().softBw, preset: true },
  { id: 'vintage-instant', label: ia().vintagePolaroid, preset: true },
];

const CONTROL_GROUPS: Array<{
  title: string;
  controls: Array<{ key: keyof ImageAdjustments; label: string; min: number; max: number }>;
}> = [
  {
    title: ia().color,
    controls: [
      { key: 'vibrance', label: ia().vibrance, min: -100, max: 100 },
      { key: 'saturation', label: ia().saturation, min: -100, max: 100 },
      { key: 'temperature', label: ia().temperature, min: -100, max: 100 },
      { key: 'tint', label: ia().tint, min: -100, max: 100 },
      { key: 'hue', label: ia().hue, min: -100, max: 100 },
    ],
  },
  {
    title: ia().light,
    controls: [
      { key: 'brightness', label: ia().brightness, min: -100, max: 100 },
      { key: 'exposure', label: ia().exposure, min: -100, max: 100 },
      { key: 'contrast', label: ia().contrast, min: -100, max: 100 },
      { key: 'blacks', label: ia().blacks, min: -100, max: 100 },
      { key: 'whites', label: ia().whites, min: -100, max: 100 },
      { key: 'highlights', label: ia().highlights, min: -100, max: 100 },
      { key: 'shadows', label: ia().shadows, min: -100, max: 100 },
    ],
  },
  {
    title: ia().detail,
    controls: [
      { key: 'sharpen', label: ia().sharpen, min: 0, max: 100 },
      { key: 'clarity', label: ia().clarity, min: -100, max: 100 },
      { key: 'smooth', label: ia().smooth, min: 0, max: 100 },
      { key: 'blur', label: ia().blur, min: 0, max: 100 },
      { key: 'grain', label: ia().grain, min: 0, max: 100 },
    ],
  },
  {
    title: ia().scene,
    controls: [
      { key: 'vignette', label: ia().vignette, min: -100, max: 100 },
      { key: 'glamour', label: ia().ambiance, min: 0, max: 100 },
      { key: 'bloom', label: ia().bloom, min: 0, max: 100 },
      { key: 'dehaze', label: ia().dehaze, min: 0, max: 100 },
    ],
  },
];

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(ia().readFailed));
    image.src = src;
  });
}

function parseCube(text: string, name: string): LutCube {
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('TITLE')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'LUT_3D_SIZE') {
      size = Number(parts[1]);
      continue;
    }
    if (parts[0] === 'DOMAIN_MIN') {
      domainMin = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
      continue;
    }
    if (parts[0] === 'DOMAIN_MAX') {
      domainMax = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
      continue;
    }
    if (parts.length >= 3 && parts.slice(0, 3).every(value => Number.isFinite(Number(value)))) {
      values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
  }
  if (!Number.isInteger(size) || size < 2 || size > 65 || values.length !== size ** 3 * 3) {
    throw new Error(ia().lutInvalid);
  }
  return { name, size, data: new Float32Array(values), domainMin, domainMax };
}

function sampleCube(cube: LutCube, red: number, green: number, blue: number): [number, number, number] {
  const scale = cube.size - 1;
  const normalize = (value: number, axis: number) => clamp(
    (value - cube.domainMin[axis]!) / Math.max(0.0001, cube.domainMax[axis]! - cube.domainMin[axis]!),
  ) * scale;
  const r = normalize(red, 0);
  const g = normalize(green, 1);
  const b = normalize(blue, 2);
  const r0 = Math.floor(r); const r1 = Math.min(scale, r0 + 1); const rf = r - r0;
  const g0 = Math.floor(g); const g1 = Math.min(scale, g0 + 1); const gf = g - g0;
  const b0 = Math.floor(b); const b1 = Math.min(scale, b0 + 1); const bf = b - b0;
  const at = (ri: number, gi: number, bi: number, channel: number) => {
    const index = ((bi * cube.size * cube.size + gi * cube.size + ri) * 3) + channel;
    return cube.data[index] ?? 0;
  };
  const channel = (c: number) => {
    const c00 = at(r0, g0, b0, c) * (1 - rf) + at(r1, g0, b0, c) * rf;
    const c10 = at(r0, g1, b0, c) * (1 - rf) + at(r1, g1, b0, c) * rf;
    const c01 = at(r0, g0, b1, c) * (1 - rf) + at(r1, g0, b1, c) * rf;
    const c11 = at(r0, g1, b1, c) * (1 - rf) + at(r1, g1, b1, c) * rf;
    return (c00 * (1 - gf) + c10 * gf) * (1 - bf) + (c01 * (1 - gf) + c11 * gf) * bf;
  };
  return [clamp(channel(0)), clamp(channel(1)), clamp(channel(2))];
}

function presetPixel(id: string, r: number, g: number, b: number): [number, number, number] {
  const luma = r * 0.299 + g * 0.587 + b * 0.114;
  if (id === 'portrait-warm') return [clamp(r * 1.06 + 0.025), clamp(g * 1.01 + 0.01), clamp(b * 0.92)];
  if (id === 'portrait-soft') return [clamp(0.08 + r * 0.92), clamp(0.07 + g * 0.93), clamp(0.065 + b * 0.92)];
  if (id === 'landscape-vivid') return [clamp(luma + (r - luma) * 1.28), clamp(luma + (g - luma) * 1.28), clamp(luma + (b - luma) * 1.28)];
  if (id === 'natural-slide') return [clamp(0.035 + r * 0.96), clamp(0.025 + g * 0.98), clamp(0.015 + b * 0.91)];
  if (id === 'travel-bright') return [clamp(r * 1.05 + 0.045), clamp(g * 1.04 + 0.04), clamp(b * 1.02 + 0.03)];
  if (id === 'classic-bw') return [luma, luma, luma];
  if (id === 'modern-bw') {
    const value = clamp((luma - 0.5) * 1.24 + 0.5);
    return [value, value, value];
  }
  if (id === 'magazine-look') return [clamp((r - 0.5) * 1.18 + 0.52), clamp((g - 0.5) * 1.12 + 0.5), clamp((b - 0.5) * 1.08 + 0.49)];
  if (id === 'smooth-bw') {
    const value = clamp(luma * 0.88 + 0.08);
    return [value, value, value];
  }
  if (id === 'vintage-instant') return [clamp(r * 1.02 + 0.07), clamp(g * 0.93 + 0.045), clamp(b * 0.82 + 0.035)];
  return [r, g, b];
}

function hueRotate(r: number, g: number, b: number, degrees: number): [number, number, number] {
  if (!degrees) return [r, g, b];
  const angle = degrees * Math.PI / 180;
  const cos = Math.cos(angle); const sin = Math.sin(angle);
  return [
    clamp((0.213 + cos * 0.787 - sin * 0.213) * r + (0.715 - cos * 0.715 - sin * 0.715) * g + (0.072 - cos * 0.072 + sin * 0.928) * b),
    clamp((0.213 - cos * 0.213 + sin * 0.143) * r + (0.715 + cos * 0.285 + sin * 0.14) * g + (0.072 - cos * 0.072 - sin * 0.283) * b),
    clamp((0.213 - cos * 0.213 - sin * 0.787) * r + (0.715 - cos * 0.715 + sin * 0.715) * g + (0.072 + cos * 0.928 + sin * 0.072) * b),
  ];
}

function sharpenPixels(data: Uint8ClampedArray, width: number, height: number, amount: number) {
  if (amount <= 0 || width < 3 || height < 3) return;
  const source = new Uint8ClampedArray(data);
  const strength = amount / 100 * 0.72;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const center = source[index + channel]!;
        const neighbors = source[index - 4 + channel]! + source[index + 4 + channel]!
          + source[index - width * 4 + channel]! + source[index + width * 4 + channel]!;
        data[index + channel] = clamp(center + (center * 4 - neighbors) * strength, 0, 255);
      }
    }
  }
}

function renderColorAdjusted(
  image: CanvasImageSource,
  width: number,
  height: number,
  settings: ImageAdjustments,
  lut: LutChoice | null,
  lutIntensity: number,
  canvas: HTMLCanvasElement,
) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error(ia().browserUnsupported);
  ctx.clearRect(0, 0, width, height);
  const blurPx = (settings.blur / 100 * 5) + (settings.smooth / 100 * 1.8);
  ctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
  ctx.drawImage(image, 0, 0, width, height);
  ctx.filter = 'none';
  const frame = ctx.getImageData(0, 0, width, height);
  const data = frame.data;
  const exposure = 2 ** (settings.exposure / 100 * 1.75);
  const contrast = 1 + settings.contrast / 100 * 0.95;
  const saturation = 1 + settings.saturation / 100;
  const vibrance = settings.vibrance / 100;
  const clarity = settings.clarity / 100 * 0.58;
  const dehaze = settings.dehaze / 100 * 0.65;
  const lutMix = lutIntensity / 100;
  for (let index = 0; index < data.length; index += 4) {
    let r = data[index]! / 255;
    let g = data[index + 1]! / 255;
    let b = data[index + 2]! / 255;
    r *= exposure; g *= exposure; b *= exposure;
    const brightness = settings.brightness / 100 * 0.34;
    r += brightness; g += brightness; b += brightness;
    r = (r - 0.5) * contrast + 0.5;
    g = (g - 0.5) * contrast + 0.5;
    b = (b - 0.5) * contrast + 0.5;
    let luma = r * 0.299 + g * 0.587 + b * 0.114;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const vibranceFactor = 1 + vibrance * (1 - clamp(max - min));
    const colorFactor = saturation * vibranceFactor;
    r = luma + (r - luma) * colorFactor;
    g = luma + (g - luma) * colorFactor;
    b = luma + (b - luma) * colorFactor;
    const temperature = settings.temperature / 100 * 0.16;
    const tint = settings.tint / 100 * 0.13;
    r += temperature + tint * 0.4;
    g -= tint * 0.62;
    b -= temperature - tint * 0.28;
    [r, g, b] = hueRotate(r, g, b, settings.hue * 1.8);
    luma = clamp(r * 0.299 + g * 0.587 + b * 0.114);
    const shadowMask = (1 - luma) ** 2;
    const highlightMask = luma ** 2;
    const shadowShift = settings.shadows / 100 * 0.32 * shadowMask;
    const highlightShift = settings.highlights / 100 * 0.28 * highlightMask;
    const blackShift = settings.blacks / 100 * 0.22 * (1 - luma);
    const whiteShift = settings.whites / 100 * 0.22 * luma;
    r += shadowShift + highlightShift + blackShift + whiteShift;
    g += shadowShift + highlightShift + blackShift + whiteShift;
    b += shadowShift + highlightShift + blackShift + whiteShift;
    const localContrast = 1 + clarity * (1 - Math.abs(luma - 0.5) * 1.6) + dehaze;
    r = (r - luma) * localContrast + (luma - 0.5) * (1 + dehaze) + 0.5;
    g = (g - luma) * localContrast + (luma - 0.5) * (1 + dehaze) + 0.5;
    b = (b - luma) * localContrast + (luma - 0.5) * (1 + dehaze) + 0.5;
    if (lut) {
      const converted = lut.cube ? sampleCube(lut.cube, r, g, b) : presetPixel(lut.id, r, g, b);
      r += (converted[0] - r) * lutMix;
      g += (converted[1] - g) * lutMix;
      b += (converted[2] - b) * lutMix;
    }
    if (settings.grain > 0) {
      const noise = ((((index * 16807) % 2147483647) / 2147483647) - 0.5) * settings.grain / 100 * 0.16;
      r += noise; g += noise; b += noise;
    }
    data[index] = clamp(r) * 255;
    data[index + 1] = clamp(g) * 255;
    data[index + 2] = clamp(b) * 255;
  }
  sharpenPixels(data, width, height, settings.sharpen);
  ctx.putImageData(frame, 0, 0);
  if (settings.glamour > 0 || settings.bloom > 0) {
    const glow = document.createElement('canvas'); glow.width = width; glow.height = height;
    const glowCtx = glow.getContext('2d');
    if (glowCtx) {
      glowCtx.filter = `blur(${2 + settings.bloom / 10}px)`;
      glowCtx.drawImage(canvas, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = settings.glamour / 100 * 0.18 + settings.bloom / 100 * 0.24;
      ctx.drawImage(glow, 0, 0);
      ctx.restore();
    }
  }
  if (settings.vignette !== 0) {
    const radius = Math.hypot(width, height) * 0.58;
    const gradient = ctx.createRadialGradient(width / 2, height / 2, radius * 0.28, width / 2, height / 2, radius);
    const amount = Math.abs(settings.vignette) / 100 * 0.72;
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, settings.vignette > 0 ? `rgba(0,0,0,${amount})` : `rgba(255,255,255,${amount * 0.65})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
}

export async function renderAdjustedImage(
  src: string,
  name: string,
  adjustments: ImageAdjustments,
  lut: LutChoice | null = null,
  lutIntensity = 100,
): Promise<{ file: File; width: number; height: number }> {
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  renderColorAdjusted(image, image.naturalWidth, image.naturalHeight, adjustments, lut, lutIntensity, canvas);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error(ia().exportFailed);
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return {
    file: new File([blob], `${base}-adjusted.png`, { type: 'image/png' }),
    width: canvas.width,
    height: canvas.height,
  };
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function UploadIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" /></svg>;
}

export default function ImageAdjustOverlay({ src, name, busy, onCancel, onCommit }: Props) {
  const [settings, setSettings] = React.useState<ImageAdjustments>(DEFAULT_ADJUSTMENTS);
  const [image, setImage] = React.useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [selectedLutId, setSelectedLutId] = React.useState('');
  const [lutIntensity, setLutIntensity] = React.useState(100);
  const [userLuts, setUserLuts] = React.useState<LutChoice[]>([]);
  const titleId = React.useId();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const locked = Boolean(busy || submitting);
  const lutChoices = [...PRESET_LUTS, ...userLuts];
  const selectedLut = lutChoices.find(item => item.id === selectedLutId) || null;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadImage(src).then(next => {
      if (!cancelled) setImage(next);
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : ia().readFailed);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [src]);

  React.useEffect(() => {
    if (!image || !canvasRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
      renderColorAdjusted(
        image,
        Math.max(1, Math.round(image.naturalWidth * scale)),
        Math.max(1, Math.round(image.naturalHeight * scale)),
        settings,
        selectedLut,
        lutIntensity,
        canvasRef.current!,
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [image, settings, selectedLut, lutIntensity]);

  const commit = async () => {
    if (locked) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await renderAdjustedImage(src, name, settings, selectedLut, lutIntensity);
      await onCommit(result.file, { width: result.width, height: result.height });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ia().saveFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const importLut = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const cube = parseCube(await file.text(), file.name);
      const id = `user-${Date.now().toString(36)}`;
      setUserLuts(current => [...current, { id, label: file.name, cube }]);
      setSelectedLutId(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ia().importLutFailed);
    }
  };

  const reset = () => {
    setSettings(DEFAULT_ADJUSTMENTS);
    setSelectedLutId('');
    setLutIntensity(100);
    setError('');
  };

  return (
    <CanvasHostedDialog
      open
      onOpenChange={nextOpen => { if (!nextOpen && !locked) onCancel(); }}
      className={`${styles.dialog} nodrag nopan nowheel`}
      canvasStyles={false}
      backdrop="transparent"
      ariaLabelledBy={titleId}
    >
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 id={titleId}>{ia().colorGrade}</h2>
            <span title={name}>{name}</span>
          </div>
          <Button variant="ghost" size="icon" className={styles.close} onClick={onCancel} disabled={locked} aria-label={ia().close}><CloseIcon /></Button>
        </header>
        <div className={styles.body}>
          <div className={styles.stage}>
            <canvas className={styles.preview} ref={canvasRef} aria-label={ia().previewAria(name)} />
            {loading && <div className={styles.loading} role="status">{ia().loadingImage}</div>}
          </div>
          <aside className={styles.sidebar} aria-label={ia().params}>
            <section className={styles.group}>
              <h3>{ia().filter} <span>LUT</span></h3>
              <div className={styles.lutRow}>
                <Select value={selectedLutId} disabled={locked} onChange={event => setSelectedLutId(event.currentTarget.value)} aria-label="LUT">
                  <option value="">{ia().noFilter}</option>
                  <optgroup label={ia().presets}>
                    {PRESET_LUTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </optgroup>
                  {userLuts.length > 0 && (
                    <optgroup label={ia().myLuts}>
                      {userLuts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </optgroup>
                  )}
                </Select>
                <Button variant="ghost" className={styles.importButton} onClick={() => fileRef.current?.click()} disabled={locked}><UploadIcon />{ia().import}</Button>
                <input ref={fileRef} hidden type="file" accept=".cube" onChange={event => { void importLut(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
              </div>
              {selectedLut && !selectedLut.preset && (
                <Button variant="ghost" className={styles.deleteLut} onClick={() => {
                  setUserLuts(current => current.filter(item => item.id !== selectedLut.id));
                  setSelectedLutId('');
                }}>{ia().deleteCurrentLut}</Button>
              )}
              <label className={styles.control} data-disabled={!selectedLut || locked}>
                <span>{ia().strength}</span><output>{lutIntensity}</output>
                <input className={styles.slider} aria-label={ia().filterStrength} type="range" min="0" max="100" value={lutIntensity} disabled={!selectedLut || locked} onChange={event => setLutIntensity(Number(event.currentTarget.value))} />
              </label>
            </section>
            {CONTROL_GROUPS.map(group => (
              <section className={styles.group} key={group.title}>
                <h3>{group.title}</h3>
                {group.controls.map(control => (
                  <label className={styles.control} key={control.key}>
                    <span>{control.label}</span><output>{settings[control.key]}</output>
                    <input
                      className={styles.slider}
                      aria-label={control.label}
                      type="range"
                      min={control.min}
                      max={control.max}
                      step="1"
                      value={settings[control.key]}
                      disabled={locked || loading}
                      onChange={event => {
                        const value = Number(event.currentTarget.value);
                        setSettings(current => ({ ...current, [control.key]: value }));
                      }}
                    />
                  </label>
                ))}
              </section>
            ))}
          </aside>
        </div>
        <footer className={styles.footer}>
          <div className={styles.feedback}>{error ? <p role="alert">{error}</p> : <span>{ia().livePreview}</span>}</div>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={reset} disabled={locked || loading || !image}>{ia().reset}</Button>
            <Button variant="subtle" onClick={onCancel} disabled={locked}>{ia().cancel}</Button>
            <Button variant="primary" className={styles.apply} onClick={() => { void commit(); }} disabled={locked || loading || !image} aria-label={ia().applyGrade} aria-busy={locked}>{locked ? ia().saving : ia().applyGrade}</Button>
          </div>
        </footer>
    </CanvasHostedDialog>
  );
}
