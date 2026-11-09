/**
 * BubbleBackground
 *
 * Animated gradient orb background — ported from animate-ui.com/docs/components/backgrounds/bubble
 * Renders 6 blurred, drifting radial-gradient orbs with a noise-blended backdrop.
 *
 * Usage:
 *   <BubbleBackground className="absolute inset-0 -z-10" />
 *   <BubbleBackground colors={{ first: "18,113,255", second: "221,74,255" }} interactive />
 */

'use client';

import { useEffect, useRef, type CSSProperties } from 'react';

import { cn } from '@/src/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BubbleColors {
  first?: string;   // RGB, e.g. "18,113,255"
  second?: string;
  third?: string;
  fourth?: string;
  fifth?: string;
  sixth?: string;
}

export interface BubbleBackgroundProps {
  /** Override any of the 6 orb colors (RGB string, no #). */
  colors?: BubbleColors;
  /** Follow the mouse cursor with the 6th orb. Default: false */
  interactive?: boolean;
  className?: string;
  /** Blur amount applied to the entire layer. Default: 40px */
  blurAmount?: string;
  /** Mix-blend-mode for orbs. Default: "hard-light" */
  blendMode?: CSSProperties['mixBlendMode'];
  /** Background color of the container. Default: dark blue hsl(240 50% 8%). Pass "transparent" to overlay on existing bg. */
  background?: string;
}

const DEFAULT_COLORS: Required<BubbleColors> = {
  first:  '18,113,255',
  second: '221,74,255',
  third:  '100,220,255',
  fourth: '200,50,50',
  fifth:  '180,180,50',
  sixth:  '140,100,255',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function BubbleBackground({
  colors,
  interactive = false,
  className,
  blurAmount = '40px',
  blendMode = 'hard-light',
  background,
}: BubbleBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cursorOrbRef = useRef<HTMLDivElement>(null);

  const c = { ...DEFAULT_COLORS, ...colors };

  useEffect(() => {
    if (!interactive || !cursorOrbRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const orb = cursorOrbRef.current;

    let raf = 0;
    let tx = 50, ty = 50; // target %
    let cx = 50, cy = 50; // current %

    const onMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      tx = ((e.clientX - rect.left) / rect.width) * 100;
      ty = ((e.clientY - rect.top) / rect.height) * 100;
    };

    const tick = () => {
      cx += (tx - cx) * 0.05;
      cy += (ty - cy) * 0.05;
      orb.style.left = `${cx}%`;
      orb.style.top = `${cy}%`;
      raf = requestAnimationFrame(tick);
    };

    container.addEventListener('mousemove', onMove);
    raf = requestAnimationFrame(tick);

    return () => {
      container.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [interactive]);

  const orbBase =
    'absolute rounded-full mix-blend-[var(--orb-blend)] animate-orb-drift opacity-80';

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-hidden bg-[hsl(var(--gradient-bg-hue,240)_50%_8%)]',
        className,
      )}
      style={{ '--orb-blend': blendMode, ...(background ? { background } : {}) } as CSSProperties}
    >
      {/* Noise SVG filter */}
      <svg className="sr-only" aria-hidden>
        <filter id="bubble-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feBlend in="SourceGraphic" mode="overlay" result="blend" />
        </filter>
      </svg>

      {/* Orb layer */}
      <div
        className="absolute inset-0"
        style={{ filter: `url(#bubble-noise) blur(${blurAmount})` }}
      >
        {/* Orb 1 */}
        <div
          className={cn(orbBase, 'w-[80%] h-[80%] -top-[20%] -left-[10%] animate-[orb-drift_25s_ease_infinite]')}
          style={{ background: `radial-gradient(circle at center, rgba(${c.first},0.8) 0%, transparent 70%)` }}
        />
        {/* Orb 2 */}
        <div
          className={cn(orbBase, 'w-[60%] h-[60%] top-[10%] right-[5%] animate-[orb-drift_20s_ease_infinite_3s]')}
          style={{ background: `radial-gradient(circle at center, rgba(${c.second},0.8) 0%, transparent 70%)` }}
        />
        {/* Orb 3 */}
        <div
          className={cn(orbBase, 'w-[50%] h-[50%] bottom-[0%] left-[20%] animate-[orb-drift_22s_ease_infinite_6s]')}
          style={{ background: `radial-gradient(circle at center, rgba(${c.third},0.8) 0%, transparent 70%)` }}
        />
        {/* Orb 4 */}
        <div
          className={cn(orbBase, 'w-[40%] h-[40%] top-[30%] left-[30%] animate-[orb-drift_18s_ease_infinite_2s]')}
          style={{ background: `radial-gradient(circle at center, rgba(${c.fourth},0.8) 0%, transparent 70%)` }}
        />
        {/* Orb 5 */}
        <div
          className={cn(orbBase, 'w-[45%] h-[45%] bottom-[10%] right-[10%] animate-[orb-drift_24s_ease_infinite_8s]')}
          style={{ background: `radial-gradient(circle at center, rgba(${c.fifth},0.8) 0%, transparent 70%)` }}
        />
        {/* Orb 6 — interactive cursor orb */}
        <div
          ref={cursorOrbRef}
          className={cn(
            orbBase,
            'w-[30%] h-[30%] -translate-x-1/2 -translate-y-1/2',
            interactive ? 'opacity-60' : 'opacity-0 pointer-events-none',
            !interactive && 'animate-[orb-drift_30s_ease_infinite_4s]',
          )}
          style={{
            background: `radial-gradient(circle at center, rgba(${c.sixth},0.8) 0%, transparent 70%)`,
            ...(interactive ? { position: 'absolute', left: '50%', top: '50%' } : {}),
          }}
        />
      </div>

      {/* Content slot */}
      <div className="relative z-10 h-full w-full" />
    </div>
  );
}
