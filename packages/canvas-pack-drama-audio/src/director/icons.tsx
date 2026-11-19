// Glyphs adapted from lucide-react 0.468.0. See LICENSE.lucide in this package.
import type { ReactNode } from 'react';

type IconProps = { size?: number; 'aria-hidden'?: boolean };

function Icon({ size = 24, children }: IconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>;
}

export function ArrowLeft(props: IconProps) {
  return <Icon {...props}>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Icon>;
}

export function ArrowRight(props: IconProps) {
  return <Icon {...props}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Icon>;
}

export function BookOpen(props: IconProps) {
  return <Icon {...props}>
    <path d="M12 7v14" />
    <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  </Icon>;
}

export function ClipboardPaste(props: IconProps) {
  return <Icon {...props}>
    <path d="M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1Z" />
    <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2M16 4h2a2 2 0 0 1 2 2v2M11 14h10" />
    <path d="m17 10 4 4-4 4" />
  </Icon>;
}

export function Copy(props: IconProps) {
  return <Icon {...props}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Icon>;
}

export function FolderOpen(props: IconProps) {
  return <Icon {...props}>
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </Icon>;
}

export function Magnet(props: IconProps) {
  return <Icon {...props}>
    <path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15" />
    <path d="m5 8 4 4" />
    <path d="m12 15 4 4" />
  </Icon>;
}

export function PanelLeftClose(props: IconProps) {
  return <Icon {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <path d="m16 15-3-3 3-3" />
  </Icon>;
}

export function PanelLeftOpen(props: IconProps) {
  return <Icon {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <path d="m14 9 3 3-3 3" />
  </Icon>;
}

export function Redo2(props: IconProps) {
  return <Icon {...props}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />
  </Icon>;
}

export function Scissors(props: IconProps) {
  return <Icon {...props}>
    <circle cx="6" cy="6" r="3" />
    <path d="M8.12 8.12 12 12" />
    <path d="M20 4 8.12 15.88" />
    <circle cx="6" cy="18" r="3" />
    <path d="M14.8 14.8 20 20" />
  </Icon>;
}

export function Search(props: IconProps) {
  return <Icon {...props}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </Icon>;
}

export function Trash2(props: IconProps) {
  return <Icon {...props}>
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    <line x1="10" x2="10" y1="11" y2="17" />
    <line x1="14" x2="14" y1="11" y2="17" />
  </Icon>;
}

export function Undo2(props: IconProps) {
  return <Icon {...props}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
  </Icon>;
}

export function X(props: IconProps) {
  return <Icon {...props}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>;
}

export function MoreHorizontal(props: IconProps) {
  return <Icon {...props}>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </Icon>;
}

export function Download(props: IconProps) {
  return <Icon {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </Icon>;
}

export function Upload(props: IconProps) {
  return <Icon {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5" />
    <path d="M12 3v12" />
  </Icon>;
}

export function Check(props: IconProps) {
  return <Icon {...props}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>;
}

export function Sparkles(props: IconProps) {
  return <Icon {...props}>
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
  </Icon>;
}

export function Film(props: IconProps) {
  return <Icon {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M7 3v18" />
    <path d="M3 7.5h4" />
    <path d="M3 12h18" />
    <path d="M3 16.5h4" />
    <path d="M17 3v18" />
    <path d="M17 7.5h4" />
    <path d="M17 16.5h4" />
  </Icon>;
}

export function FileText(props: IconProps) {
  return <Icon {...props}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </Icon>;
}

export function AudioLines(props: IconProps) {
  return <Icon {...props}>
    <path d="M2 10v3" />
    <path d="M6 6v11" />
    <path d="M10 3v18" />
    <path d="M14 8v7" />
    <path d="M18 5v13" />
    <path d="M22 10v3" />
  </Icon>;
}

export function Play(props: IconProps) {
  return <Icon {...props}>
    <path d="M6 3l14 9-14 9z" />
  </Icon>;
}

export function Pause(props: IconProps) {
  return <Icon {...props}>
    <rect x="14" y="4" width="4" height="16" rx="1" />
    <rect x="6" y="4" width="4" height="16" rx="1" />
  </Icon>;
}

export function RotateCcw(props: IconProps) {
  return <Icon {...props}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </Icon>;
}

export function RefreshCw(props: IconProps) {
  return <Icon {...props}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </Icon>;
}

export function ChevronLeft(props: IconProps) {
  return <Icon {...props}>
    <path d="m15 18-6-6 6-6" />
  </Icon>;
}

export function ChevronRight(props: IconProps) {
  return <Icon {...props}>
    <path d="m9 18 6-6-6-6" />
  </Icon>;
}

export function Scan(props: IconProps) {
  return <Icon {...props}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  </Icon>;
}

export function LocateFixed(props: IconProps) {
  return <Icon {...props}>
    <path d="M2 12h3" />
    <path d="M19 12h3" />
    <path d="M12 2v3" />
    <path d="M12 19v3" />
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="3" />
  </Icon>;
}

export function AlignHorizontal(props: IconProps) {
  return <Icon {...props}>
    <rect width="6" height="10" x="9" y="7" rx="2" />
    <path d="M4 22V2" />
    <path d="M20 22V2" />
  </Icon>;
}

export function ArrowUp(props: IconProps) {
  return <Icon {...props}>
    <path d="m5 12 7-7 7 7" />
    <path d="M12 19V5" />
  </Icon>;
}
