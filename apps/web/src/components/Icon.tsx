/**
 * Unified icon component — all UI glyphs go through this file.
 *
 * Backed by Lucide React (ISC, lucide.dev). All icons are stroke-based with
 * round linecap by default — consistent, clean, adjustable via strokeWidth.
 *
 * Adding a new icon: pick a Lucide name from lucide.dev, import it here,
 * add it to LUCIDE_MAP and the IconName union type.
 *
 * Do NOT import any other icon library in UI code.
 * Use <Icon name="…"> exclusively.
 */

import type { LucideIcon } from 'lucide-react';
import {
  createLucideIcon,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowDownWideNarrow,
  ArrowUp,
  ArrowUpRight,
  Bell,
  Bookmark,
  Blocks,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  History,
  Columns2,
  Crop,
  MessageCircle,
  Download,
  Ellipsis,
  EllipsisVertical,
  Eye,
  EyeOff,
  File,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  FolderHeart,
  Frame,
  Gauge,
  Heading1,
  Heading2,
  Heading3,
  Github,
  GitBranch,
  Globe,
  Grid2x2,
  Grid3x3,
  GripVertical,
  Hammer,
  HelpCircle,
  Home,
  Image,
  Info,
  Italic,
  Kanban,
  Key,
  Languages,
  Layout,
  LayoutDashboard,
  Lightbulb,
  LibraryBig,
  Link,
  List,
  ListOrdered,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Bold,
  Maximize2,
  Mic,
  Minimize2,
  Minus,
  Moon,
  Orbit,
  Pause,
  Paintbrush,
  Palette,
  PanelLeft,
  Pilcrow,
  Pencil,
  SquarePen,
  Play,
  Plus,
  PlusCircle,
  Presentation,
  Puzzle,
  Redo2,
  RefreshCw,
  RefreshCcw,
  Search,
  Scissors,
  ScanLine,
  Send,
  Settings,
  Settings2,
  Share2,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Star,
  StopCircle,
  Sun,
  SunMoon,
  SwatchBook,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Undo2,
  Upload,
  Users,
  Video,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type IconName =
  | 'alert-triangle'
  | 'arrow-left'
  | 'arrow-right'
  | 'sort'
  | 'arrow-up'
  | 'artboard'
  | 'attach'
  | 'bar-chart-box'
  | 'bell'
  | 'bookmark'
  | 'blocks'
  | 'brain'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'close'
  | 'comment'
  | 'copy'
  | 'crop'
  | 'dashboard'
  | 'discord'
  | 'download'
  | 'draw'
  | 'edit'
  | 'external-link'
  | 'eye'
  | 'eye-off'
  | 'file'
  | 'file-code'
  | 'file-text'
  | 'folder'
  | 'folder-open'
  | 'folder-filled'
  | 'fork'
  | 'github'
  | 'github-filled'
  | 'globe'
  | 'grid'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'grip-vertical'
  | 'hammer'
  | 'help-circle'
  | 'history'
  | 'home'
  | 'home-filled'
  | 'image'
  | 'import'
  | 'info'
  | 'italic'
  | 'integrations-filled'
  | 'kanban'
  | 'key'
  | 'languages'
  | 'layers-filled'
  | 'layout'
  | 'lightbulb'
  | 'library-big'
  | 'link'
  | 'list'
  | 'list-ordered'
  | 'lock'
  | 'log-in'
  | 'log-out'
  | 'mail'
  | 'bold'
  | 'maximize'
  | 'mic'
  | 'minimize'
  | 'minus'
  | 'moon'
  | 'more-horizontal'
  | 'orbit'
  | 'pause'
  | 'paint-bucket'
  | 'palette'
  | 'palette-filled'
  | 'panel-left'
  | 'paragraph'
  | 'pencil'
  | 'square-pen'
  | 'edit-simple'
  | 'play'
  | 'plus'
  | 'plus-filled'
  | 'present'
  | 'puzzle'
  | 'redo'
  | 'refresh'
  | 'reload'
  | 'robot'
  | 'search'
  | 'scissors'
  | 'scan-line'
  | 'send'
  | 'settings'
  | 'share'
  | 'slides'
  | 'sliders'
  | 'smartphone'
  | 'sparkles'
  | 'spinner'
  | 'star'
  | 'stop'
  | 'sun'
  | 'sun-moon'
  | 'swatchbook'
  | 'terminal'
  | 'thumbs-down'
  | 'thumbs-up'
  | 'translate'
  | 'trash'
  | 'tweaks'
  | 'undo'
  | 'upload'
  | 'users'
  | 'video-ai'
  | 'volume'
  | 'zoom-in'
  | 'zoom-out';

const LUCIDE_MAP: Record<IconName, LucideIcon> = {
  'alert-triangle':   AlertTriangle,
  'arrow-left':       ArrowLeft,
  'arrow-right':      ArrowRight,
  'sort':             ArrowDownWideNarrow,
  'arrow-up':         ArrowUp,
  'artboard':         Frame,
  'attach':           Clipboard,
  'bar-chart-box':    Gauge,
  'bell':             Bell,
  'bookmark':         Bookmark,
  'blocks':           Blocks,
  'brain':            Brain,
  'check':            Check,
  'chevron-down':     ChevronDown,
  'chevron-left':     ChevronLeft,
  'chevron-right':    ChevronRight,
  'close':            X,
  'comment':          MessageCircle,
  'copy':             Clipboard,
  'crop':             Crop,
  'dashboard':        LayoutDashboard,
  'discord':          GripVertical,    // Lucide 无官方 Discord logo，用中性占位
  'download':         Download,
  'draw':             Pencil,
  'edit':             Pencil,
  'external-link':    ArrowUpRight,
  'eye':              Eye,
  'eye-off':          EyeOff,
  'file':             File,
  'file-code':        FileCode,
  'file-text':        FileText,
  'folder':           Folder,
  'folder-open':      FolderOpen,
  'folder-filled':    FolderHeart,
  'fork':             GitBranch,
  'github':           Github,
  'github-filled':    Github,
  'globe':            Globe,
  'grid':             Grid3x3,
  'heading-1':        Heading1,
  'heading-2':        Heading2,
  'heading-3':        Heading3,
  'grip-vertical':    GripVertical,
  'hammer':           Hammer,
  'help-circle':      HelpCircle,
  'history':          History,
  'home':             Home,
  'home-filled':      Home,
  'image':            Image,
  'import':           Upload,
  'info':             Info,
  'italic':           Italic,
  'integrations-filled': Puzzle,
  'kanban':           Kanban,
  'key':              Key,
  'languages':        Languages,
  'layers-filled':    Columns2,
  'layout':           Layout,
  'lightbulb':        Lightbulb,
  'library-big':      LibraryBig,
  'link':             Link,
  'list':             List,
  'list-ordered':     ListOrdered,
  'lock':             Lock,
  'log-in':           LogIn,
  'log-out':          LogOut,
  'mail':             Mail,
  'bold':             Bold,
  'maximize':         Maximize2,
  'mic':              Mic,
  'minimize':         Minimize2,
  'minus':            Minus,
  'moon':             Moon,
  'more-horizontal':  Ellipsis,
  'orbit':            Orbit,
  'pause':            Pause,
  'paint-bucket':     Paintbrush,
  'palette':          Palette,
  'palette-filled':   Palette,
  'panel-left':       PanelLeft,
  'paragraph':        Pilcrow,
  'pencil':           Pencil,
  'square-pen':       SquarePen,
  'edit-simple':      createLucideIcon('EditSimple', [
    ['path', { d: 'M13 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8', key: 'frame' }],
    ['path', { d: 'm12 12 9-9', key: 'pen' }],
  ]),
  'play':             Play,
  'plus':             Plus,
  'plus-filled':      PlusCircle,
  'present':          Presentation,
  'puzzle':           Puzzle,
  'redo':             Redo2,
  'refresh':          RefreshCw,
  'reload':           RefreshCcw,
  'robot':            Bot,
  'search':           Search,
  'scissors':         Scissors,
  'scan-line':        ScanLine,
  'send':             Send,
  'settings':         Settings,
  'share':            Share2,
  'slides':           Presentation,
  'sliders':          SlidersHorizontal,
  'smartphone':       Smartphone,
  'sparkles':         Sparkles,
  'spinner':          Loader2,
  'star':             Star,
  'stop':             StopCircle,
  'sun':              Sun,
  'sun-moon':         SunMoon,
  'swatchbook':       SwatchBook,
  'terminal':         Terminal,
  'thumbs-down':      ThumbsDown,
  'thumbs-up':        ThumbsUp,
  'translate':        Languages,
  'trash':            Trash2,
  'tweaks':           Settings2,
  'undo':             Undo2,
  'upload':           Upload,
  'users':            Users,
  'video-ai':         Video,
  'volume':           Volume2,
  'zoom-in':          ZoomIn,
  'zoom-out':         ZoomOut,
};

interface Props {
  name: IconName;
  size?: number | string;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<SVGSVGElement>;
  'aria-label'?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}

/**
 * Unified icon component. Renders a Lucide glyph (round linecap, stroke-based)
 * with a stable `bezier-icon` class so existing CSS selectors continue to work.
 *
 * Pass `strokeWidth` to adjust line thickness (default 2, round linecap).
 * The `spinner` name gets an `icon-spin` class for CSS rotation animation.
 */
export function Icon({ name, size = 14, strokeWidth = 1.7, className, ...rest }: Props) {
  const LIcon = LUCIDE_MAP[name];
  if (!LIcon) {
    // Graceful degradation: empty SVG keeps layout footprint.
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden
        className={`bezier-icon${className ? ` ${className}` : ''}`}
        {...(rest as React.SVGProps<SVGSVGElement>)}
      />
    );
  }

  const spinClass = name === 'spinner' ? ' icon-spin' : '';

  return (
    <LIcon
      size={size}
      strokeWidth={strokeWidth}
      className={`bezier-icon${spinClass}${className ? ` ${className}` : ''}`}
      aria-hidden
      {...(rest as any)}
    />
  );
}
