'use client';

import { FileText, PanelsTopLeft, Presentation, Image, Video, ArrowLeft, ChevronRight, Folder, Pencil, Plus, X, Bot, ChevronDown, CircleCheck, GitBranch, MessageCircleQuestion, Package, Play, Type, GalleryHorizontal, Scissors } from 'lucide-react';

/**
 * 中立工作台图标入口。工作流语义图标与下拉箭头使用项目统一的 Lucide 库。
 *
 * 为什么要有这个文件：知识库页原先用 emoji（📁📂📄📚⟳）当图标，
 * 而画布节点用的是 1.3px stroke 的线性 SVG。emoji 由系统字体渲染，
 * 字重、光学重心、颜色全都不受控，跟旁边的文字排在一起必然显脏，
 * 也没法跟着 currentColor 变。统一收到这里，画布和管理台共用一套。
 *
 * 旧图标保留 16×16 路径以兼容其他画布消费者；新工作流图标使用 Lucide 24×24。
 * 图标只描边不填充，粗细走 stroke-width,
 * 颜色继承 currentColor —— 这样图标永远和它旁边的文字同色同深浅。
 */

type LibraryIconName = keyof typeof LIBRARY_ICONS;
const LIBRARY_ICONS = {
  'artifact-text': FileText, 'artifact-page': PanelsTopLeft, 'artifact-presentation': Presentation, 'artifact-image': Image, 'artifact-video': Video,
  type: Type,
  'gallery-horizontal': GalleryHorizontal,
  scissors: Scissors,
  'arrow-left': ArrowLeft,
  'chevron-right': ChevronRight,
  folder: Folder,
  edit: Pencil,
  plus: Plus,
  close: X,
  play: Play,
  'message-circle-question': MessageCircleQuestion,
  bot: Bot,
  'git-branch': GitBranch,
  'circle-check': CircleCheck,
  package: Package,
  'chevron-down': ChevronDown,
};

export type IconName = LibraryIconName | LegacyIconName;
type LegacyIconName =
  | 'book'
  | 'folder'
  | 'folder-open'
  | 'file'
  | 'text'
  | 'page'
  | 'presentation'
  | 'search'
  | 'plus'
  | 'expand'
  | 'collapse'
  | 'refresh'
  | 'close'
  | 'chevron-right'
  | 'arrow-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'download'
  | 'copy'
  | 'grip'
  | 'storyboard'
  | 'clip'
  | 'users'
  | 'tag'
  | 'trash'
  | 'check'
  | 'eye'
  | 'code'
  | 'alert'
  | 'home'
  | 'help'
  | 'image'
  | 'video'
  | 'sparkle'
  | 'layers'
  | 'clock'
  | 'more'
  | 'edit';

const PATHS: Record<LegacyIconName, string> = {
  // 竖立的书本：书脊 + 内页，和 folder 区分开。
  book: 'M4 2.6h6.4a1.6 1.6 0 0 1 1.6 1.6v9.2H5.6A1.6 1.6 0 0 1 4 11.8zM4 11.8h8',
  folder: 'M2.2 5.2a1.4 1.4 0 0 1 1.4-1.4h2.3l1.3 1.6h5.2a1.4 1.4 0 0 1 1.4 1.4v4.6a1.4 1.4 0 0 1-1.4 1.4H3.6a1.4 1.4 0 0 1-1.4-1.4z',
  'folder-open': 'M2.2 5.2a1.4 1.4 0 0 1 1.4-1.4h2.3l1.3 1.6h5.2a1.4 1.4 0 0 1 1.4 1.4M2.2 5.6l1.1 6.2a1.4 1.4 0 0 0 1.4 1.2h7.2a1.4 1.4 0 0 0 1.4-1.2l.9-4.6H3.4',
  file: 'M4 2.4h4.6L12 5.8v7.8H4zM8.5 2.5v3.4H12',
  text: 'M3 3.4h10M3 6.5h10M3 9.6h10M3 12.7h6.6',
  page: 'M2.6 2.8h10.8v10.4H2.6zM2.6 5.7h10.8M4.6 4.25h.01M6.6 4.25h.01',
  presentation: 'M2.6 2.8h10.8v8H2.6zM8 10.8v2.8M5.8 13.6h4.4M5 5.3h6M5 7.3h3.7',
  search: 'M7.2 12.2a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10.9 10.9 14 14',
  plus: 'M8 3.4v9.2M3.4 8h9.2',
  expand: 'M9.7 2.6h3.7v3.7M6.3 13.4H2.6V9.7M13.4 2.6 9.2 6.8M2.6 13.4l4.2-4.2',
  collapse: 'M13.4 6.3H9.7V2.6M2.6 9.7h3.7v3.7M9.7 6.3l4.2-4.2M2.1 13.9l4.2-4.2',
  refresh: 'M13 8a5 5 0 1 1-1.7-3.8M13 2.6v2.9h-2.9',
  close: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6',
  'chevron-right': 'M6.2 3.6 10.6 8l-4.4 4.4',
  'arrow-right': 'M3 8h9.4M8.8 4.4 12.4 8l-3.6 3.6',
  'arrow-down': 'M8 3.4v9.2M4.4 9 8 12.6 11.6 9',
  download: 'M8 2.4v7.8M4.8 7 8 10.2 11.2 7M3 13.6h10',
  copy: 'M5.4 5.4h7.2v7.2H5.4zM10.6 5.4v-2H3.4v7.2h2',
  grip: 'M5.2 4.1h.01M10.8 4.1h.01M5.2 8h.01M10.8 8h.01M5.2 11.9h.01M10.8 11.9h.01',
  // Three ordered shot frames with a shared timing rail. This stays distinct
  // from both the webpage grid and the scissors used for timeline editing.
  storyboard: 'M2.2 3.2h3.2v5.2H2.2zM6.4 3.2h3.2v5.2H6.4zM10.6 3.2h3.2v5.2h-3.2zM3 11.3h10M3 13.2h6.4',
  clip: 'M5 6.7a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM5 12.9a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM6.4 6.2l6.4 6.4M6.4 9.8l6.4-6.4',
  users: 'M10.4 13.4v-1.2a2.4 2.4 0 0 0-2.4-2.4H4.8a2.4 2.4 0 0 0-2.4 2.4v1.2M6.4 7.6a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6zM13.6 13.4v-1.2a2.4 2.4 0 0 0-1.8-2.3M10.2 3.2a2.3 2.3 0 0 1 0 4.4',
  tag: 'M13.2 8.9 8.9 13.2a1.2 1.2 0 0 1-1.7 0L2.6 8.6V2.6h6l4.6 4.6a1.2 1.2 0 0 1 0 1.7zM5.3 5.3h.01',
  trash: 'M2.8 4.6h10.4M6 4.6V3.2h4v1.4M4.2 4.6l.7 8.2h6.2l.7-8.2',
  check: 'M3.4 8.4l3 3 6.2-6.8',
  eye: 'M1.6 8S4 3.8 8 3.8 14.4 8 14.4 8 12 12.2 8 12.2 1.6 8 1.6 8zM8 9.9A1.9 1.9 0 1 0 8 6.1a1.9 1.9 0 0 0 0 3.8z',
  code: 'M5.6 11.6 2.6 8l3-3.6M10.4 4.4 13.4 8l-3 3.6',
  alert: 'M8 3.2 14 13H2zM8 6.8v2.6M8 11.3h.01',
  'arrow-up': 'M8 12.6V3.4M4.4 7 8 3.4 11.6 7',
  home: 'M2.6 6.6 8 2.4l5.4 4.2v6.2a.8.8 0 0 1-.8.8H3.4a.8.8 0 0 1-.8-.8zM6.4 13.6V9h3.2v4.6',
  help: 'M8 14.2a6.2 6.2 0 1 0 0-12.4 6.2 6.2 0 0 0 0 12.4zM6.3 6.2a1.75 1.75 0 1 1 2.6 1.5c-.55.33-.9.72-.9 1.3v.3M8 11.7h.01',
  image: 'M3.4 2.8h9.2a.8.8 0 0 1 .8.8v8.8a.8.8 0 0 1-.8.8H3.4a.8.8 0 0 1-.8-.8V3.6a.8.8 0 0 1 .8-.8zM6 7a1.15 1.15 0 1 0 0-2.3A1.15 1.15 0 0 0 6 7zM2.6 11l3.1-3 3 2.9 2-1.9 2.7 2.6',
  video: 'M2.6 4.4a1 1 0 0 1 1-1h5.2a1 1 0 0 1 1 1v7.2a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1zM9.8 7l3.6-2.4v6.8L9.8 9z',
  // 四角星 + 小星：AI 生成语义，Lovart 的「设计代理」入口用的就是这种符号
  sparkle: 'M6.4 2.6l1 2.7 2.7 1-2.7 1-1 2.7-1-2.7-2.7-1 2.7-1zM11.6 9.2l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55z',
  layers: 'M8 2.4 2.6 5.2 8 8l5.4-2.8zM2.6 8.4 8 11.2l5.4-2.8M2.6 11.2 8 14l5.4-2.8',
  clock: 'M8 14.2a6.2 6.2 0 1 0 0-12.4 6.2 6.2 0 0 0 0 12.4zM8 4.9V8l2.2 1.6',
  more: 'M8 8.01h.01M3.4 8.01h.01M12.6 8.01h.01',
  // 复用画布文本节点已在使用的编辑图形，避免同一个产品里出现两套铅笔。
  edit: 'M4 14.9l.7-3.2 7.7-7.7a1.8 1.8 0 0 1 2.5 2.5l-7.7 7.7-3.2.7ZM11.3 5l3.7 3.7',
};

export function Icon({
  name,
  size = 14,
  strokeWidth,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  if (name in LIBRARY_ICONS) {
    const Glyph = LIBRARY_ICONS[name as LibraryIconName];
    return <Glyph className={className} size={size} strokeWidth={strokeWidth ?? 1.7} aria-hidden="true" focusable="false" />;
  }
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? 1.35}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name as LegacyIconName]} />
    </svg>
  );
}
