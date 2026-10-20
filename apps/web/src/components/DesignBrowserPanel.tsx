import { PROJECT_LAYOUT, type WorkspaceCollabContext } from '@bezier/contracts';
import { AssetPreviewDialog } from './AssetContentPreview';
import '../styles/workspace/design-browser.css';
import homeStyles from './DesignBrowserStart.module.css';
import { BrowserSiteDialog } from './BrowserSiteDialog';
import { ConfirmDialog, Dialog, DialogTitle, DialogBody, DialogFooter } from './ui';
import { BrowserExtensionSection } from './BrowserExtensionSection';
import { browserHttpUrl, reloadBrowserPreferences, updateBrowserReferences, useBrowserPreferences } from '../browser-resources/browser-preferences';

import { Button, Input, Select, Textarea, Popover, PopoverAnchor, PopoverContent } from '@/src/components/ui';
import { MOBILE_BROWSER_USER_AGENT, OPEN_COLLECTOR_TAB_EVENT, droppedBrowserImage } from './browser-collector-tools';
import { BrowserBookmarks } from './BrowserBookmarks';
import { useBrowserAssetCapture } from './BrowserAssetCapture';
import { BrowserCaptureSettings } from './BrowserCaptureSettings';
import { useBrowserResourcePlugin } from '../browser-resources/BrowserResourcePlugin';
import { PROJECT_FILE_ADD_TO_CANVAS_EVENT, PROJECT_FILE_DRAG_MIME } from '@bezier/contracts';
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  clearHostBrowserData,
  getBezierHost,
  isBezierHostAvailable,
} from '@bezier/host';
import {
  openExternalUrl,
  projectRawUrl,
  writeProjectBase64File,
  writeProjectTextFile,
} from '../providers/registry';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import {
  commentSendCompleted,
  commentSendSucceeded,
  type CommentSendResult,
} from './comment-send-result';
import {
  registerBrandBrowser,
  type BrandBrowserHandle,
  type BrandBrowserPageSnapshotResult,
} from '../browser-resources/brand-browser-bridge';
import { captureHostRegionSnapshot } from '../runtime/exports';
import { buildBoardCommentAttachments, commentsToAttachments } from '../comments';
import type {
  ChatAttachment,
  ChatCommentAttachment,
  PreviewAnnotationStyle,
  PreviewComment,
  PreviewCommentTarget,
} from '../types';
import {
  BROWSER_CANCEL_PICKER_SCRIPT,
  BROWSER_CAPTURE_PAGE_ARCHIVE_SCRIPT,
  BROWSER_PAGE_ARCHIVE_INDEX_FILE,
  BROWSER_PAGE_ARCHIVE_SCHEMA,
  BROWSER_SERIALIZE_HTML_SCRIPT,
  type BrowserPageArchiveCapture,
  type BrowserPageArchiveManifest,
  type BrowserElementSnapshot,
  type BrowserViewportId,
  browserApplyStyleScript,
  browserApplyTextScript,
  browserCommentFilePath,
  browserElementPickerScript,
  browserMeasureTargetsScript,
  browserSnapshotFromUnknown,
  isProjectHtmlBrowserUrl,
  projectRelativePathFromBrowserUrl,
} from './design-browser-tools';
import {
  DESIGN_BROWSER_HISTORY_LIMIT,
  DESIGN_BROWSER_HISTORY_CHANGED,
  loadBrowserViewport,
  loadHistory,
  saveBrowserViewport,
  saveHistory,
  type BrowserHistoryEntry,
} from './design-browser-storage';
import { Icon } from './Icon';
import type { ProjectFile } from '@bezier/contracts';
import { FilterChipRail } from './FilterChipRail';
import { BoardComposerPopover } from './BoardComposerPopover';
import { canExtractBrowserPage, type BrowserPageExtractionRequest } from './browser-page-extraction';

export {
  removeDesignBrowserProjectCache,
  designBrowserHistoryStorageKey,
  designBrowserViewportStorageKey,
  isHistoryEntry,
  loadBrowserViewport,
  loadHistory,
  saveBrowserViewport,
  saveHistory,
  type BrowserHistoryEntry,
} from './design-browser-storage';

type BrowserNavigationEntry = {
  title: string;
  url: string;
};

type ReferenceSite = {
  label: string;
  url: string;
  detail: string;
  customId?: string;
};

type ReferenceGroup = {
  /** Stable key used for the category filter (lowercase, no spaces). */
  id: string;
  title: string;
  sites: ReferenceSite[];
};

type BrowserTool = 'comment' | 'inspect' | 'edit';
type BrowserSavingAction = 'archive' | 'screenshot';
type BrowserStatusMessage = string | {
  actionFileName?: string;
  actionLabel?: string;
  actionTarget?: 'design-files' | 'file';
  message: string;
  source?: 'page-snapshot';
};
export interface BrowserPageSnapshotToastEvent {
  actionFileName?: string;
  actionLabel?: string;
  actionTarget?: 'design-files' | 'file';
  elapsedSeconds?: number;
  message: string;
  onCancel?: () => void;
  status: 'loading' | 'success' | 'error' | 'canceled';
  tabId: string;
  ttlMs?: number;
}
type BrowserStyleDraft = Required<Pick<
  PreviewAnnotationStyle,
  'backgroundColor' | 'borderRadius' | 'color' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'paddingTop' | 'textAlign'
>>;

type WebviewElement = HTMLElement & {
  copy(): void;
  paste(): void;
  getWebContentsId(): number;
  canGoBack(): boolean;
  canGoForward(): boolean;
  capturePage(): Promise<{ toDataURL(): string }>;
  executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
  getTitle(): string;
  getURL(): string;
  goBack(): void;
  goForward(): void;
  isLoading(): boolean;
  loadURL?(url: string): void | Promise<void>;
  reload(): void;
  reloadIgnoringCache(): void;
  stop?(): void;
};

type WebviewNavigationEvent = Event & {
  isMainFrame?: boolean;
  url?: string;
};

type WebviewTitleEvent = Event & {
  explicitSet?: boolean;
  title?: string;
};

type WebviewFaviconEvent = Event & {
  favicons?: string[];
};

type WebviewConsoleMessageEvent = Event & {
  message?: string;
};

function isPromiseLike<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as { then?: unknown }).then === 'function'
  );
}

function isBenignWebviewLoadAbort(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  return /\bERR_ABORTED\b|loading ['"][^'"]+['"] was aborted/i.test(message);
}

export interface DesignBrowserPanelProps {
  /** Optional identity supplied by the embedding workspace, never global chat state. */
  workspaceContext?: WorkspaceCollabContext | null;
  variant?: 'workspace' | 'collector';
  onCollectedFile?: (file: ProjectFile, source: { url: string; title: string; imageUrl?: string; capturedAt: number; captureMode?: 'original-resource' | 'visible-snapshot' }) => Promise<void> | void;
  initialIconUrl?: string;
  initialTitle?: string;
  initialUrl?: string;
  navigateRequest?: { url: string; nonce: number };
  attentionRequest?: { action: 'download-page'; nonce: number };
  projectId: string;
  resolvedDir?: string | null;
  onOpenFile: (name: string) => void;
  onBezierFiles?: () => void;
  onRefreshFiles: () => Promise<void> | void;
  onPageInfoChange?: (info: BrowserPageInfo) => void;
  previewComments?: PreviewComment[];
  onSavePreviewComment?: (target: PreviewCommentTarget, note: string, attachAfterSave: boolean, images?: File[], commentId?: string) => Promise<PreviewComment | null>;
  onRemovePreviewComment?: (commentId: string) => Promise<boolean>;
  onSendBoardCommentAttachments?: (attachments: ChatCommentAttachment[], images?: File[]) => Promise<CommentSendResult> | CommentSendResult;
  onAddImageToChat?: (attachment: ChatAttachment) => void | Promise<void>;
  onPageSnapshotToast?: (event: BrowserPageSnapshotToastEvent) => void;
  onExtractPage?: (request: BrowserPageExtractionRequest) => Promise<void>;
  sendDisabled?: boolean;
  /** Workspace tab id. When set, this panel registers its live webview in the
   *  brand-browser bridge so the chat can read the rendered DOM (e.g. to
   *  re-extract a brand after the user clears an anti-bot wall). */
  browserTabId?: string;
}

export interface BrowserPageInfo {
  iconUrl?: string;
  title: string;
  url: string;
}

const EMPTY_URL = 'about:blank';
const EXTRACTION_CAPTURE_TIMEOUT_MS = 8000;
const DESIGN_BROWSER_PARTITION = 'persist:bezier-design-browser';
// Only the source browser may consume a drop when multiple surfaces coexist.
let activeResourceBrowser: EventTarget | null = null;
const HISTORY_LIMIT = DESIGN_BROWSER_HISTORY_LIMIT;
const HISTORY_SUGGESTION_LIMIT = 20;
const EMPTY_PREVIEW_COMMENTS: PreviewComment[] = [];
// Cap the resource-hint (`dns-prefetch`/`preconnect`) links we leave in <head>.
// Hovering/typing origins used to accumulate them and their Set entries forever.
const WARMED_ORIGIN_LIMIT = 32;
const warmedOrigins = new Map<string, HTMLLinkElement[]>();

function browserHomeNavigationEntry(): BrowserNavigationEntry {
  return { title: 'Reference Board', url: EMPTY_URL };
}

function referenceGroupTitleKey(group: ReferenceGroup): keyof Dict {
  return `designBrowser.reference.group.${group.id}` as keyof Dict;
}

function referenceSiteDetailKey(site: ReferenceSite): keyof Dict {
  return `designBrowser.reference.site.${referenceSiteId(site.url)}.detail` as keyof Dict;
}

function localizedReferenceGroupTitle(
  group: ReferenceGroup,
  t?: (key: keyof Dict) => string,
): string {
  return t ? t(referenceGroupTitleKey(group)) : group.title;
}

function localizedReferenceSiteDetail(
  site: ReferenceSite,
  t?: (key: keyof Dict) => string,
): string {
  return t && !site.customId ? t(referenceSiteDetailKey(site)) : site.detail;
}

function initialBrowserState(initialUrl?: string, initialTitle?: string): {
  addressValue: string;
  navigationIndex: number;
  navigationStack: BrowserNavigationEntry[];
  url: string;
} {
  const url = initialUrl?.trim() && isHistoryUrl(initialUrl.trim())
    ? initialUrl.trim()
    : EMPTY_URL;
  if (url === EMPTY_URL) {
    return {
      addressValue: '',
      navigationIndex: 0,
      navigationStack: [browserHomeNavigationEntry()],
      url,
    };
  }
  const title = initialTitle?.trim() || labelFromUrl(url);
  return {
    addressValue: url,
    navigationIndex: 0,
    navigationStack: [{ title, url }],
    url,
  };
}

// The Reference Board catalogue. Order is intentional: the categories a working
// designer reaches for most often (inspiration, real product UI) lead, followed
// by motion/color/type/asset references, then systems/guidelines/tooling.
// Adding a group here automatically adds its filter chip and address-bar
// suggestions — `id` is the stable filter key, `title` is the display label.
export const REFERENCE_GROUPS: ReferenceGroup[] = [
  {
    id: 'inspiration',
    title: 'Inspiration',
    sites: [
      { label: 'Dribbble', url: 'https://dribbble.com/', detail: 'Design shots and UI inspiration.' },
      { label: 'Behance', url: 'https://www.behance.net/', detail: 'Creative portfolios and case studies.' },
      { label: 'Awwwards', url: 'https://www.awwwards.com/', detail: 'Award-winning website design.' },
      { label: 'Godly', url: 'https://godly.website/', detail: 'Curated modern web design.' },
      { label: 'Land-book', url: 'https://land-book.com/', detail: 'Landing page gallery and patterns.' },
    ],
  },
  {
    id: 'interfaces',
    title: 'Real Interfaces',
    sites: [
      { label: 'Mobbin', url: 'https://mobbin.com/', detail: 'Real app screens and UI patterns.' },
      { label: 'Screenlane', url: 'https://screenlane.com/', detail: 'Latest UI design patterns from apps.' },
      { label: 'Page Flows', url: 'https://pageflows.com/', detail: 'Real product user flows and onboarding.' },
      { label: 'UI Sources', url: 'https://www.uisources.com/', detail: 'Interaction patterns from top apps.' },
      { label: 'Collect UI', url: 'https://collectui.com/', detail: 'Daily UI collection by category.' },
    ],
  },
  {
    id: 'motion',
    title: 'Motion',
    sites: [
      { label: 'GSAP', url: 'https://gsap.com/', detail: 'Production animation engine and examples.' },
      { label: 'Animations.dev', url: 'https://animations.dev/', detail: 'Animation patterns and interaction examples.' },
      { label: 'Transitions', url: 'https://transitions.dev/', detail: 'Transition patterns for modern interfaces.' },
      { label: 'Motion Sites', url: 'https://motionsites.ai/', detail: 'High-end motion and interaction references.' },
      { label: 'Motion.page Showcase', url: 'https://motion.page/showcase/', detail: 'Scroll and timeline animation inspiration.' },
      { label: 'Animography', url: 'https://animography.net/', detail: 'Animated type and kinetic lettering.' },
      { label: 'React Bits Shiny Text', url: 'https://reactbits.dev/text-animations/shiny-text', detail: 'React text animation reference for shiny kinetic type.' },
    ],
  },
  {
    id: 'color',
    title: 'Color',
    sites: [
      { label: 'Coolors', url: 'https://coolors.co/', detail: 'Fast color palette generator.' },
      { label: 'Color Hunt', url: 'https://colorhunt.co/', detail: 'Curated color palettes.' },
      { label: 'Realtime Colors', url: 'https://www.realtimecolors.com/', detail: 'Preview palettes on a real UI.' },
      { label: 'Adobe Color', url: 'https://color.adobe.com/', detail: 'Color wheel and harmony rules.' },
      { label: 'Happy Hues', url: 'https://www.happyhues.co/', detail: 'Palettes shown in real context.' },
    ],
  },
  {
    id: 'type',
    title: 'Typography',
    sites: [
      { label: 'Google Fonts', url: 'https://fonts.google.com/', detail: 'Open-source font library.' },
      { label: 'Fontshare', url: 'https://www.fontshare.com/', detail: 'Quality fonts free for commercial use.' },
      { label: 'Typewolf', url: 'https://www.typewolf.com/', detail: 'Fonts in use and pairing guidance.' },
      { label: 'Fontpair', url: 'https://www.fontpair.co/', detail: 'Font pairing suggestions.' },
      { label: 'Fonts In Use', url: 'https://fontsinuse.com/', detail: 'Typography in real-world design.' },
    ],
  },
  {
    id: 'icons',
    title: 'Icons',
    sites: [
      { label: 'The SVG', url: 'https://thesvg.org/', detail: 'SVG assets and vector references.' },
      { label: 'SVG Logos', url: 'https://svglogos.dev/', detail: 'Clean SVG logos for product and brand mocks.' },
      { label: 'Lobe Icons', url: 'https://icons.lobehub.com/', detail: 'Product and AI-brand icons for interfaces.' },
      { label: 'Iconify', url: 'https://icon-sets.iconify.design/', detail: '200k+ open-source icons in one place.' },
      { label: 'Lucide', url: 'https://lucide.dev/', detail: 'Clean, consistent open icon set.' },
      { label: 'Heroicons', url: 'https://heroicons.com/', detail: 'Tailwind-made SVG icons.' },
      { label: 'SVG Repo', url: 'https://www.svgrepo.com/', detail: 'Free SVG vectors and icons.' },
    ],
  },
  {
    id: 'illustration',
    title: 'Illustration',
    sites: [
      { label: 'Storyset', url: 'https://storyset.com/', detail: 'Customizable vector illustrations.' },
      { label: 'unDraw', url: 'https://undraw.co/', detail: 'Open-source MIT illustrations.' },
      { label: 'Blush', url: 'https://blush.design/', detail: 'Mix-and-match illustrations.' },
      { label: 'Lummi', url: 'https://www.lummi.ai/', detail: 'Free AI-generated visuals.' },
      { label: 'Whirrls', url: 'https://www.whirrls.com/', detail: 'Hand-drawn image references.' },
      { label: 'World in Dots', url: 'https://www.worldindots.com/', detail: 'Dot-map and data-viz references.' },
    ],
  },
  {
    id: 'photography',
    title: 'Photography',
    sites: [
      { label: 'Unsplash', url: 'https://unsplash.com/', detail: 'Free high-resolution photos.' },
      { label: 'Pexels', url: 'https://www.pexels.com/', detail: 'Free stock photos and video.' },
      { label: 'Pixabay', url: 'https://pixabay.com/', detail: 'Royalty-free images and media.' },
      { label: 'Cosmos', url: 'https://www.cosmos.so/', detail: 'Visual discovery and mood boards.' },
    ],
  },
  {
    id: '3d',
    title: '3D & Graphics',
    sites: [
      { label: 'Spline', url: 'https://spline.design/', detail: 'Browser-based 3D design.' },
      { label: 'Three.js Examples', url: 'https://threejs.org/examples/', detail: 'WebGL 3D references and demos.' },
      { label: 'Womp', url: 'https://womp.com/', detail: 'Easy in-browser 3D creation.' },
      { label: 'Pixcap', url: 'https://pixcap.com/', detail: '3D icons, mockups, and scenes.' },
    ],
  },
  {
    id: 'mockups',
    title: 'Mockups',
    sites: [
      { label: 'Shots', url: 'https://shots.so/', detail: 'Device and browser mockups.' },
      { label: 'Mockuuups Studio', url: 'https://mockuuups.studio/', detail: 'Drag-and-drop device mockups.' },
      { label: 'Angle', url: 'https://angle.sh/', detail: '3D device mockup library.' },
      { label: 'Rotato', url: 'https://rotato.app/', detail: 'Animated 3D product mockups.' },
    ],
  },
  {
    id: 'systems',
    title: 'Design Systems',
    sites: [
      { label: 'Impeccable Style', url: 'https://impeccable.style/', detail: 'High-quality style and interface references.' },
      { label: 'Styles Refero', url: 'https://styles.refero.design/', detail: 'Design style references and visual systems.' },
      { label: 'Brandfetch', url: 'https://brandfetch.com/', detail: 'Brand assets, logos, and identity.' },
      { label: 'Design Systems Repo', url: 'https://designsystemsrepo.com/', detail: 'Gallery of public design systems.' },
      { label: 'Startups Gallery', url: 'https://startups.gallery/', detail: 'Top startup product and brand references.' },
    ],
  },
  {
    id: 'components',
    title: 'Components',
    sites: [
      { label: 'Base UI', url: 'https://base-ui.com/', detail: 'Unstyled accessible primitives for custom systems.' },
      { label: 'shadcn/ui', url: 'https://ui.shadcn.com/', detail: 'Composable React components built on Radix and Tailwind.' },
      { label: 'HeroUI', url: 'https://www.heroui.com/', detail: 'Modern React component library and design system.' },
      { label: 'Radix UI', url: 'https://www.radix-ui.com/', detail: 'Accessible low-level UI primitives.' },
      { label: 'React Aria', url: 'https://react-spectrum.adobe.com/react-aria/', detail: 'Accessible behavior primitives from Adobe.' },
      { label: 'Headless UI', url: 'https://headlessui.com/', detail: 'Unstyled accessible components for Tailwind projects.' },
      { label: 'MUI', url: 'https://mui.com/', detail: 'Material-based React component ecosystem.' },
      { label: 'Mantine', url: 'https://mantine.dev/', detail: 'Full-featured React components and hooks.' },
      { label: 'Chakra UI', url: 'https://chakra-ui.com/', detail: 'Accessible React components with theme tokens.' },
      { label: 'Ant Design', url: 'https://ant.design/', detail: 'Enterprise component system and patterns.' },
      { label: 'Ark UI', url: 'https://ark-ui.com/', detail: 'Headless components across modern frameworks.' },
      { label: 'daisyUI', url: 'https://daisyui.com/', detail: 'Tailwind CSS component classes and themes.' },
    ],
  },
  {
    id: 'guidelines',
    title: 'Guidelines & A11y',
    sites: [
      { label: 'Apple HIG', url: 'https://developer.apple.com/design/human-interface-guidelines', detail: 'Apple platform design guidelines.' },
      { label: 'Material Design', url: 'https://m3.material.io/', detail: "Google's Material Design 3." },
      { label: 'Laws of UX', url: 'https://lawsofux.com/', detail: 'UX principles and heuristics.' },
      { label: 'WebAIM Contrast', url: 'https://webaim.org/resources/contrastchecker/', detail: 'Color contrast checker.' },
      { label: 'The A11y Project', url: 'https://www.a11yproject.com/', detail: 'Accessibility checklist and patterns.' },
    ],
  },
  {
    id: 'tools',
    title: 'Tools & Resources',
    sites: [
      { label: 'Toolfolio', url: 'https://toolfolio.io/', detail: 'Design tools, resources, and collections.' },
      { label: 'GetDesign', url: 'https://getdesign.md/', detail: 'Curated design resources.' },
      { label: 'Taste Skill', url: 'https://www.tasteskill.dev/', detail: 'Design taste training and critique references.' },
      { label: 'UI Goodies', url: 'https://www.uigoodies.com/', detail: 'Hand-picked design resources.' },
      { label: 'Sidebar', url: 'https://sidebar.io/', detail: 'Five design links, every day.' },
      { label: 'Superset', url: 'https://github.com/superset-sh/superset', detail: 'Reference implementation for embedded browser workflows.' },
    ],
  },
];

/** Total number of curated references across every category (drives the "All" chip badge). */
export const REFERENCE_TOTAL = REFERENCE_GROUPS.reduce((sum, group) => sum + group.sites.length, 0);

/**
 * Filter the reference catalogue by an active category and a free-text query.
 *
 * `category` is either the sentinel `'all'` or a {@link ReferenceGroup.id}. The
 * query matches a site's label, hostname, or detail, OR the owning group's
 * title (so searching "color" surfaces the whole Color group). Groups with no
 * surviving sites are dropped, so the result is always ready to render as-is.
 */
export function filterReferenceGroups(
  groups: ReferenceGroup[],
  category: string,
  query: string,
  t?: (key: keyof Dict) => string,
): ReferenceGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  return groups
    .filter((group) => category === 'all' || group.id === category)
    .map((group) => {
      if (!needle) return group;
      const groupTitle = localizedReferenceGroupTitle(group, t);
      if (`${group.title} ${groupTitle}`.toLocaleLowerCase().includes(needle)) return group;
      const sites = group.sites.filter(
        (site) =>
          [
            site.label,
            site.detail,
            localizedReferenceSiteDetail(site, t),
            hostnameFromUrl(site.url),
          ].join(' ').toLocaleLowerCase().includes(needle),
      );
      return { ...group, sites };
    })
    .filter((group) => group.sites.length > 0);
}

const ADD_IMAGE_TO_CHAT_MESSAGE = '__bezier_add_image_to_chat__:';
const browserImageHoverScript = (addToChatLabel: string, messagePrefix = ADD_IMAGE_TO_CHAT_MESSAGE) => String.raw`(() => {
  const rootId = '__bezier_image_hover_layer__';
  window.__bezierImageHoverCleanup?.();
  document.getElementById(rootId)?.remove();
  const controller = new AbortController();

  const layer = document.createElement('div');
  layer.id = rootId;
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'fixed',
    zIndex: '2147483646',
    display: 'none',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    padding: '10px',
    // No dim/frost wash over the image — the layer is an invisible flex
    // frame that pins the button to the hovered image's top-right corner.
    background: 'transparent',
    pointerEvents: 'none',
    borderRadius: '6px',
    boxSizing: 'border-box',
  });

  const button = document.createElement('button');
  button.type = 'button';
  const addToChatLabel = ${JSON.stringify(addToChatLabel)};
  button.textContent = addToChatLabel;
  button.setAttribute('aria-label', addToChatLabel);
  Object.assign(button.style, {
    height: '34px',
    padding: '0 14px',
    border: 'none',
    borderRadius: '6px',
    background: 'rgba(24,24,25,.92)',
    color: ${JSON.stringify(messagePrefix === ADD_IMAGE_TO_CHAT_MESSAGE ? '#00ff04' : '#ffffff')},
    boxShadow: '0 8px 24px rgba(0,0,0,.28)',
    font: '600 13px/1 system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    letterSpacing: '0',
    cursor: 'pointer',
    pointerEvents: 'auto',
  });
  layer.appendChild(button);
  document.documentElement.appendChild(layer);

  let activeImage = null;
  const eligibleImage = (node) => {
    const image = node instanceof Element ? node.closest('img') : null;
    if (!(image instanceof HTMLImageElement)) return null;
    const rect = image.getBoundingClientRect();
    if (rect.width < 72 || rect.height < 56 || rect.bottom <= 0 || rect.right <= 0) return null;
    return image;
  };
  const positionLayer = () => {
    if (!activeImage || !activeImage.isConnected) {
      activeImage = null;
      layer.style.display = 'none';
      return;
    }
    const rect = activeImage.getBoundingClientRect();
    if (rect.width < 72 || rect.height < 56 || rect.bottom <= 0 || rect.top >= innerHeight) {
      layer.style.display = 'none';
      return;
    }
    Object.assign(layer.style, {
      display: 'flex',
      left: Math.max(0, rect.left) + 'px',
      top: Math.max(0, rect.top) + 'px',
      width: Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) + 'px',
      height: Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)) + 'px',
    });
  };
  document.addEventListener('pointermove', (event) => {
    if (button.contains(event.target)) return;
    const image = eligibleImage(event.target);
    if (image === activeImage) return;
    activeImage = image;
    positionLayer();
  }, { capture: true, signal: controller.signal });
  // No capture: pointerleave does not bubble, so this fires only when the
  // pointer leaves the document itself. A capturing listener would also fire
  // when the pointer crosses from the image onto the overlay button, hiding
  // the layer and clearing activeImage before the button can be clicked.
  document.addEventListener('pointerleave', () => {
    activeImage = null;
    layer.style.display = 'none';
  }, { signal: controller.signal });
  addEventListener('scroll', positionLayer, { capture: true, signal: controller.signal });
  addEventListener('resize', positionLayer, { capture: true, signal: controller.signal });

  button.addEventListener('click', (event) => {
    if (${JSON.stringify(messagePrefix !== ADD_IMAGE_TO_CHAT_MESSAGE)} && !event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    if (!activeImage) return;
    const rect = activeImage.getBoundingClientRect();
    const payload = {
      x: Math.max(0, rect.left),
      y: Math.max(0, rect.top),
      width: Math.max(1, Math.min(innerWidth, rect.right) - Math.max(0, rect.left)),
      height: Math.max(1, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)),
      alt: activeImage.alt || '',
      src: activeImage.currentSrc || activeImage.src || '',
    };
    layer.style.display = 'none';
    // Let the guest paint the hidden overlay before notifying the host;
    // the host's own rAF wait cannot see guest frames, so capturing too
    // early bakes the dimmed layer and button into the snapshot.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      console.info(${JSON.stringify(messagePrefix)} + JSON.stringify(payload));
    }));
  }, { signal: controller.signal });
  window.__bezierImageHoverCleanup = () => {
    controller.abort();
    layer.remove();
    delete window.__bezierImageHoverCleanup;
  };
  return true;
})()`;

export function DesignBrowserPanel({
  variant = 'workspace',
  workspaceContext,
  onCollectedFile,
  initialIconUrl,
  initialTitle,
  initialUrl,
  navigateRequest,
  attentionRequest,
  projectId,
  resolvedDir,
  onOpenFile,
  onBezierFiles,
  onPageInfoChange,
  onRefreshFiles,
  previewComments = EMPTY_PREVIEW_COMMENTS,
  onSavePreviewComment,
  onRemovePreviewComment,
  onSendBoardCommentAttachments,
  onAddImageToChat,
  onPageSnapshotToast,
  onExtractPage,
  sendDisabled = false,
  browserTabId,
}: DesignBrowserPanelProps) {
  const t = useT();
  const collector = variant === 'collector';
  const collectionBusyRef = useRef(false);
  const extractionBusyRef = useRef(false);
  const [extractingPage, setExtractingPage] = useState(false);
  const desktopHostAvailable = isBezierHostAvailable();
  const initialState = initialBrowserState(initialUrl, initialTitle);
  // `loadUrl` is the navigation target bound to the <webview>/<iframe> `src`.
  // It changes ONLY on user-initiated navigation. `currentUrl` is the committed
  // location shown in the address bar and recorded in history, synced from the
  // webview's own navigation events. They are deliberately separate: if `src`
  // tracked every committed URL, a server redirect (e.g. adding a trailing
  // slash) would mutate `src` mid-load and Electron would abort the in-flight
  // navigation (ERR_ABORTED -3), leaving the page blank.
  const [loadUrl, setLoadUrl] = useState(initialState.url);
  const [currentUrl, setCurrentUrl] = useState(initialState.url);
  const [addressValue, setAddressValue] = useState(initialState.addressValue);
  const [addressEditing, setAddressEditingState] = useState(false);
  const [history, setHistory] = useState<BrowserHistoryEntry[]>(() => loadHistory(projectId));
  const [navigationStack, setNavigationStack] = useState<BrowserNavigationEntry[]>(initialState.navigationStack);
  const [navigationIndex, setNavigationIndex] = useState(initialState.navigationIndex);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [extensionSettingsOpen, setExtensionSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [webviewNode, setWebviewNode] = useState<WebviewElement | null>(null);
  const [viewport, setViewportState] = useState<BrowserViewportId>(() => loadBrowserViewport(projectId));
  const setViewport = useCallback((nextViewport: BrowserViewportId) => {
    saveBrowserViewport(projectId, nextViewport);
    setViewportState(nextViewport);
  }, [projectId]);
  const [activeTool, setActiveTool] = useState<BrowserTool | null>(null);
  const [activeCommentTarget, setActiveCommentTarget] = useState<BrowserElementSnapshot | null>(null);
  const [activePreviewCommentId, setActivePreviewCommentId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [queuedCommentNotes, setQueuedCommentNotes] = useState<string[]>([]);
  const [browserImages, setBrowserImages] = useState<File[]>([]);
  const [browserImagePreviews, setBrowserImagePreviews] = useState<{ file: File; url: string }[]>([]);
  const [browserPreviewIndex, setBrowserPreviewIndex] = useState<number | null>(null);
  const [sendingComment, setSendingComment] = useState(false);
  const [savingDomEdit, setSavingDomEdit] = useState(false);
  const [browserLiveCommentTargets, setBrowserLiveCommentTargets] = useState<Map<string, BrowserElementSnapshot>>(() => new Map());
  const [textDraft, setTextDraft] = useState('');
  const [statusMessage, setStatusMessage] = useState<BrowserStatusMessage | null>(null);
  const [savingActions, setSavingActions] = useState<Record<BrowserSavingAction, boolean>>({
    archive: false,
    screenshot: false,
  });
  const [archiveElapsedSeconds, setArchiveElapsedSeconds] = useState(0);
  const [downloadAttentionNonce, setDownloadAttentionNonce] = useState<number | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const addressEditingRef = useRef(false);
  const addressBlurTimerRef = useRef<number | null>(null);
  const addressSelectFrameRef = useRef<number | null>(null);
  const cancelAddressCallbacks = useCallback(() => {
    if (addressBlurTimerRef.current !== null) window.clearTimeout(addressBlurTimerRef.current);
    if (addressSelectFrameRef.current !== null) window.cancelAnimationFrame(addressSelectFrameRef.current);
    addressBlurTimerRef.current = null;
    addressSelectFrameRef.current = null;
  }, []);
  // The current edit owns its draft immediately, including native callbacks that
  // arrive before React's next effect. A previous blur/select cannot end it.
  const setAddressEditing = useCallback((editing: boolean) => {
    cancelAddressCallbacks();
    addressEditingRef.current = editing;
    setAddressEditingState(editing);
  }, [cancelAddressCallbacks]);
  useEffect(() => cancelAddressCallbacks, [cancelAddressCallbacks]);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const pickerRequestIdRef = useRef(0);
  const restoredIconUrlRef = useRef(initialIconUrl?.trim() ?? '');
  const restoredTitleRef = useRef(initialTitle?.trim() ?? '');
  const navigationStackRef = useRef<BrowserNavigationEntry[]>(initialState.navigationStack);
  const navigationIndexRef = useRef(initialState.navigationIndex);
  const pendingLoadTargetRef = useRef<string | null>(null);
  const lastNavigateRequestNonceRef = useRef<number | null>(null);
  const archiveRunIdRef = useRef(0);
  const archiveRunRef = useRef<{ controller: AbortController; id: number; startedAt: number } | null>(null);
  const pageSnapshotToastRef = useRef(onPageSnapshotToast);
  const browserTabIdRef = useRef(browserTabId ?? '');
  const archiveSaving = savingActions.archive;
  const screenshotSaving = savingActions.screenshot;
  const canGoBack = navigationIndex > 0;
  const canGoForward = navigationIndex >= 0 && navigationIndex < navigationStack.length - 1;

  const setSavingAction = useCallback((action: BrowserSavingAction, saving: boolean) => {
    setSavingActions((current) => (
      current[action] === saving ? current : { ...current, [action]: saving }
    ));
  }, []);

  const cancelPageSnapshot = useCallback(() => {
    archiveRunRef.current?.controller.abort();
  }, []);

  useEffect(() => {
    pageSnapshotToastRef.current = onPageSnapshotToast;
    browserTabIdRef.current = browserTabId ?? '';
  }, [browserTabId, onPageSnapshotToast]);

  const emitPageSnapshotToast = useCallback((event: Omit<BrowserPageSnapshotToastEvent, 'tabId'>) => {
    pageSnapshotToastRef.current?.({
      ...event,
      tabId: browserTabIdRef.current,
    });
  }, []);

  // Publish a handle to this tab's live webview so the chat can read the rendered
  // DOM (brand browser-assist re-extraction). The cross-origin <iframe> fallback
  // can't expose guest DOM, so `isDesktopWebview` gates that path off there.
  useEffect(() => {
    if (!browserTabId) return undefined;
    const handle: BrandBrowserHandle = {
      isDesktopWebview: desktopHostAvailable && Boolean(webviewNode),
      getURL: () => webviewNode?.getURL?.() ?? currentUrl,
      executeJavaScript: (code, gesture) =>
        webviewNode ? webviewNode.executeJavaScript(code, gesture) : null,
      downloadPageSnapshot: () => savePageSnapshot({ openAfterSave: false }),
    };
    registerBrandBrowser(projectId, browserTabId, handle);
    return () => registerBrandBrowser(projectId, browserTabId, null);
  }, [browserTabId, projectId, webviewNode, currentUrl, desktopHostAvailable]);
  const assignWebviewNode = useCallback((node: HTMLWebViewElement | null) => {
    setWebviewNode(node as WebviewElement | null);
  }, []);

  useEffect(() => {
    setViewportState(loadBrowserViewport(projectId));
    setHistory(loadHistory(projectId));
    const nextInitialState = initialBrowserState(initialUrl, initialTitle);
    setLoadUrl(nextInitialState.url);
    setCurrentUrl(nextInitialState.url);
    setAddressValue(nextInitialState.addressValue);
    setAddressEditing(false);
    setNavigationStack(nextInitialState.navigationStack);
    setNavigationIndex(nextInitialState.navigationIndex);
    navigationStackRef.current = nextInitialState.navigationStack;
    navigationIndexRef.current = nextInitialState.navigationIndex;
    pendingLoadTargetRef.current = null;
    if (isHistoryUrl(nextInitialState.url)) {
      commitHistory(
        nextInitialState.url,
        { iconUrl: initialIconUrl, title: initialTitle },
        { countVisit: false },
      );
    }
    // `initial*` props are mount-time tab restore inputs. During normal
    // navigation the parent updates them from onPageInfoChange; that must not
    // reset the live webview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const sync = () => setHistory(loadHistory(projectId));
    window.addEventListener(DESIGN_BROWSER_HISTORY_CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(DESIGN_BROWSER_HISTORY_CHANGED, sync); window.removeEventListener('storage', sync); };
  }, [projectId]);

  useEffect(() => {
    if (!statusMessage) return;
    // Keep the status pinned while the page-snapshot download runs: it can take
    // several seconds, and a 2.6s auto-dismiss would leave the user staring at a
    // disabled Download Page action with no sign it's still working. When saving
    // ends, the effect re-runs and the success/failure message dismisses normally.
    if (archiveSaving) return;
    const hasAction = typeof statusMessage === 'object' && Boolean(statusMessage.actionFileName);
    const timer = window.setTimeout(() => setStatusMessage(null), hasAction ? 8000 : 2600);
    return () => window.clearTimeout(timer);
  }, [statusMessage, archiveSaving]);

  // Latest snapshot-progress publisher, kept in a ref so the 1s ticker effect
  // below can depend only on `archiveSaving`. `emitPageSnapshotToast` and `t`
  // get a fresh identity on every parent render (FileWorkspace passes a new
  // `onPageSnapshotToast` each render), so listing them as effect deps made the
  // effect tear down and re-run every render — and its immediate publish() then
  // set state on each run, re-rendering in a tight loop until React aborted with
  // "Maximum update depth exceeded". Reading the ref sidesteps that, and the
  // single stable interval also stops the parent toast from being replaced ~60×
  // a second (which rendered as overlapping/duplicate snapshot toasts).
  const publishSnapshotProgressRef = useRef<() => void>(() => {});
  publishSnapshotProgressRef.current = () => {
    const run = archiveRunRef.current;
    if (!run) return;
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - run.startedAt) / 1000));
    setArchiveElapsedSeconds(elapsedSeconds);
    emitPageSnapshotToast({
      elapsedSeconds,
      message: t('designBrowser.status.pageSnapshotStarted'),
      onCancel: cancelPageSnapshot,
      status: 'loading',
      ttlMs: 0,
    });
  };

  useEffect(() => {
    if (!archiveSaving || !archiveRunRef.current) return;
    publishSnapshotProgressRef.current();
    const interval = window.setInterval(() => publishSnapshotProgressRef.current(), 1000);
    return () => window.clearInterval(interval);
  }, [archiveSaving]);

  useEffect(() => {
    if (!menuOpen && !suggestionsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const chrome = chromeRef.current;
      if (chrome && event.target instanceof Node && chrome.contains(event.target)) return;
      setMenuOpen(false);
      setSuggestionsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen, suggestionsOpen]);

  const commitHistory = useCallback((url: string, meta: { title?: string; iconUrl?: string } = {}, options: { countVisit?: boolean } = {}) => {
    if (!isHistoryUrl(url)) return;
    const next = ((current: BrowserHistoryEntry[]) => {
      const now = Date.now();
      const existing = current.find((entry) => sameUrl(entry.url, url));
      const nextTitle = meta.title && meta.title.trim()
        ? meta.title.trim()
        : existing?.title || labelFromUrl(url);
      const nextIconUrl = cleanIconUrl(meta.iconUrl) || existing?.iconUrl || faviconUrl(url);
      const visitIncrement = options.countVisit === false ? 0 : 1;
      const entry = existing
        ? {
            ...existing,
            iconUrl: nextIconUrl,
            title: nextTitle,
            lastVisitedAt: visitIncrement > 0 ? now : existing.lastVisitedAt,
            visitCount: existing.visitCount + visitIncrement,
          }
        : { iconUrl: nextIconUrl, title: nextTitle, url, lastVisitedAt: now, visitCount: 1 };
      if (
        existing &&
        existing.title === entry.title &&
        existing.iconUrl === entry.iconUrl &&
        existing.lastVisitedAt === entry.lastVisitedAt &&
        existing.visitCount === entry.visitCount
      ) {
        return current;
      }
      return [entry, ...current.filter((item) => !sameUrl(item.url, url))]
        .slice(0, HISTORY_LIMIT);
    })(loadHistory(projectId));
    saveHistory(projectId, next);
    setHistory(next);
  }, [projectId]);

  const setNavigationState = useCallback((stack: BrowserNavigationEntry[], index: number) => {
    navigationStackRef.current = stack;
    navigationIndexRef.current = index;
    setNavigationStack(stack);
    setNavigationIndex(index);
  }, []);

  const recordNavigation = useCallback((url: string, title?: string, options?: { replacePendingTarget?: boolean }) => {
    if (url !== EMPTY_URL && !isHistoryUrl(url)) return;

    const stack = navigationStackRef.current;
    const index = navigationIndexRef.current;
    const nextTitle = url === EMPTY_URL
      ? browserHomeNavigationEntry().title
      : title && title.trim()
        ? title.trim()
        : labelFromUrl(url);
    const nextEntry: BrowserNavigationEntry = { title: nextTitle, url };
    const updateEntry = (entries: BrowserNavigationEntry[], entryIndex: number) => {
      const existing = entries[entryIndex];
      const next = entries.slice();
      next[entryIndex] = {
        title: nextTitle || existing?.title || labelFromUrl(url),
        url,
      };
      return next;
    };
    const currentEntry = index >= 0 ? stack[index] : undefined;
    const pendingTarget = pendingLoadTargetRef.current;
    const shouldReplacePending =
      Boolean(options?.replacePendingTarget && pendingTarget && currentEntry && sameUrl(currentEntry.url, pendingTarget));

    if (currentEntry && (sameUrl(currentEntry.url, url) || shouldReplacePending)) {
      setNavigationState(updateEntry(stack, index), index);
      if (options?.replacePendingTarget) pendingLoadTargetRef.current = null;
      return;
    }

    const previousIndex = index - 1;
    if (previousIndex >= 0 && sameUrl(stack[previousIndex]?.url ?? '', url)) {
      setNavigationState(updateEntry(stack, previousIndex), previousIndex);
      if (options?.replacePendingTarget) pendingLoadTargetRef.current = null;
      return;
    }

    const nextIndex = index + 1;
    if (nextIndex < stack.length && sameUrl(stack[nextIndex]?.url ?? '', url)) {
      setNavigationState(updateEntry(stack, nextIndex), nextIndex);
      if (options?.replacePendingTarget) pendingLoadTargetRef.current = null;
      return;
    }

    const base = index >= 0 ? stack.slice(0, index + 1) : [];
    const nextStack = [...base, nextEntry].slice(-HISTORY_LIMIT);
    setNavigationState(nextStack, nextStack.length - 1);
    if (options?.replacePendingTarget) pendingLoadTargetRef.current = null;
  }, [setNavigationState]);

  const updateCurrentNavigationTitle = useCallback((title?: string) => {
    const trimmedTitle = title?.trim();
    const index = navigationIndexRef.current;
    if (!trimmedTitle || index < 0) return;
    const stack = navigationStackRef.current;
    const currentEntry = stack[index];
    if (!currentEntry || currentEntry.title === trimmedTitle) return;
    const nextStack = stack.slice();
    nextStack[index] = { ...currentEntry, title: trimmedTitle };
    setNavigationState(nextStack, index);
  }, [setNavigationState]);

  const loadWebviewUrl = useCallback((url: string) => {
    if (!webviewNode) {
      setLoadUrl(url);
      return;
    }
    if (loadUrl === EMPTY_URL) {
      setLoadUrl(url);
      return;
    }
    try {
      const result = webviewNode.loadURL?.(url);
      if (isPromiseLike(result)) {
        void result.catch((error) => {
          if (isBenignWebviewLoadAbort(error)) return;
          setLoadUrl(url);
        });
      }
      else if (!webviewNode.loadURL) setLoadUrl(url);
    } catch (error) {
      if (isBenignWebviewLoadAbort(error)) return;
      setLoadUrl(url);
    }
  }, [loadUrl, webviewNode]);

  const navigateTo = useCallback((rawAddress: string) => {
    const nextUrl = normalizeBrowserAddress(rawAddress);
    warmBrowserOrigin(nextUrl);
    pendingLoadTargetRef.current = isHistoryUrl(nextUrl) ? nextUrl : null;
    setCurrentUrl(nextUrl);
    setAddressValue(nextUrl === EMPTY_URL ? '' : nextUrl);
    setAddressEditing(false);
    setSuggestionsOpen(false);
    setMenuOpen(false);
    if (isHistoryUrl(nextUrl)) {
      commitHistory(nextUrl, undefined, { countVisit: true });
      recordNavigation(nextUrl);
    } else if (nextUrl === EMPTY_URL) {
      setLoadUrl(EMPTY_URL);
      recordNavigation(nextUrl);
    }
    if (nextUrl !== EMPTY_URL) loadWebviewUrl(nextUrl);
  }, [commitHistory, loadWebviewUrl, recordNavigation, setAddressEditing]);

  useEffect(() => {
    if (!navigateRequest) return;
    if (lastNavigateRequestNonceRef.current === navigateRequest.nonce) return;
    lastNavigateRequestNonceRef.current = navigateRequest.nonce;
    navigateTo(navigateRequest.url);
  }, [navigateRequest, navigateTo]);

  useEffect(() => {
    if (!attentionRequest || attentionRequest.action !== 'download-page') return;
    setSuggestionsOpen(false);
    setMenuOpen(true);
    setDownloadAttentionNonce(attentionRequest.nonce);
    setStatusMessage(null);
  }, [attentionRequest]);

  const syncFromFallbackFrame = useCallback((frame: HTMLIFrameElement | null) => {
    if (!frame || loadUrl === EMPTY_URL) return;
    let nextUrl = loadUrl;
    let nextTitle = '';
    try {
      nextUrl = frame.contentWindow?.location.href || loadUrl;
      nextTitle = frame.contentDocument?.title?.trim() || '';
    } catch {
      // Cross-origin iframe content is expected to reject here. Keep the URL
      // context and let the display fall back to labelFromUrl().
    }
    setCurrentUrl(nextUrl);
    if (!addressEditingRef.current) setAddressValue(nextUrl);
    commitHistory(nextUrl, { title: nextTitle }, { countVisit: false });
    recordNavigation(nextUrl, nextTitle, { replacePendingTarget: true });
    updateCurrentNavigationTitle(nextTitle);
    setIsLoading(false);
  }, [commitHistory, loadUrl, recordNavigation, updateCurrentNavigationTitle]);

  const updateLoadingState = useCallback((node: WebviewElement | null = webviewNode) => {
    if (!node) {
      setIsLoading(false);
      return;
    }
    // Electron's <webview> throws ("The WebView must be attached to the DOM and
    // the dom-ready event emitted before this method can be called") when
    // isLoading runs before the guest attaches. The mount effect calls this
    // immediately, so guard like safeGetWebviewUrl/Title do.
    try {
      setIsLoading(Boolean(node.isLoading()));
    } catch {
      // Pre-dom-ready: keep the existing loading state.
    }
  }, [webviewNode]);

  useEffect(() => {
    const node = webviewNode;
    if (!node) return;

    const syncFromWebview = (
      url?: string,
      title?: string,
      options?: { iconUrl?: string; recordNavigation?: boolean; recordVisit?: boolean },
    ) => {
      const nextUrl = url || safeGetWebviewUrl(node);
      if (nextUrl) {
        setCurrentUrl(nextUrl);
        if (!addressEditingRef.current) {
          setAddressValue(nextUrl === EMPTY_URL ? '' : nextUrl);
        }
      }
      const nextTitle = title || safeGetWebviewTitle(node);
      if (nextUrl) {
        commitHistory(nextUrl, { iconUrl: options?.iconUrl, title: nextTitle }, { countVisit: options?.recordVisit === true });
        if (options?.recordNavigation !== false) {
          recordNavigation(nextUrl, nextTitle, { replacePendingTarget: true });
        } else {
          updateCurrentNavigationTitle(nextTitle);
        }
      }
      updateLoadingState(node);
    };
    const onStart = () => {
      setIsLoading(true);
      updateLoadingState(node);
    };
    const onStop = () => {
      setIsLoading(false);
      syncFromWebview(undefined, undefined, { recordVisit: false });
    };
    const onNavigate = (event: Event) => {
      const navigationEvent = event as WebviewNavigationEvent;
      if (navigationEvent.isMainFrame === false) return;
      const pendingTarget = pendingLoadTargetRef.current;
      const nextUrl = navigationEvent.url || safeGetWebviewUrl(node);
      const isPendingCommit = Boolean(pendingTarget && nextUrl && sameUrl(pendingTarget, nextUrl));
      syncFromWebview(nextUrl, undefined, { recordVisit: !isPendingCommit });
    };
    const onTitle = (event: Event) => {
      const titleEvent = event as WebviewTitleEvent;
      syncFromWebview(undefined, titleEvent.title, { recordNavigation: false, recordVisit: false });
    };
    const onFavicon = (event: Event) => {
      const faviconEvent = event as WebviewFaviconEvent;
      const iconUrl = faviconEvent.favicons?.find(isHttpLikeUrl);
      if (!iconUrl) return;
      syncFromWebview(undefined, undefined, { iconUrl, recordNavigation: false, recordVisit: false });
    };
    const onFail = (event: Event) => {
      const navigationEvent = event as WebviewNavigationEvent;
      if (navigationEvent.isMainFrame === false) return;
      setIsLoading(false);
      pendingLoadTargetRef.current = null;
      updateLoadingState(node);
    };

    node.addEventListener('did-start-loading', onStart);
    node.addEventListener('did-stop-loading', onStop);
    node.addEventListener('did-navigate', onNavigate);
    node.addEventListener('did-navigate-in-page', onNavigate);
    node.addEventListener('page-title-updated', onTitle);
    node.addEventListener('page-favicon-updated', onFavicon);
    node.addEventListener('did-fail-load', onFail);
    node.addEventListener('dom-ready', onStop);
    updateLoadingState(node);
    return () => {
      node.removeEventListener('did-start-loading', onStart);
      node.removeEventListener('did-stop-loading', onStop);
      node.removeEventListener('did-navigate', onNavigate);
      node.removeEventListener('did-navigate-in-page', onNavigate);
      node.removeEventListener('page-title-updated', onTitle);
      node.removeEventListener('page-favicon-updated', onFavicon);
      node.removeEventListener('did-fail-load', onFail);
      node.removeEventListener('dom-ready', onStop);
    };
  }, [commitHistory, recordNavigation, updateCurrentNavigationTitle, updateLoadingState, webviewNode]);

  const suggestions = useMemo(() => {
    const query = addressValue.trim().toLocaleLowerCase();
    const showDefaultSuggestions = addressEditing && currentUrl !== EMPTY_URL && sameUrl(addressValue.trim(), currentUrl);
    const referenceSuggestions = REFERENCE_GROUPS.flatMap((group) =>
      group.sites.map((site) => ({
        detail: `${localizedReferenceGroupTitle(group, t)} - ${localizedReferenceSiteDetail(site, t)}`,
        id: `site:${site.url}`,
        iconUrl: referenceIconUrl(site.url),
        label: site.label,
        type: 'reference' as const,
        typeLabel: t('designBrowser.suggestion.reference'),
        url: site.url,
      })),
    );
    const historySuggestions = history.slice(0, HISTORY_SUGGESTION_LIMIT).map((entry) => ({
      detail: entry.url,
      id: `history:${entry.url}`,
      iconUrl: entry.iconUrl || faviconUrl(entry.url),
      label: entry.title || labelFromUrl(entry.url),
      type: 'history' as const,
      typeLabel: t('designBrowser.suggestion.history'),
      url: entry.url,
    }));
    const all = [...historySuggestions, ...referenceSuggestions];
    if (!query || showDefaultSuggestions) return all;
    return all
      .filter((item) =>
        `${item.label} ${item.url} ${item.detail}`.toLocaleLowerCase().includes(query),
      )
      .slice(0, HISTORY_SUGGESTION_LIMIT + referenceSuggestions.length);
  }, [addressEditing, addressValue, currentUrl, history, t]);

  const pageHistoryEntry = history.find((entry) => sameUrl(entry.url, currentUrl));
  const pageTitle = pageHistoryEntry?.title || restoredTitleRef.current || labelFromUrl(currentUrl);
  const pageIconUrl = pageHistoryEntry?.iconUrl || restoredIconUrlRef.current || faviconUrl(currentUrl);
  const addressDisplayParts = addressEditing
    ? { url: '' }
    : formatAddressDisplayParts(currentUrl, pageTitle);
  const shownAddressValue = addressEditing ? addressValue : '';
  // Drive the start-page/webview branch off the load target, not the committed
  // URL, so a transient about:blank navigation event can't unmount the webview.
  const isBlank = loadUrl === EMPTY_URL;
  const browserFilePath = isBlank ? browserCommentFilePath(EMPTY_URL) : browserCommentFilePath(currentUrl, resolvedDir);
  const editableProjectHtml = !isBlank && isProjectHtmlBrowserUrl(currentUrl, resolvedDir);
  const visibleComments = useMemo(
    () => previewComments
      .filter((comment) => comment.filePath === browserFilePath && comment.status === 'open')
      .sort((left, right) => left.createdAt - right.createdAt),
    [browserFilePath, previewComments],
  );
  const activeSavedComment = activePreviewCommentId
    ? visibleComments.find((comment) => comment.id === activePreviewCommentId) ?? null
    : null;

  useEffect(() => {
    const node = webviewNode;
    if (!node || isBlank) {
      setBrowserLiveCommentTargets((current) => (current.size > 0 ? new Map() : current));
      return;
    }

    const activeTarget = activeCommentTarget
      ? [{
          elementId: activeCommentTarget.elementId,
          key: 'active',
          selector: activeCommentTarget.selector,
        }]
      : [];
    const targets = activeTarget.filter((target) => target.elementId && target.selector);
    if (targets.length === 0) {
      setBrowserLiveCommentTargets((current) => (current.size > 0 ? new Map() : current));
      return;
    }

    let cancelled = false;
    let running = false;
    const refresh = async () => {
      if (cancelled || running) return;
      running = true;
      try {
        const result = await node.executeJavaScript<unknown>(
          browserMeasureTargetsScript(browserFilePath, targets),
          true,
        );
        if (cancelled || !Array.isArray(result)) return;
        const next = new Map<string, BrowserElementSnapshot>();
        for (const item of result) {
          if (!item || typeof item !== 'object') continue;
          const key = String((item as { key?: unknown }).key || '');
          if (!key) continue;
          const snapshot = browserSnapshotFromUnknown(item, browserFilePath);
          if (snapshot) next.set(key, snapshot);
        }
        setBrowserLiveCommentTargets((current) => (
          browserSnapshotMapsEqual(current, next) ? current : next
        ));
        const activeSnapshot = next.get('active');
        if (activeSnapshot) {
          setActiveCommentTarget((current) => (
            current && current.selector === activeSnapshot.selector && !browserSnapshotsEqual(current, activeSnapshot)
              ? { ...current, ...activeSnapshot }
              : current
          ));
          setTextDraft((current) => (
            activeTool === 'inspect' || activeTool === 'edit'
              ? current
              : activeSnapshot.text
          ));
        }
      } catch {
        // Cross-origin navigations, transient loads, and detached webviews can
        // reject executeJavaScript. Keep the saved positions until the next tick.
      } finally {
        running = false;
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeCommentTarget?.elementId, activeCommentTarget?.selector, activeTool, browserFilePath, isBlank, webviewNode]);

  useEffect(() => {
    const next = browserImages.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setBrowserImagePreviews(next);
    return () => {
      next.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [browserImages]);

  useEffect(() => {
    onPageInfoChange?.({
      title: isBlank ? 'Browser' : pageTitle,
      url: isBlank ? '' : currentUrl,
      ...(!isBlank && pageIconUrl ? { iconUrl: pageIconUrl } : {}),
    });
  }, [currentUrl, isBlank, onPageInfoChange, pageIconUrl, pageTitle]);

  useEffect(() => {
    pickerRequestIdRef.current += 1;
    setActiveTool(null);
    setActiveCommentTarget(null);
    setActivePreviewCommentId(null);
    setCommentDraft('');
    setQueuedCommentNotes([]);
    setBrowserImages([]);
    setBrowserPreviewIndex(null);
    setTextDraft('');
    void cancelBrowserPicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserFilePath]);

  async function handleAddressSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigateTo(addressValue);
    addressInputRef.current?.blur();
  }

  async function copyCurrentUrl() {
    const text = isBlank ? '' : currentUrl;
    if (!text) {
      setStatusMessage(t('designBrowser.status.noUrlToCopy'));
      return;
    }
    await copyText(text);
    setStatusMessage(t('designBrowser.status.urlCopied'));
    setMenuOpen(false);
  }

  async function openCurrentExternally() {
    if (isBlank || !isHttpLikeUrl(currentUrl)) {
      setStatusMessage(t('designBrowser.status.openHttpFirst'));
      return;
    }
    await openExternalUrl(currentUrl);
    setMenuOpen(false);
  }

  async function takeScreenshot() {
    if (!webviewNode || isBlank) {
      setStatusMessage(t('designBrowser.status.openBeforeScreenshot'));
      return;
    }
    setSavingAction('screenshot', true);
    // Close the dropdown first so it cannot appear in a host compositor capture
    // (which screenshots the on-screen window region, not the guest surface).
    setMenuOpen(false);
    try {
      // Let the dropdown unmount + repaint before the compositor capture.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const dataUrl = await captureBrowserPageDataUrl();
      if (!dataUrl) throw new Error(t('designBrowser.status.screenshotFailed'));
      // Put the capture on the clipboard first so it is paste-ready (e.g. into
      // the chat composer) the instant it is taken; the project file is the
      // durable artifact, the clipboard is the fast path.
      const copied = collector ? false : await copyImageToClipboard(dataUrl);
      const base64 = dataUrl.split(',', 2)[1] ?? '';
      const file = await writeProjectBase64File(
        projectId,
        `${collector ? `${PROJECT_LAYOUT.collected}/` : `${PROJECT_LAYOUT.uploads}/`}${browserFileName('browser-capture', currentUrl, 'png')}`,
        base64,
        workspaceContext,
      );
      if (!file) throw new Error(t('designBrowser.status.screenshotFailed'));
      await onCollectedFile?.(file, { url: currentUrl, title: pageTitle, capturedAt: Date.now() });
      await onRefreshFiles();
      // Stay on the browser so the confirmation toast is visible and the page
      // remains in view; the capture is reachable from Design Files. Show
      // whether it reached the clipboard so the user knows it is paste-ready.
      setStatusMessage(
        copied
          ? t('fileViewer.screenshotCopied')
          : t('designBrowser.status.screenshotSaved'),
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t('designBrowser.status.screenshotFailed'));
    } finally {
      setSavingAction('screenshot', false);
      setMenuOpen(false);
    }
  }

  // Capture the live page as a PNG data URL. Prefers the desktop compositor
  // screenshot of the webview's on-screen region: the embedded <webview> guest
  // WebContents' own capturePage() frequently returns an all-black frame (its
  // GPU surface is not available to that capture path), whereas the host
  // window's composited surface clipped to the webview rect yields the real
  // page pixels the user sees — including authenticated content, since it is
  // the same logged-in session. Falls back to the guest capturePage() only when
  // no desktop host is present.
  async function captureBrowserPageDataUrl(): Promise<string | null> {
    const node = webviewNode;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const hostSnap = await captureHostRegionSnapshot({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
    if (hostSnap) return hostSnap.dataUrl;
    try {
      const image = await node.capturePage();
      return image.toDataURL();
    } catch {
      return null;
    }
  }


  const addBrowserImageToChat = useCallback(async (payload: {
    alt?: string;
    height: number;
    src?: string;
    width: number;
    x: number;
    y: number;
  }) => {
    const node = webviewNode;
    if (!node || (!onAddImageToChat && !onCollectedFile)) return;
    const frame = node.getBoundingClientRect();
    const left = Math.max(frame.left, frame.left + payload.x);
    const top = Math.max(frame.top, frame.top + payload.y);
    const right = Math.min(frame.right, frame.left + payload.x + payload.width);
    const bottom = Math.min(frame.bottom, frame.top + payload.y + payload.height);
    if (right <= left || bottom <= top) return;

    if (collector && collectionBusyRef.current) return;
    if (collector) collectionBusyRef.current = true;

    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      let snapshot = await captureHostRegionSnapshot({
        left,
        top,
        width: right - left,
        height: bottom - top,
      });
      if (!snapshot) {
        // Host compositor region grab unavailable (returns null on some
        // setups even when the full-frame grab works). Fall back to the
        // guest's own capturePage() and crop to the image's rect — the same
        // guest fallback captureBrowserSnapshot() uses, so the "添加到对话"
        // path is as robust as the full-frame capture.
        try {
          const guestUrl = (await node.capturePage()).toDataURL();
          const dpr = window.devicePixelRatio || 1;
          snapshot = await cropDataUrl(
            guestUrl,
            (left - frame.left) * dpr,
            (top - frame.top) * dpr,
            (right - left) * dpr,
            (bottom - top) * dpr,
          );
        } catch {
          snapshot = null;
        }
      }
      if (!snapshot) throw new Error(t('designBrowser.status.screenshotFailed'));

      const base64 = snapshot.dataUrl.split(',', 2)[1] ?? '';
      const file = await writeProjectBase64File(
        projectId,
        `${collector ? `${PROJECT_LAYOUT.collected}/` : `${PROJECT_LAYOUT.uploads}/`}${browserFileName(collector ? 'image-capture' : 'chat-image', currentUrl, 'png')}`,
        base64,
        workspaceContext,
      );
      if (!file) throw new Error(t('designBrowser.status.screenshotFailed'));
      await onCollectedFile?.(file, { url: currentUrl, title: payload.alt || pageTitle, imageUrl: payload.src, capturedAt: Date.now() });
      await onRefreshFiles();
      await onAddImageToChat?.({
        path: file.path || file.name,
        name: payload.alt?.trim() || file.name.split('/').pop() || file.name,
        kind: 'image',
        size: file.size,
      });
      setStatusMessage(collector ? t('designBrowser.status.collectedSnapshot') : t('designBrowser.status.imageAddedToChat'));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t('designBrowser.status.screenshotFailed'));
    } finally {
      if (collector) collectionBusyRef.current = false;
    }
  }, [collector, currentUrl, pageTitle, onCollectedFile, onAddImageToChat, onRefreshFiles, projectId, t, webviewNode, workspaceContext]);

  const resourcePlugin = useBrowserResourcePlugin({
    node: webviewNode, projectId, tabId: browserTabId, workspaceContext,
    available: desktopHostAvailable && !isBlank,
  });
  const capturePreferences = useBrowserPreferences();
  const overlaysEnabled = capturePreferences.ready && !capturePreferences.error && capturePreferences.capture.enabled;
  const selectionOverlayEnabled = overlaysEnabled && capturePreferences.capture.text;
  const imageOverlayEnabled = overlaysEnabled && capturePreferences.capture.images;
  const assetCapture = useBrowserAssetCapture({
    node: webviewNode, currentUrl, projectId, workspaceContext,
    enabled: !isBlank && !activeTool,
    selectionOverlayEnabled, imageOverlayEnabled,
    onNotice: setStatusMessage,
    onAddImageToChat: !collector && onAddImageToChat ? image => { void addBrowserImageToChat(image); } : undefined,
  });

  useEffect(() => {
    const node = webviewNode;
    // Current hosts use the shared host-owned capture toolbar. Keep the legacy
    // screenshot affordance only for older hosts without native image reading.
    if (!node || collector || !onAddImageToChat || isBlank || activeTool || !imageOverlayEnabled || getBezierHost()?.browser.readImage) return;
    // A third-party page's arbitrary console messages must not trigger capture.
    const messagePrefix = collector ? `${ADD_IMAGE_TO_CHAT_MESSAGE}${crypto.randomUUID()}:` : ADD_IMAGE_TO_CHAT_MESSAGE;

    const injectHoverLayer = () => {
      // executeJavaScript throws synchronously until the webview emits
      // dom-ready; the dom-ready/did-stop-loading listeners re-inject then.
      try {
        void node.executeJavaScript(
          browserImageHoverScript(collector ? t('designBrowser.collectImageButton') : t('designBrowser.addImageToChatButton'), messagePrefix),
          true,
        ).catch(() => undefined);
      } catch {
        // Webview not attached/ready yet.
      }
    };
    const onConsoleMessage = (event: Event) => {
      const message = (event as WebviewConsoleMessageEvent).message ?? '';
      if (!message.startsWith(messagePrefix)) return;
      try {
        const payload = JSON.parse(message.slice(messagePrefix.length)) as {
          alt?: string;
          height?: number;
          src?: string;
          width?: number;
          x?: number;
          y?: number;
        };
        if (
          !Number.isFinite(payload.x) || !Number.isFinite(payload.y) ||
          !Number.isFinite(payload.width) || !Number.isFinite(payload.height) ||
          Number(payload.width) <= 0 || Number(payload.height) <= 0
        ) return;
        void addBrowserImageToChat({
          alt: payload.alt,
          height: Number(payload.height),
          src: payload.src,
          width: Number(payload.width),
          x: Number(payload.x),
          y: Number(payload.y),
        });
      } catch {
        // Ignore unrelated or malformed guest console messages.
      }
    };

    node.addEventListener('dom-ready', injectHoverLayer);
    node.addEventListener('did-stop-loading', injectHoverLayer);
    node.addEventListener('console-message', onConsoleMessage);
    injectHoverLayer();
    return () => {
      node.removeEventListener('dom-ready', injectHoverLayer);
      node.removeEventListener('did-stop-loading', injectHoverLayer);
      node.removeEventListener('console-message', onConsoleMessage);
      try { void node.executeJavaScript('window.__bezierImageHoverCleanup?.()').catch(() => undefined); } catch { /* Guest closed. */ }
    };
  }, [activeTool, imageOverlayEnabled, addBrowserImageToChat, collector, isBlank, onAddImageToChat, onCollectedFile, t, webviewNode]);

  async function savePageSnapshot(
    options: { openAfterSave?: boolean; timeoutMs?: number } = {},
  ): Promise<BrandBrowserPageSnapshotResult> {
    if (!webviewNode || isBlank) {
      const message = t('designBrowser.status.openBeforeDownload');
      setStatusMessage(message);
      return { ok: false, message };
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = options.timeoutMs
      ? window.setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs)
      : undefined;
    const run = {
      controller,
      id: archiveRunIdRef.current + 1,
      startedAt: Date.now(),
    };
    archiveRunIdRef.current = run.id;
    archiveRunRef.current = run;
    setArchiveElapsedSeconds(0);
    setSavingAction('archive', true);
    setDownloadAttentionNonce(null);
    setMenuOpen(false);
    // A page that never finishes loading (perpetual spinner) leaves the
    // capture waiting forever. Halt the pending load first so we snapshot the
    // DOM that already rendered instead of blocking on a load that may never
    // settle — what the user would otherwise do by hand via the Stop button.
    stopLoading();
    setStatusMessage({
      message: t('designBrowser.status.pageSnapshotStarted'),
      source: 'page-snapshot',
    });
    try {
      const capture = await abortablePageSnapshotPromise(
        webviewNode.executeJavaScript<BrowserPageArchiveCapture>(
          BROWSER_CAPTURE_PAGE_ARCHIVE_SCRIPT,
          true,
        ),
        controller.signal,
      );
      if (!isBrowserPageArchiveCapture(capture)) {
        throw new Error(t('designBrowser.status.pageSnapshotUnsupported'));
      }
      const dir = browserPageArchiveDir(currentUrl);
      const htmlFile = `${dir}/page.html`;
      const cssFile = `${dir}/styles.css`;
      const manifestFile = `${dir}/manifest.json`;
      const htmlSaved = await abortablePageSnapshotPromise(
        writeProjectTextFile(projectId, htmlFile, capture.html, undefined, workspaceContext),
        controller.signal,
      );
      if (!htmlSaved) throw new Error(t('designBrowser.status.pageSnapshotFailed'));
      const cssSaved = await abortablePageSnapshotPromise(
        writeProjectTextFile(projectId, cssFile, capture.css ?? '', undefined, workspaceContext),
        controller.signal,
      );
      if (!cssSaved) throw new Error(t('designBrowser.status.pageSnapshotFailed'));

      // The snapshot's only consumer is design-system extraction, which reads
      // back nothing but page.html + styles.css (see ProjectView's
      // readLocalBrowserPageArchiveSnapshot → extract-from-html, which POSTs
      // only { html, css, baseUrl }). The daemon then harvests logos/fonts
      // itself, server-side, from refs inside that HTML/CSS. Downloading the
      // page's images/fonts/scripts/video here added nothing extraction reads
      // yet cost a 12s+ fan-out, so we persist the two text files and stop.
      const manifest: BrowserPageArchiveManifest = {
        schema: BROWSER_PAGE_ARCHIVE_SCHEMA,
        capturedAt: Date.now(),
        title: capture.title || pageTitle,
        url: capture.url || currentUrl,
        baseUrl: capture.url || currentUrl,
        htmlFile,
        cssFile,
        manifestFile,
        resources: [],
      };
      const manifestText = JSON.stringify(manifest, null, 2);
      const savedManifest = await abortablePageSnapshotPromise(
        writeProjectTextFile(projectId, manifestFile, manifestText, undefined, workspaceContext),
        controller.signal,
      );
      const savedIndex = await abortablePageSnapshotPromise(
        writeProjectTextFile(projectId, BROWSER_PAGE_ARCHIVE_INDEX_FILE, manifestText, undefined, workspaceContext),
        controller.signal,
      );
      if (!savedManifest || !savedIndex) throw new Error(t('designBrowser.status.pageSnapshotFailed'));
      await abortablePageSnapshotPromise(Promise.resolve(onRefreshFiles()), controller.signal);
      if (options.openAfterSave !== false) onOpenFile(manifestFile);
      const message = t('designBrowser.status.pageSnapshotSaved');
      const elapsedSeconds = pageSnapshotRunElapsedSeconds(run);
      const canBezierFiles = Boolean(onBezierFiles);
      setStatusMessage({
        actionFileName: manifestFile,
        actionLabel: canBezierFiles
          ? t('designBrowser.status.viewDesignFiles')
          : t('workspace.designFiles'),
        actionTarget: canBezierFiles ? 'design-files' : 'file',
        message,
        source: 'page-snapshot',
      });
      emitPageSnapshotToast({
        actionFileName: manifestFile,
        actionLabel: t('designBrowser.status.viewDesignFiles'),
        actionTarget: 'design-files',
        elapsedSeconds,
        message,
        status: 'success',
        ttlMs: 8000,
      });
      return {
        ok: true,
        baseUrl: manifest.baseUrl,
        cssFile,
        htmlFile,
        indexFile: BROWSER_PAGE_ARCHIVE_INDEX_FILE,
        manifestFile,
        message,
      };
    } catch (error) {
      const canceled = isPageSnapshotAbortError(error) || controller.signal.aborted;
      const userCanceled = canceled && !timedOut;
      const message = userCanceled
        ? t('designs.status.canceled')
        : error instanceof Error ? error.message : t('designBrowser.status.pageSnapshotFailed');
      const elapsedSeconds = pageSnapshotRunElapsedSeconds(run);
      setStatusMessage({
        message,
        source: 'page-snapshot',
      });
      emitPageSnapshotToast({
        elapsedSeconds,
        message,
        status: userCanceled ? 'canceled' : 'error',
        ttlMs: userCanceled ? 3000 : 8000,
      });
      return { ok: false, canceled: userCanceled, message };
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (archiveRunRef.current?.id === run.id) {
        archiveRunRef.current = null;
        setSavingAction('archive', false);
        setMenuOpen(false);
      }
    }
  }

  async function extractPage() {
    if (!onExtractPage || sendDisabled || extractionBusyRef.current || archiveSaving || !canExtractBrowserPage(currentUrl)) return;
    extractionBusyRef.current = true;
    setExtractingPage(true);
    // Freeze the target before awaits: navigation must never retarget this task.
    const request: BrowserPageExtractionRequest = { url: currentUrl, title: pageTitle, tabId: browserTabId };
    try {
      if (webviewNode && typeof webviewNode.executeJavaScript === 'function') {
        const snapshot = await savePageSnapshot({ openAfterSave: false, timeoutMs: EXTRACTION_CAPTURE_TIMEOUT_MS });
        if (snapshot.canceled) return;
        if (snapshot.ok && snapshot.baseUrl === request.url) request.snapshot = snapshot;
      }
      setStatusMessage(t('designBrowser.extractPageBusy'));
      await onExtractPage(request);
      setStatusMessage(t('designBrowser.extractPageSent'));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t('designBrowser.extractPageFailed'));
    } finally {
      extractionBusyRef.current = false;
      setExtractingPage(false);
    }
  }

  async function clearCookies(storage: boolean) {
    if (!desktopHostAvailable) {
      setStatusMessage(t('designBrowser.status.desktopDataUnavailable'));
      return;
    }
    const result = await clearHostBrowserData({ cookies: true, storage });
    setStatusMessage(
      result.ok
        ? t('designBrowser.status.browserDataCleared')
        : 'reason' in result
          ? result.reason
          : t('designBrowser.status.browserDataClearFailed'),
    );
    if (storage) {
      setHistory([]);
      setLoadUrl(EMPTY_URL);
      setCurrentUrl(EMPTY_URL);
      setAddressValue('');
      setAddressEditing(false);
      setNavigationState([browserHomeNavigationEntry()], 0);
      pendingLoadTargetRef.current = null;
      saveHistory(projectId, []);
    }
    setMenuOpen(false);
  }

  function clearHistoryOnly() {
    setHistory([]);
    saveHistory(projectId, []);
    setStatusMessage(t('designBrowser.status.historyCleared'));
    setMenuOpen(false);
  }

  function navigateHistoryBy(delta: -1 | 1) {
    const targetIndex = navigationIndex + delta;
    const entry = navigationStack[targetIndex];
    if (!entry) return;
    pendingLoadTargetRef.current = null;
    setNavigationState(navigationStack.slice(), targetIndex);
    setCurrentUrl(entry.url);
    setAddressValue(entry.url === EMPTY_URL ? '' : entry.url);
    setAddressEditing(false);
    setSuggestionsOpen(false);
    setMenuOpen(false);
    if (entry.url === EMPTY_URL) {
      pendingLoadTargetRef.current = null;
      setLoadUrl(EMPTY_URL);
      return;
    }
    if (webviewNode && canUseNativeHistoryNavigation(webviewNode, delta)) {
      if (delta < 0) webviewNode.goBack();
      else webviewNode.goForward();
    } else {
      loadWebviewUrl(entry.url);
    }
  }

  function reload(hard = false) {
    if (isBlank) return;
    if (webviewNode) {
      // Reload is enabled as soon as a URL is set, which can be before the
      // <webview> emits dom-ready; reload()/reloadIgnoringCache() throw in that
      // window. Guard so an early click can't crash the panel.
      try {
        if (hard) webviewNode.reloadIgnoringCache();
        else webviewNode.reload();
      } catch {
        setLoadUrl((url) => `${url}${url.includes('?') ? '&' : '?'}odReload=${Date.now()}`);
      }
    } else {
      setLoadUrl((url) => `${url}${url.includes('?') ? '&' : '?'}odReload=${Date.now()}`);
    }
    setMenuOpen(false);
  }

  // Halt any pending navigation/load, the way Chrome's address-bar X does. A
  // page stuck mid-load (perpetual spinner) otherwise blocks the user from
  // acting on what already rendered — and can wedge the snapshot capture below.
  function stopLoading() {
    if (!webviewNode) return;
    try {
      // <webview>.stop() throws if the guest hasn't attached yet; guard like
      // reload() does.
      webviewNode.stop?.();
    } catch {
      // Pre-dom-ready: nothing to stop.
    }
    setIsLoading(false);
  }

  async function cancelBrowserPicker() {
    pickerRequestIdRef.current += 1;
    try {
      await webviewNode?.executeJavaScript(BROWSER_CANCEL_PICKER_SCRIPT, true);
    } catch {
      // The picker script only exists after a page is loaded; ignore misses.
    }
  }

  function clearBrowserTool() {
    void cancelBrowserPicker();
    setActiveTool(null);
    setActiveCommentTarget(null);
    setActivePreviewCommentId(null);
    setCommentDraft('');
    setQueuedCommentNotes([]);
    setBrowserImages([]);
    setBrowserPreviewIndex(null);
    setTextDraft('');
  }

  async function pickBrowserElement(tool: BrowserTool) {
    if (isBlank || !webviewNode) {
      setStatusMessage(t('designBrowser.status.openPageBeforeTools'));
      return;
    }
    const requestId = pickerRequestIdRef.current + 1;
    pickerRequestIdRef.current = requestId;
    setActiveTool(tool);
    setActiveCommentTarget(null);
    setActivePreviewCommentId(null);
    setCommentDraft('');
    setQueuedCommentNotes([]);
    setBrowserImages([]);
    setBrowserPreviewIndex(null);
    setTextDraft('');
    setMenuOpen(false);
    setStatusMessage(
      tool === 'comment'
        ? t('designBrowser.status.clickElementToComment')
        : t('designBrowser.status.clickElementToTune'),
    );
    try {
      await webviewNode.executeJavaScript(BROWSER_CANCEL_PICKER_SCRIPT, true);
      const result = await webviewNode.executeJavaScript<unknown>(
        browserElementPickerScript(browserFilePath),
        true,
      );
      if (pickerRequestIdRef.current !== requestId) return;
      const snapshot = browserSnapshotFromUnknown(result, browserFilePath);
      if (!snapshot) {
        setStatusMessage(t('designBrowser.status.noElementSelected'));
        setActiveTool(null);
        return;
      }
      setActiveCommentTarget(snapshot);
      setTextDraft(snapshot.text);
      setActiveTool(tool);
      setStatusMessage(
        tool === 'comment'
          ? t('designBrowser.status.addBrowserComment')
          : editableProjectHtml
            ? t('designBrowser.status.tuneElementThenSaveHtml')
            : t('designBrowser.status.tuneLiveOnly'),
      );
    } catch (error) {
      if (pickerRequestIdRef.current !== requestId) return;
      setStatusMessage(error instanceof Error ? error.message : t('designBrowser.status.pickerFailed'));
      setActiveTool(null);
    }
  }

  function toggleBrowserTool(tool: BrowserTool) {
    if (activeTool === tool) {
      clearBrowserTool();
      return;
    }
    void pickBrowserElement(tool);
  }

  function updateActiveTargetStyle(prop: keyof PreviewAnnotationStyle, value: string) {
    setActiveCommentTarget((current) => {
      if (!current) return current;
      const style = { ...(current.style ?? {}) };
      if (prop === 'paddingTop') {
        style.paddingTop = value;
        style.paddingRight = value;
        style.paddingBottom = value;
        style.paddingLeft = value;
      } else {
        style[prop] = value;
      }
      return { ...current, style };
    });
  }

  async function applyBrowserStyle(prop: keyof PreviewAnnotationStyle, value: string) {
    const target = activeCommentTarget;
    if (!target || !webviewNode) return;
    updateActiveTargetStyle(prop, value);
    const props: Array<keyof PreviewAnnotationStyle> = prop === 'paddingTop'
      ? ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']
      : [prop];
    try {
      for (const item of props) {
        await webviewNode.executeJavaScript(browserApplyStyleScript(target.selector, item, value), true);
      }
    } catch {
      setStatusMessage(t('designBrowser.status.applyStyleFailed'));
    }
  }

  async function applyBrowserText(value: string) {
    const target = activeCommentTarget;
    setTextDraft(value);
    setActiveCommentTarget((current) => current ? { ...current, text: value } : current);
    if (!target || !webviewNode) return;
    try {
      await webviewNode.executeJavaScript(browserApplyTextScript(target.selector, value), true);
    } catch {
      setStatusMessage(t('designBrowser.status.editTextFailed'));
    }
  }

  async function saveBrowserDomEdit() {
    if (!webviewNode) return;
    const relativePath = projectRelativePathFromBrowserUrl(currentUrl, resolvedDir);
    if (!relativePath) {
      setStatusMessage(t('designBrowser.status.onlyProjectHtmlCanSave'));
      return;
    }
    setSavingDomEdit(true);
    try {
      const html = await webviewNode.executeJavaScript<string>(BROWSER_SERIALIZE_HTML_SCRIPT, true);
      const file = await writeProjectTextFile(projectId, relativePath, html, undefined, workspaceContext);
      if (!file) throw new Error(t('designBrowser.status.htmlSaveFailed'));
      await onRefreshFiles();
      setStatusMessage(t('designBrowser.status.htmlSaved'));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t('designBrowser.status.htmlSaveFailed'));
    } finally {
      setSavingDomEdit(false);
    }
  }

  function queueBrowserCommentDraft() {
    const note = commentDraft.trim();
    if (!note) return;
    setQueuedCommentNotes((current) => [...current, note]);
    setCommentDraft('');
  }

  function addBrowserImages(files: File[]) {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    setBrowserImages((current) => [...current, ...images]);
  }

  function removeBrowserImage(index: number) {
    setBrowserImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setBrowserPreviewIndex((current) => {
      if (current === null) return current;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
  }

  async function saveBrowserComment() {
    if (!activeCommentTarget || !onSavePreviewComment) {
      setStatusMessage(t('designBrowser.status.commentSavingUnavailable'));
      return;
    }
    const note = commentDraft.trim();
    if (!note && browserImages.length === 0 && (activeSavedComment?.attachments?.length ?? 0) === 0) return;
    setSendingComment(true);
    try {
      const saved = await onSavePreviewComment(browserTargetFromSnapshot(activeCommentTarget), note, false, browserImages);
      if (saved) {
        setActivePreviewCommentId(saved.id);
        setCommentDraft(saved.note);
        setQueuedCommentNotes([]);
        setBrowserImages([]);
        setBrowserPreviewIndex(null);
        setStatusMessage(t('designBrowser.status.commentSaved'));
      }
    } finally {
      setSendingComment(false);
    }
  }

  async function sendBrowserCommentBatch() {
    if (!activeCommentTarget || !onSendBoardCommentAttachments) {
      setStatusMessage(t('designBrowser.status.commentSendingUnavailable'));
      return;
    }
    const sendingUnchangedSavedComment = Boolean(
      activeSavedComment
      && queuedCommentNotes.length === 0
      && browserImages.length === 0
      && commentDraft.trim() === activeSavedComment.note.trim(),
    );
    if (activeSavedComment && sendingUnchangedSavedComment) {
      setSendingComment(true);
      try {
        const result = await onSendBoardCommentAttachments(
          commentsToAttachments([activeSavedComment]),
        );
        if (!commentSendCompleted(result, activeSavedComment.id)) return;
        if (!onRemovePreviewComment) return;
        const removed = await onRemovePreviewComment(activeSavedComment.id);
        if (!removed) return;
        clearBrowserTool();
      } finally {
        setSendingComment(false);
      }
      return;
    }
    const notes = [...queuedCommentNotes];
    if (commentDraft.trim()) notes.push(commentDraft.trim());
    if (notes.length === 0 && browserImages.length === 0) return;
    setSendingComment(true);
    try {
      const existingAttachments = activeSavedComment?.attachments ?? [];
      const attachments = buildBoardCommentAttachments({
        target: browserTargetFromSnapshot(activeCommentTarget),
        notes,
        includeImageOnly: browserImages.length > 0,
        imageAttachmentCount: browserImages.length,
      }).map((attachment) => (
        existingAttachments.length > 0
          ? { ...attachment, imageAttachments: existingAttachments }
          : attachment
      ));
      const result = await onSendBoardCommentAttachments(
        attachments,
        browserImages,
      );
      const completedIds = new Set(result.commentIds);
      const pending = attachments.filter(
        (attachment) => !completedIds.has(attachment.id),
      );
      if (pending.length === 0 && commentSendSucceeded(result)) {
        clearBrowserTool();
        return;
      }
      if (completedIds.size === 0) return;
      setQueuedCommentNotes(pending.map((attachment) => attachment.comment));
      setCommentDraft('');
      setBrowserImages([]);
      setBrowserPreviewIndex(null);
    } finally {
      setSendingComment(false);
    }
  }

  const browserPopoverBounds = (() => {
    const rect = webviewNode?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
    return { width: rect.width, height: rect.height };
  })();
  const activeBrowserPreviewImage =
    browserPreviewIndex !== null ? browserImagePreviews[browserPreviewIndex] ?? null : null;
  const browserPreviewImageModal = activeBrowserPreviewImage
    ? createPortal(
        <AssetPreviewDialog source={{name: activeBrowserPreviewImage.file.name, kind: 'image', url: activeBrowserPreviewImage.url}} onClose={() => setBrowserPreviewIndex(null)} />,
        document.body,
      )
    : null;
  const commentComposer = activeTool === 'comment' && activeCommentTarget ? (
    <BoardComposerPopover
      target={activeCommentTarget}
      existing={activeSavedComment}
      draft={commentDraft}
      notes={queuedCommentNotes}
      onDraft={setCommentDraft}
      onAddDraft={queueBrowserCommentDraft}
      onRemoveQueuedNote={(index) => setQueuedCommentNotes((current) => current.filter((_, itemIndex) => itemIndex !== index))}
      onClose={clearBrowserTool}
      onSaveComment={() => saveBrowserComment()}
      onSendBatch={() => sendBrowserCommentBatch()}
      onRemoveMember={() => {}}
      onDeleteComment={onRemovePreviewComment}
      images={browserImagePreviews}
      existingImages={(activeSavedComment?.attachments ?? []).map((attachment) => ({
        url: projectRawUrl(projectId, attachment.path, workspaceContext),
        name: attachment.name,
      }))}
      onAttachImages={addBrowserImages}
      onRemoveImage={removeBrowserImage}
      onPreviewImage={setBrowserPreviewIndex}
      sending={sendingComment}
      queueOnSend={sendDisabled && Boolean(onSendBoardCommentAttachments)}
      sendDisabled={!onSendBoardCommentAttachments}
      t={t}
      scale={1}
      bounds={browserPopoverBounds}
      commenting
    />
  ) : null;
  const resourceCallbackRef = useRef(onCollectedFile);
  const [pinterestNotice, setPinterestNotice] = useState<{ message: string; active?: boolean } | null>(null);
  useEffect(() => {
    const browser = getBezierHost()?.browser;
    if (!webviewNode || !browser?.connectPinterest) return;
    const marker = `da-pinterest-login:${crypto.randomUUID()}`;
    const script = `(() => {
      if (!/^https:\\/\\/(www\\.)?pinterest\\.com(?:\\/|$)/.test(location.href)) return;
      if (window.__daPinterestLogin) document.removeEventListener('click', window.__daPinterestLogin, true);
      window.__daPinterestLogin = event => {
        const button = event.target instanceof Element ? event.target.closest('button,[role="button"],a') : null;
        if (!button) return;
        const label = (button.getAttribute('aria-label') || button.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!/^google$/i.test(label) && !/(?:continue|sign ?in|log ?in|使用|继续|登录|登入).{0,30}google|google.{0,30}(?:登录|登入|继续|sign ?in|log ?in)/i.test(label)) return;
        event.preventDefault(); event.stopImmediatePropagation(); console.info(${JSON.stringify(marker)});
      };
      document.addEventListener('click', window.__daPinterestLogin, true);
    })()`;
    const install = () => { try { void webviewNode.executeJavaScript(script).catch(() => undefined); } catch { /* Guest not ready. */ } };
    const receive = (event: Event) => {
      if ((event as Event & { message?: string }).message !== marker) return;
      void browser.connectPinterest!(webviewNode.getWebContentsId()).then(result => {
        if (!result.ok) setStatusMessage('reason' in result ? result.reason : t('designBrowser.status.connectionNotStarted'));
      }).catch(() => setStatusMessage(t('designBrowser.status.loginConnectFail')));
    };
    webviewNode.addEventListener('dom-ready', install);
    webviewNode.addEventListener('console-message', receive);
    install();
    return () => {
      webviewNode.removeEventListener('dom-ready', install); webviewNode.removeEventListener('console-message', receive);
      try { void webviewNode.executeJavaScript('if (window.__daPinterestLogin) { document.removeEventListener("click", window.__daPinterestLogin, true); delete window.__daPinterestLogin; }').catch(() => undefined); } catch { /* Closed guest. */ }
    };
  }, [webviewNode]);
  useEffect(() => {
    const browser = getBezierHost()?.browser;
    if (!webviewNode || !browser?.onPinterestAuthStatus) return;
    return browser.onPinterestAuthStatus(status => {
      try { if (status.guestId === webviewNode.getWebContentsId()) setPinterestNotice(status); } catch { /* Closed browser. */ }
    });
  }, [webviewNode]);
  const [resourceMenu, setResourceMenu] = useState<{ x: number; y: number; srcURL?: string; linkURL?: string; mediaType?: string; isEditable?: boolean; selectionText?: string } | null>(null);
  const pendingDropRef = useRef<{ clientX: number; clientY: number } | null>(null);
  useEffect(() => { pendingDropRef.current = null; collectionBusyRef.current = false; }, [webviewNode]);
  const collectOriginal = useCallback(async (url: string, position?: { clientX: number; clientY: number }) => {
    if (!webviewNode || collectionBusyRef.current) return;
    setResourceMenu(null);
    const browser = getBezierHost()?.browser;
    if (!browser?.collectImage) { setStatusMessage(t('designBrowser.status.restartForCollect')); return; }
    collectionBusyRef.current = true;
    pendingDropRef.current = position || null;
    setStatusMessage(t('designBrowser.status.downloadingOriginal'));
    try { await browser.collectImage(webviewNode.getWebContentsId(), url); }
    catch (error) { collectionBusyRef.current = false; pendingDropRef.current = null; setStatusMessage(error instanceof Error ? error.message : t('designBrowser.status.downloadFail')); }
  }, [webviewNode]);
  useEffect(() => {
    if (!webviewNode) return;
    const context = (event: Event) => {
      activeResourceBrowser = webviewNode;
      const params = (event as Event & { params: NonNullable<typeof resourceMenu> }).params;
      if (!params) return;
      const rect = webviewNode.getBoundingClientRect();
      setResourceMenu({ ...params, x: rect.left + params.x, y: rect.top + params.y });
    };
    const close = () => setResourceMenu(null);
    const focus = () => { activeResourceBrowser = webviewNode; close(); };
    const over = (event: DragEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.xy-flow-host') || !webviewNode.getBoundingClientRect().width) return;
      if (event.dataTransfer && Array.from(event.dataTransfer.types).some(type => type === 'text/uri-list' || type === 'text/html')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
    };
    const drop = (event: DragEvent) => {
      if (activeResourceBrowser && activeResourceBrowser !== webviewNode) return;
      if (!(event.target instanceof Element) || !event.target.closest('.xy-flow-host') || !webviewNode.getBoundingClientRect().width || !event.dataTransfer || event.dataTransfer.getData(PROJECT_FILE_DRAG_MIME)) return;
      const url = droppedBrowserImage(event.dataTransfer);
      if (!url) return;
      event.preventDefault(); event.stopPropagation();
      void collectOriginal(url, { clientX: event.clientX, clientY: event.clientY });
    };
    webviewNode.addEventListener('context-menu', context);
    webviewNode.addEventListener('focus', focus);
    webviewNode.addEventListener('did-start-navigation', close);
    window.addEventListener('dragover', over, true);
    window.addEventListener('drop', drop, true);
    return () => { if (activeResourceBrowser === webviewNode) activeResourceBrowser = null; webviewNode.removeEventListener('context-menu', context); webviewNode.removeEventListener('focus', focus); webviewNode.removeEventListener('did-start-navigation', close); window.removeEventListener('dragover', over, true); window.removeEventListener('drop', drop, true); };
  }, [collector, webviewNode, collectOriginal]);
  resourceCallbackRef.current = onCollectedFile;
  useEffect(() => {
    const browser = getBezierHost()?.browser;
    if (!webviewNode || !browser?.setCollector || !browser.onCollectedResource) return;
    let guestId: number | undefined;
    const enable = () => {
      try { guestId = webviewNode.getWebContentsId(); void browser.setCollector!(guestId, true).catch(() => setStatusMessage(t('designBrowser.status.restartForNativeCollect'))); } catch { /* wait for dom-ready */ }
    };
    enable();
    webviewNode.addEventListener('dom-ready', enable);
    const unsubscribe = browser.onCollectedResource(resource => {
      if (resource.guestId !== guestId) return;
      if (resource.error) { collectionBusyRef.current = false; pendingDropRef.current = null; setStatusMessage(resource.error); return; }
      void (async () => {
        try {
          const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };
          const ext = extensions[resource.mime || ''];
          if (!ext || !resource.base64) throw new Error(t('designBrowser.status.invalidResource'));
          setStatusMessage(t('designBrowser.status.savingOriginal'));
          const file = await writeProjectBase64File(projectId, `${PROJECT_LAYOUT.collected}/resource-${crypto.randomUUID()}.${ext}`, resource.base64, workspaceContext);
          if (!file) throw new Error(t('designBrowser.status.saveRetry'));
          const source = { url: resource.pageUrl, title: resource.title, imageUrl: resource.url, capturedAt: Date.now(), captureMode: 'original-resource' as const };
          if (resourceCallbackRef.current) await resourceCallbackRef.current(file, source);
          else {
            const metadata = await writeProjectTextFile(projectId, `${file.name}.source.json`, JSON.stringify({ schema: 'bezier-design.browser-capture.v1', file: file.name, ...source }, null, 2), undefined, workspaceContext);
            if (!metadata) { await onRefreshFiles(); throw new Error(t('designBrowser.status.savedMetaFail')); }
          }
          await onRefreshFiles();
          if (pendingDropRef.current) window.dispatchEvent(new CustomEvent(PROJECT_FILE_ADD_TO_CANVAS_EVENT, { detail: { projectId, name: file.name, kind: file.kind, mime: file.mime, size: file.size, mtime: file.mtime, ...pendingDropRef.current } }));
          setStatusMessage(t('designBrowser.status.savedToProject'));
        } catch (error) { setStatusMessage(error instanceof Error ? error.message : t('designBrowser.status.saveFail')); }
        finally { collectionBusyRef.current = false; pendingDropRef.current = null; }
      })();
    });
    return () => { unsubscribe(); webviewNode.removeEventListener('dom-ready', enable); if (guestId !== undefined) void browser.setCollector!(guestId, false).catch(() => undefined); };
  }, [collector, webviewNode, projectId, workspaceContext, onRefreshFiles]);
  const statusBaseText = typeof statusMessage === 'string' ? statusMessage : statusMessage?.message ?? '';
  const statusText = archiveSaving && statusBaseText
    ? `${statusBaseText} · ${formatBrowserSnapshotElapsed(archiveElapsedSeconds)}`
    : statusBaseText;
  const statusAction = statusMessage && typeof statusMessage === 'object' && statusMessage.actionFileName
    ? statusMessage
    : null;
  const statusIsPageSnapshot = Boolean(
    statusMessage && typeof statusMessage === 'object' && statusMessage.source === 'page-snapshot',
  );
  const showStatusMessage = Boolean(statusMessage) && !(statusIsPageSnapshot && onPageSnapshotToast);

  return (
    <section className="design-browser" data-variant={variant} aria-label={t('designBrowser.aria')}>
      {resourceMenu ? <Popover open onOpenChange={open => { if (!open) setResourceMenu(null); }}>
        <PopoverAnchor asChild><span style={{ position: 'fixed', left: resourceMenu.x, top: resourceMenu.y, width: 1, height: 1, pointerEvents: 'none' }} /></PopoverAnchor>
        <PopoverContent className="db-resource-menu" side="bottom" align="start" aria-label={t('designBrowser.resourceMenuAria')}>
          {resourceMenu.selectionText?.trim() && !resourceMenu.isEditable ? <Button variant="ghost" disabled={assetCapture.busy} onClick={() => { const text = resourceMenu.selectionText!; setResourceMenu(null); void assetCapture.saveSelection(text); }}><Icon name="plus" size={14} />{t('browserCapture.native.saveSelection')}</Button> : null}
          {resourceMenu.mediaType === 'image' && resourceMenu.srcURL ? <>
            <Button variant="ghost" disabled={assetCapture.busy} onClick={() => { const url = resourceMenu.srcURL!; setResourceMenu(null); void assetCapture.saveImage(url); }}><Icon name="plus" size={14} />{t('browserCapture.native.saveImage')}</Button>
            <Button variant="ghost" onClick={() => void collectOriginal(resourceMenu.srcURL!)}><Icon name="download" size={14} />{t('designBrowser.saveImageToLibrary')}</Button>
            <Button variant="ghost" onClick={() => { void navigator.clipboard.writeText(resourceMenu.srcURL!).catch(() => setStatusMessage(t('designBrowser.status.copyFail'))); setResourceMenu(null); }}><Icon name="copy" size={14} />{t('designBrowser.copyImageUrl')}</Button>
          </> : null}
          {resourceMenu.linkURL ? <Button variant="ghost" onClick={() => { navigateTo(resourceMenu.linkURL!); setResourceMenu(null); }}>{t('designBrowser.openLink')}</Button> : null}
          {resourceMenu.selectionText ? <Button variant="ghost" onClick={() => { webviewNode?.copy(); setResourceMenu(null); }}>{t('designBrowser.copySelection')}</Button> : null}
          {resourceMenu.isEditable ? <Button variant="ghost" onClick={() => { webviewNode?.paste(); setResourceMenu(null); }}>{t('designBrowser.paste')}</Button> : null}
          <Button variant="ghost" disabled={!canGoBack} onClick={() => { navigateHistoryBy(-1); setResourceMenu(null); }}>{t('designBrowser.goBackMenu')}</Button>
          <Button variant="ghost" onClick={() => { reload(false); setResourceMenu(null); }}>{t('designBrowser.reloadMenu')}</Button>
        </PopoverContent>
      </Popover> : null}
      <div className="db-chrome" ref={chromeRef}>
        <div className="db-nav">
          <IconTooltipButton
            label={t('designBrowser.goBack')}
            disabled={!canGoBack}
            onClick={() => navigateHistoryBy(-1)}
          >
            <Icon name="chevron-left" size={16} />
          </IconTooltipButton>
          <IconTooltipButton
            label={t('designBrowser.goForward')}
            disabled={!canGoForward}
            onClick={() => navigateHistoryBy(1)}
          >
            <Icon name="chevron-right" size={16} />
          </IconTooltipButton>
          <IconTooltipButton
            label={isLoading ? t('designBrowser.stopLoading') : t('designBrowser.reload')}
            className={!collector && isLoading ? 'is-spinning' : ''}
            disabled={isBlank}
            onClick={() => (isLoading ? stopLoading() : reload(false))}
          >
            <Icon name={isLoading ? 'close' : 'reload'} size={isLoading ? 16 : 15} />
          </IconTooltipButton>
          <IconTooltipButton
            label={t('designBrowser.goHome')}
            disabled={isBlank}
            onClick={() => navigateTo(EMPTY_URL)}
          >
            <Icon name="home" size={16} />
          </IconTooltipButton>
        </div>
        <form className="db-address-form" onSubmit={handleAddressSubmit}>
          <BrowserSiteIcon
            className="db-address-site-icon"
            fallback="globe"
            iconUrl={isBlank ? undefined : pageIconUrl}
          />
          <div className="db-address-field">
            <Input
              ref={addressInputRef}
              value={shownAddressValue}
              onChange={(event) => {
                setAddressEditing(true);
                setAddressValue(event.target.value);
                setSuggestionsOpen(true);
              }}
              onFocus={(event) => {
                const resumingDraft = addressEditingRef.current;
                setAddressEditing(true);
                if (!resumingDraft) setAddressValue(isBlank ? '' : currentUrl);
                setSuggestionsOpen(true);
                const input = event.currentTarget;
                addressSelectFrameRef.current = window.requestAnimationFrame(() => {
                  addressSelectFrameRef.current = null;
                  if (input.isConnected && document.activeElement === input && addressEditingRef.current) input.select();
                });
              }}
              onBlur={(event) => {
                cancelAddressCallbacks();
                if (event.relatedTarget instanceof Node && event.currentTarget.form?.contains(event.relatedTarget)) return;
                setSuggestionsOpen(false);
                if (!addressEditingRef.current) return;
                addressBlurTimerRef.current = window.setTimeout(() => {
                  addressBlurTimerRef.current = null;
                  if (document.activeElement !== addressInputRef.current) setAddressEditing(false);
                }, 80);
              }}
              placeholder={addressDisplayParts.url ? '' : t('designBrowser.addressPlaceholder')}
              aria-label={t('designBrowser.addressAria')}
              autoComplete="off"
              spellCheck={false}
            />
            {addressDisplayParts.url ? (
              <span className="db-address-display" aria-hidden>
                <span className="db-address-url">{addressDisplayParts.url}</span>
                {addressDisplayParts.title ? (
                  <>
                    <span className="db-address-separator">/</span>
                    <span className="db-address-title">{addressDisplayParts.title}</span>
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
          {suggestionsOpen && suggestions.length > 0 ? (
            <div className="db-suggestions" role="listbox">
              {suggestions.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  role="option"
                  onFocus={() => warmBrowserOrigin(item.url)}
                  onPointerEnter={() => warmBrowserOrigin(item.url)}
                  onClick={() => navigateTo(item.url)}
                >
                  <span className="db-suggestion-icon">
                    <BrowserSiteIcon
                      fallback={item.type === 'history' ? 'history' : 'globe'}
                      iconUrl={item.iconUrl}
                    />
                  </span>
                  <span className="db-suggestion-copy">
                    <span>{item.label}</span>
                    <small>{item.detail}</small>
                  </span>
                  <span className="db-suggestion-type">{item.typeLabel}</span>
                </Button>
              ))}
            </div>
          ) : null}
        </form>
        <div className="db-actions">
          <IconTooltipButton
            label={t('designBrowser.extractPage')}
            wrapperClassName="db-action-item"
            disabled={!onExtractPage || sendDisabled || extractingPage || archiveSaving || !canExtractBrowserPage(currentUrl)}
            aria-busy={extractingPage || undefined}
            className={extractingPage ? 'is-spinning' : undefined}
            onClick={() => void extractPage()}
          >
            <Icon name={extractingPage ? 'reload' : 'file-code'} size={16} />
          </IconTooltipButton>
          <BrowserCaptureSettings />
          {resourcePlugin.trigger}
          {collector ? <IconTooltipButton label={t('designBrowser.openInTabBrowser')} disabled={isBlank} onClick={() => window.dispatchEvent(new CustomEvent(OPEN_COLLECTOR_TAB_EVENT, { detail: { projectId, url: currentUrl } }))}><Icon name="maximize" size={15} /></IconTooltipButton> : null}
          {desktopHostAvailable ? (
            <IconTooltipButton
              label={t('fileViewer.screenshot')}
              wrapperClassName="db-action-item db-action-secondary db-action-screenshot"
              disabled={isBlank || screenshotSaving}
              onClick={takeScreenshot}
            >
              <Icon name="image" size={15}  />
            </IconTooltipButton>
          ) : null}
          <IconTooltipButton
            label={t('designBrowser.menu')}
            wrapperClassName="db-action-item db-action-menu"
            onClick={() => {
              setMenuOpen((open) => !open);
              setSuggestionsOpen(false);
            }}
          >
            <Icon name="more-horizontal" size={16} />
          </IconTooltipButton>
          {menuOpen ? (
            <div className="db-menu" role="menu">
              <Button type="button" role="menuitem" onClick={takeScreenshot} disabled={isBlank || screenshotSaving}>
                <Icon name="image" size={14} />
                {collector ? t('designBrowser.savePageScreenshotFallback') : t('designBrowser.menu.copyScreenshot')}
              </Button>
              <Button type="button" role="menuitem" onClick={() => reload(true)} disabled={isBlank}>
                <Icon name="reload" size={14} />
                {t('designBrowser.menu.hardReload')}
              </Button>
              <Button type="button" role="menuitem" onClick={copyCurrentUrl} disabled={isBlank}>
                <Icon name="copy" size={14} />
                {t('designBrowser.menu.copyUrl')}
              </Button>
              <Button type="button" role="menuitem" onClick={openCurrentExternally} disabled={isBlank || !isHttpLikeUrl(currentUrl)}>
                <Icon name="external-link" size={14} />
                {t('designBrowser.menu.openInBrowser')}
              </Button>
              <span className="db-menu-separator" />
              <Button
                type="button"
                role="menuitem"
                className={downloadAttentionNonce != null ? 'is-attention' : undefined}
                onClick={() => void savePageSnapshot({ openAfterSave: false })}
                disabled={isBlank || archiveSaving}
                aria-busy={archiveSaving ? true : undefined}
              >
                <Icon name="download" size={14} />
                {t('designBrowser.downloadPage')}
              </Button>
              <Button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setExtensionSettingsOpen(true); }}>
                <Icon name="external-link" size={14} />
                {t('browserExtension.title')}
              </Button>
              <Button type="button" role="menuitem" onClick={clearHistoryOnly}>
                <Icon name="history" size={14} />
                {t('designBrowser.menu.clearBrowsingHistory')}
              </Button>
              <Button type="button" role="menuitem" onClick={() => void clearCookies(false)}>
                <Icon name="trash" size={14} />
                {t('designBrowser.menu.clearCookies')}
              </Button>
              <Button type="button" role="menuitem" onClick={() => void clearCookies(true)}>
                <Icon name="trash" size={14} />
                {t('designBrowser.menu.clearAllData')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {extensionSettingsOpen ? createPortal(<Dialog ariaLabel={t('browserExtension.title')} closeOnEscape onClose={() => setExtensionSettingsOpen(false)}>
        <DialogTitle>{t('browserExtension.title')}</DialogTitle>
        <DialogBody><BrowserExtensionSection /></DialogBody>
        <DialogFooter><Button type="button" variant="ghost" onClick={() => setExtensionSettingsOpen(false)}>{t('common.close')}</Button></DialogFooter>
      </Dialog>, document.body) : null}
      <BrowserBookmarks url={currentUrl} title={pageTitle} onNavigate={navigateTo} />
      {pinterestNotice ? <div className="db-status" role="status">
        <span>{pinterestNotice.message}</span>
        <Button variant="ghost" onClick={() => {
          if (pinterestNotice.active && webviewNode) void getBezierHost()?.browser.cancelPinterest?.(webviewNode.getWebContentsId()).catch(() => setStatusMessage(t('designBrowser.status.cancelFail')));
          else setPinterestNotice(null);
        }}>{pinterestNotice.active ? t('designBrowser.cancelConnection') : t('designBrowser.gotIt')}</Button>
      </div> : null}
      {downloadAttentionNonce != null ? (
        <div className="db-download-assist" role="status">
          <span className="db-download-assist-icon" aria-hidden>
            <Icon name="download" size={14} />
          </span>
          <span>{t('designBrowser.status.downloadAssistHint')}</span>
        </div>
      ) : null}
      {showStatusMessage ? (
        <div className="db-status" role="status">
          <span>{statusText}</span>
          {archiveSaving ? (
            <Button
              type="button"
              className="db-status-action"
              onClick={cancelPageSnapshot}
            >
              {t('common.cancel')}
            </Button>
          ) : statusAction ? (
            <Button
              type="button"
              className="db-status-action"
              onClick={() => {
                if (statusAction.actionTarget === 'design-files' && onBezierFiles) {
                  onBezierFiles();
                } else {
                  onOpenFile(statusAction.actionFileName ?? '');
                }
                setStatusMessage(null);
              }}
            >
              {statusAction.actionLabel ?? t('fileViewer.open')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {browserPreviewImageModal}
      <div className="db-content">
        <div className="preview-content-surface">
          <div className="db-viewport-frame">
            {isBlank ? (
              <DesignBrowserStart
                onNavigate={navigateTo}
                projectId={projectId}
              />
            ) : desktopHostAvailable ? (
              // Electron snapshots popup permission when the guest first attaches.
              // A ref callback is too late. Use a string DOM attribute (React 18
              // drops unknown boolean attributes); native policy still denies
              // every new window and routes HTTP(S) links into this same guest.
              createElement('webview', {
                ref: assignWebviewNode,
                className: 'db-webview',
                src: loadUrl,
                partition: DESIGN_BROWSER_PARTITION,
                allowpopups: 'true',
                useragent: collector ? MOBILE_BROWSER_USER_AGENT : undefined,
                title: pageTitle,
              })
            ) : (
              <div className="db-fallback">
                <iframe
                  title={pageTitle}
                  src={loadUrl}
                  onLoad={(event) => syncFromFallbackFrame(event.currentTarget)}
                />
              </div>
            )}
            {assetCapture.toolbar}
            {commentComposer}
            {(activeTool === 'inspect' || activeTool === 'edit') && activeCommentTarget ? (
              <BrowserInspectPanel
                mode={activeTool}
                target={activeCommentTarget}
                textDraft={textDraft}
                canSave={editableProjectHtml}
                saving={savingDomEdit}
                onApplyStyle={(prop, value) => { void applyBrowserStyle(prop, value); }}
                onTextDraft={(value) => { void applyBrowserText(value); }}
                onSave={() => { void saveBrowserDomEdit(); }}
                onClose={clearBrowserTool}
              />
            ) : null}
          </div>
          {!isBlank && activeTool && !activeCommentTarget ? (
            <div className="db-tool-hint" role="status">
              {activeTool === 'comment'
                ? t('designBrowser.status.clickElementToComment')
                : t('designBrowser.status.clickElementToTune')}
            </div>
          ) : null}
        </div>
        {resourcePlugin.panel}
      </div>
    </section>
  );
}

function IconTooltipButton({
  label,
  className,
  wrapperClassName,
  children,
  ...buttonProps
}: {
  label: string;
  children: ReactNode;
  wrapperClassName?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <span
      className={['db-tooltip-anchor bezier-tooltip', wrapperClassName].filter(Boolean).join(' ')}
      data-tooltip={label}
      data-tooltip-placement="bottom"
    >
      <Button
        {...buttonProps}
        type="button"
        className={['db-icon-btn', className].filter(Boolean).join(' ')}
        aria-label={label}
        title={label}
      >
        {children}
      </Button>
    </span>
  );
}

function BrowserCommentMarkers({
  activeCommentId,
  comments,
  liveTargets,
  onOpen,
}: {
  activeCommentId: string | null;
  comments: PreviewComment[];
  liveTargets: Map<string, BrowserElementSnapshot>;
  onOpen: (comment: PreviewComment) => void;
}) {
  const t = useT();
  if (comments.length === 0) return null;
  return (
    <div className="db-comment-layer" aria-label={t('designBrowser.comments.aria')}>
      {comments.map((comment, index) => {
        const snapshot = liveTargets.get(`comment:${comment.id}`) ?? browserSnapshotFromComment(comment, comment.filePath);
        const bounds = browserOverlayBounds(snapshot);
        const active = comment.id === activeCommentId;
        const label = comment.label || comment.elementId || 'Browser comment';
        return (
          <Button
            key={comment.id}
            type="button"
            className={`db-comment-marker${active ? ' active' : ''}`}
            style={{
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
            }}
            title={`${index + 1}. ${label}: ${comment.note}`}
            aria-label={t('designBrowser.comments.openFor', { label })}
            onClick={() => onOpen(comment)}
          >
            <span>{index + 1}</span>
          </Button>
        );
      })}
    </div>
  );
}

function browserSnapshotMapsEqual(
  current: Map<string, BrowserElementSnapshot>,
  next: Map<string, BrowserElementSnapshot>,
): boolean {
  if (current.size !== next.size) return false;
  for (const [key, snapshot] of current) {
    const candidate = next.get(key);
    if (!candidate || !browserSnapshotsEqual(snapshot, candidate)) return false;
  }
  return true;
}

function browserSnapshotsEqual(left: BrowserElementSnapshot, right: BrowserElementSnapshot): boolean {
  return (
    left.filePath === right.filePath &&
    left.elementId === right.elementId &&
    left.selector === right.selector &&
    left.label === right.label &&
    left.text === right.text &&
    left.htmlHint === right.htmlHint &&
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.position.width === right.position.width &&
    left.position.height === right.position.height &&
    JSON.stringify(left.style ?? null) === JSON.stringify(right.style ?? null)
  );
}

function BrowserCommentComposer({
  draft,
  existing,
  notes,
  onAddDraft,
  onClose,
  onDeleteComment,
  onDraft,
  onRemoveQueuedNote,
  onSaveComment,
  onSendBatch,
  sendDisabled,
  sending,
  target,
}: {
  draft: string;
  existing: PreviewComment | null;
  notes: string[];
  onAddDraft: () => void;
  onClose: () => void;
  onDeleteComment?: (commentId: string) => Promise<boolean | void> | void;
  onDraft: (value: string) => void;
  onRemoveQueuedNote: (index: number) => void;
  onSaveComment: () => void;
  onSendBatch: () => void;
  sendDisabled: boolean;
  sending: boolean;
  target: BrowserElementSnapshot;
}) {
  const t = useT();
  return (
    <div className="comment-popover db-comment-popover" role="dialog" aria-label={t('designBrowser.comment.dialog')}>
      <div className="comment-popover-head">
        <div>
          <strong title={target.label}>{target.label || t('designBrowser.comment.elementFallback')}</strong>
          <span title={target.selector}>{target.selector}</span>
        </div>
        <Button type="button" variant="ghost" onClick={onClose} aria-label={t('designBrowser.comment.close')}>
          <Icon name="close" size={12} />
        </Button>
      </div>
      {notes.length > 0 ? (
        <div className="board-note-list">
          {notes.map((note, index) => (
            <div key={`${note}:${index}`} className="board-note-item">
              <span>{note}</span>
              <Button type="button" variant="ghost" onClick={() => onRemoveQueuedNote(index)}>
                {t('common.delete')}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <Textarea
        aria-label={t('designBrowser.comment.noteAria')}
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        placeholder={t('designBrowser.comment.placeholder')}
      />
      <div className="comment-popover-actions">
        <div className="comment-popover-actions-start">
          {existing && onDeleteComment ? (
            <Button type="button" variant="ghost" className="comment-popover-delete" disabled={sending} onClick={() => void onDeleteComment(existing.id)}>
              {t('common.delete')}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" disabled={sending || !draft.trim()} onClick={onAddDraft}>
            {t('designBrowser.comment.addNote')}
          </Button>
        </div>
        <div className="comment-popover-actions-end">
          <Button type="button" variant="ghost" disabled={sending || (!draft.trim() && !existing)} onClick={onSaveComment}>
            {t('designBrowser.comment.saveComment')}
          </Button>
          <Button type="button" variant="primary" disabled={sending || sendDisabled || (!draft.trim() && notes.length === 0 && !existing)} onClick={onSendBatch}>
            {sending ? t('designBrowser.comment.sending') : t('designBrowser.comment.sendToChat')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BrowserInspectPanel({
  canSave,
  mode,
  onApplyStyle,
  onClose,
  onSave,
  onTextDraft,
  saving,
  target,
  textDraft,
}: {
  canSave: boolean;
  mode: 'inspect' | 'edit';
  onApplyStyle: (prop: keyof PreviewAnnotationStyle, value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onTextDraft: (value: string) => void;
  saving: boolean;
  target: BrowserElementSnapshot;
  textDraft: string;
}) {
  const t = useT();
  const draft = browserStyleDraftFromTarget(target);
  const fontSize = parsePx(draft.fontSize, 16);
  const padding = parsePx(draft.paddingTop, 0);
  const radius = parsePx(draft.borderRadius, 0);

  return (
    <aside className="inspect-panel db-inspect-panel" data-testid="browser-inspect-panel">
      <header className="inspect-panel-head">
        <div className="inspect-panel-title">
          <strong title={target.label}>
            {mode === 'edit' ? t('designBrowser.inspect.editTitle') : t('designBrowser.inspect.tuneTitle')}
          </strong>
          <code title={target.selector}>{target.label || target.selector}</code>
        </div>
        <Button type="button" variant="ghost" onClick={onClose} aria-label={t('designBrowser.inspect.closeTune')}>
          <Icon name="close" size={12} />
        </Button>
      </header>

      <section className="inspect-section">
        <div className="inspect-section-label">{t('designBrowser.inspect.colors')}</div>
        <div className="inspect-row">
          <label htmlFor="db-inspect-color">{t('designBrowser.inspect.text')}</label>
          <input
            id="db-inspect-color"
            type="color"
            value={cssColorToHex(draft.color, '#1f1f1f')}
            onChange={(event) => onApplyStyle('color', event.target.value)}
          />
          <span className="inspect-row-value">{cssColorToHex(draft.color, '#1f1f1f')}</span>
        </div>
        <div className="inspect-row">
          <label htmlFor="db-inspect-bg">{t('designBrowser.inspect.fill')}</label>
          <input
            id="db-inspect-bg"
            type="color"
            value={cssColorToHex(draft.backgroundColor, '#ffffff')}
            onChange={(event) => onApplyStyle('backgroundColor', event.target.value)}
          />
          <span className="inspect-row-value">{cssColorToHex(draft.backgroundColor, '#ffffff')}</span>
        </div>
      </section>

      <section className="inspect-section">
        <div className="inspect-section-label">{t('designBrowser.inspect.type')}</div>
        <div className="inspect-row">
          <label htmlFor="db-inspect-font-size">{t('designBrowser.inspect.size')}</label>
          <input
            id="db-inspect-font-size"
            type="range"
            min={8}
            max={96}
            value={fontSize}
            onChange={(event) => onApplyStyle('fontSize', `${event.target.value}px`)}
          />
          <span className="inspect-row-value">{fontSize}px</span>
        </div>
        <div className="inspect-row">
          <label htmlFor="db-inspect-weight">{t('designBrowser.inspect.weight')}</label>
          <Select
            id="db-inspect-weight"
            value={draft.fontWeight}
            onChange={(event) => onApplyStyle('fontWeight', event.target.value)}
          >
            <option value="300">300</option>
            <option value="400">400</option>
            <option value="500">500</option>
            <option value="600">600</option>
            <option value="700">700</option>
            <option value="800">800</option>
          </Select>
          <span className="inspect-row-value">{draft.fontWeight}</span>
        </div>
      </section>

      <section className="inspect-section">
        <div className="inspect-section-label">{t('designBrowser.inspect.spacing')}</div>
        <div className="inspect-row">
          <label htmlFor="db-inspect-padding">{t('designBrowser.inspect.pad')}</label>
          <input
            id="db-inspect-padding"
            type="range"
            min={0}
            max={80}
            value={padding}
            onChange={(event) => onApplyStyle('paddingTop', `${event.target.value}px`)}
          />
          <span className="inspect-row-value">{padding}px</span>
        </div>
        <div className="inspect-row">
          <label htmlFor="db-inspect-radius">{t('designBrowser.inspect.radius')}</label>
          <input
            id="db-inspect-radius"
            type="range"
            min={0}
            max={80}
            value={radius}
            onChange={(event) => onApplyStyle('borderRadius', `${event.target.value}px`)}
          />
          <span className="inspect-row-value">{radius}px</span>
        </div>
      </section>

      {mode === 'edit' ? (
        <section className="inspect-section">
          <div className="inspect-section-label">{t('designBrowser.inspect.content')}</div>
          <Textarea
            aria-label={t('designBrowser.inspect.elementText')}
            className="db-inspect-text"
            value={textDraft}
            onChange={(event) => onTextDraft(event.target.value)}
          />
        </section>
      ) : null}

      <footer className="inspect-panel-footer">
        <Button type="button" variant="ghost" onClick={onClose}>{t('common.close')}</Button>
        <Button type="button" variant="primary" disabled={!canSave || saving} onClick={onSave}>
          {saving
            ? t('designBrowser.inspect.saving')
            : canSave
              ? t('designBrowser.inspect.saveHtml')
              : t('designBrowser.inspect.liveOnly')}
        </Button>
      </footer>
    </aside>
  );
}

function browserSnapshotFromComment(comment: PreviewComment, filePath: string): BrowserElementSnapshot {
  return {
    filePath,
    elementId: comment.elementId,
    selector: comment.selector,
    label: comment.label,
    text: comment.text,
    position: comment.position,
    htmlHint: comment.htmlHint,
    style: comment.style,
    selectionKind: 'element',
  };
}

function browserTargetFromSnapshot(snapshot: BrowserElementSnapshot): PreviewCommentTarget {
  return {
    filePath: snapshot.filePath,
    elementId: snapshot.elementId,
    selector: snapshot.selector,
    label: snapshot.label,
    text: snapshot.text.trim().slice(0, 500),
    position: snapshot.position,
    htmlHint: snapshot.htmlHint.trim().slice(0, 500),
    style: snapshot.style,
    selectionKind: 'element',
  };
}

function browserOverlayBounds(snapshot: BrowserElementSnapshot) {
  const position = snapshot.position;
  return {
    left: Math.round(position.x),
    top: Math.round(position.y),
    width: Math.max(1, Math.round(position.width)),
    height: Math.max(1, Math.round(position.height)),
  };
}

function browserCommentsToAttachments(comments: PreviewComment[]): ChatCommentAttachment[] {
  return comments.map((comment, index) => ({
    id: comment.id,
    order: index + 1,
    filePath: comment.filePath,
    elementId: comment.elementId,
    selector: comment.selector,
    label: comment.label,
    comment: comment.note.trim() || 'Saved browser comment',
    currentText: comment.text.trim().slice(0, 500),
    pagePosition: comment.position,
    htmlHint: comment.htmlHint.trim().slice(0, 500),
    style: comment.style,
    selectionKind: 'element',
    imageAttachments: comment.attachments && comment.attachments.length > 0
      ? comment.attachments
      : undefined,
    source: 'saved-comment',
  }));
}

function browserBoardCommentAttachments(input: {
  notes: string[];
  target: PreviewCommentTarget;
}): ChatCommentAttachment[] {
  return input.notes
    .map((note) => note.trim())
    .filter(Boolean)
    .map((note, index) => ({
      id: `${input.target.elementId}-browser-${index + 1}`,
      order: index + 1,
      filePath: input.target.filePath,
      elementId: input.target.elementId,
      selector: input.target.selector,
      label: input.target.label,
      comment: note,
      currentText: input.target.text.trim().slice(0, 500),
      pagePosition: input.target.position,
      htmlHint: input.target.htmlHint.trim().slice(0, 500),
      style: input.target.style,
      selectionKind: 'element',
      source: 'board-batch',
    }));
}

function browserStyleDraftFromTarget(target: BrowserElementSnapshot): BrowserStyleDraft {
  const style = target.style ?? {};
  return {
    backgroundColor: style.backgroundColor || '#ffffff',
    borderRadius: style.borderRadius || '0px',
    color: style.color || '#1f1f1f',
    fontSize: style.fontSize || '16px',
    fontWeight: style.fontWeight || '400',
    lineHeight: style.lineHeight || 'normal',
    paddingTop: style.paddingTop || style.paddingRight || style.paddingBottom || style.paddingLeft || '0px',
    textAlign: style.textAlign || 'start',
  };
}

function parsePx(value: string, fallback: number): number {
  const match = /^(-?\d+(?:\.\d+)?)px$/i.exec(value.trim());
  if (!match) return fallback;
  const next = Math.round(Number(match[1]));
  return Number.isFinite(next) ? next : fallback;
}

function cssColorToHex(value: string, fallback: string): string {
  const raw = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.slice(1).split('').map((char) => char + char).join('')}`;
  }
  const match = raw.match(/rgba?\(\s*([0-9.]+)[ ,]+([0-9.]+)[ ,]+([0-9.]+)/i);
  if (!match) return fallback;
  const toHex = (part: string | undefined) => {
    const number = Math.max(0, Math.min(255, Math.round(Number(part ?? 0))));
    return number.toString(16).padStart(2, '0');
  };
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
}

const REFERENCE_ALL_CATEGORY = 'all';

export function DesignBrowserStart({
  onNavigate,
  projectId,
}: {
  onNavigate: (url: string) => void;
  projectId?: string;
}) {
  const t = useT();
  const [activeCategory, setActiveCategory] = useState<string>(REFERENCE_ALL_CATEGORY);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);

  const { references, ready, error: loadError } = useBrowserPreferences();
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [removing, setRemoving] = useState<ReferenceSite | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const catalogue = useMemo(() => REFERENCE_GROUPS.map(group => ({
    ...group,
    sites: [
      ...group.sites.filter(site => !references.hiddenUrls.includes(browserHttpUrl(site.url) ?? site.url)),
      ...references.customSites.filter(site => site.category === group.id).map(site => ({ label: site.title, url: site.url, detail: site.description, customId: site.id })),
    ].filter((site, index, list) => list.findIndex(other => other.url === site.url) === index),
  })), [references]);
  const total = catalogue.reduce((sum, group) => sum + group.sites.length, 0);
  const visibleGroups = useMemo(
    () => filterReferenceGroups(catalogue, activeCategory, query, t),
    [catalogue, activeCategory, query, t],
  );
  const locked = !ready || loadError || saving;
  const saveRemoval = () => {
    if (saving || !removing) return;
    setSaving(true); setSaveError(false);
    void updateBrowserReferences(current => ({
      customSites: current.customSites.filter(site => site.id !== removing.customId),
      hiddenUrls: removing.customId ? current.hiddenUrls : [...new Set([...current.hiddenUrls, browserHttpUrl(removing.url) ?? removing.url])],
    })).then(() => setRemoving(null)).catch(() => { setSaveError(true); setRemoving(null); }).finally(() => setSaving(false));
  };
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  const resetFilters = () => {
    setQuery('');
    setActiveCategory(REFERENCE_ALL_CATEGORY);
    searchRef.current?.focus();
  };

  const selectCategory = (categoryId: string) => {
    setActiveCategory(categoryId);

  };

  const openSite = (site: ReferenceSite) => {
    onNavigate(site.url);
  };

  const visibleCount = visibleGroups.reduce((sum, group) => sum + group.sites.length, 0);
  const isOverview = activeCategory === REFERENCE_ALL_CATEGORY && !hasQuery;

  return (
    <div className={homeStyles.start} data-testid="design-browser-home">
      <div className={homeStyles.inner}>
        <header className={homeStyles.hero}>
          <div className={homeStyles.masthead}>
            <span className={homeStyles.wordmark}><Icon name="globe" size={15} />{t('designBrowser.reference.kicker')}</span>
            <span className={homeStyles.edition}>{t('designBrowser.reference.collectionMeta', { sites: total, categories: REFERENCE_GROUPS.length })}</span>
          </div>
          <div className={homeStyles.intro}>
            <div>
              <h2>{t('designBrowser.reference.homeTitle')}</h2>
              <p>{t('designBrowser.reference.homeSubtitle')}</p>
            </div>
            <div className={homeStyles.search}>
              <Icon name="search" size={18} />
              <Input ref={searchRef} type="search" value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape' && query) {
                    event.preventDefault(); event.stopPropagation(); setQuery('');
                  }
                }}
                placeholder={t('designBrowser.reference.searchPlaceholder')}
                aria-label={t('designBrowser.reference.searchAria')}
              />
              {hasQuery ? <Button type="button" variant="ghost" size="icon" className={homeStyles.clear}
                aria-label={t('designBrowser.reference.clearSearch')}
                onClick={() => { setQuery(''); searchRef.current?.focus(); }}><Icon name="close" size={14} /></Button> : null}
            </div>
          </div>
        </header>

        {isOverview ? <section className={homeStyles.featured} aria-label={t('designBrowser.reference.featured')}>
          <div className={homeStyles.sectionLabel}><span>{t('designBrowser.reference.featured')}</span><span>{t('designBrowser.reference.featuredHint')}</span></div>
          <div className={homeStyles.featureGrid}>
            {(['interfaces', 'type', 'color'] as const).map((id, index) => {
              const group = REFERENCE_GROUPS.find(item => item.id === id)!;
              return <Button key={id} type="button" variant="ghost" className={homeStyles.featureCard}
                aria-label={t('designBrowser.reference.exploreCategory', { name: localizedReferenceGroupTitle(group, t) })}
                onClick={() => selectCategory(id)}>
                <span className={homeStyles.featureArt} data-art={id}><ReferenceCategoryArtwork category={id} /></span>
                <span className={homeStyles.featureCaption}>
                  <span className={homeStyles.featureNumber}>0{index + 1}</span>
                  <span><strong>{localizedReferenceGroupTitle(group, t)}</strong><small>{t(`designBrowser.reference.feature.${id}`)}</small></span>
                  <Icon name="external-link" size={17} />
                </span>
              </Button>;
            })}
          </div>
        </section> : null}

        <div className={homeStyles.libraryHeader}>
          <h3>{t('designBrowser.reference.title')}</h3>
          <div className={homeStyles.libraryActions}>
            <span role="status" aria-live="polite">{t('designBrowser.reference.resultCount', { count: visibleCount })}</span>
            <Button type="button" variant="ghost" disabled={locked} aria-pressed={managing} onClick={() => setManaging(!managing)}><Icon name="edit" size={13} />{t(managing ? 'browserLibrary.done' : 'browserLibrary.manage')}</Button>
            <Button type="button" variant="default" disabled={locked || references.customSites.length >= 200} onClick={() => setAdding(true)}><Icon name="plus" size={13} />{t('browserLibrary.addReference')}</Button>
          </div>
        </div>
        {loadError || saveError ? <div className={homeStyles.notice} role="alert">{t(loadError ? 'browserLibrary.loadFail' : 'browserBookmarks.saveFail')}<Button type="button" variant="ghost" onClick={() => { setSaveError(false); void reloadBrowserPreferences(); }}>{t('common.retry')}</Button></div> : null}
        {managing ? <div className={homeStyles.notice}><span>{t('browserLibrary.manageHint')}</span><Button type="button" variant="ghost" disabled={locked || references.hiddenUrls.length === 0} onClick={() => setRestoring(true)}>{t('browserLibrary.restore')}</Button></div> : null}
        <div className={homeStyles.library}>
          <aside className={homeStyles.categories}>
            <FilterChipRail className={homeStyles.categoryRail}
              ariaLabel={t('designBrowser.reference.categoryAria')}
              items={[
                { id: REFERENCE_ALL_CATEGORY, label: <><span>{t('common.all')}</span><span>{total}</span></> },
                ...catalogue.map(group => ({ id: group.id,
                  label: <><span>{localizedReferenceGroupTitle(group, t)}</span><span>{group.sites.length}</span></>,
                })),
              ]} value={activeCategory} onValueChange={selectCategory} />
          </aside>
          {visibleGroups.length === 0 ? <div className={homeStyles.empty}>
            <Icon name="search" size={28} />
            <p>{hasQuery ? t('designBrowser.reference.noMatches', { query: trimmedQuery }) : t('browserLibrary.emptyReferences')}</p>
            <Button type="button" variant="ghost" onClick={resetFilters}>{t('designBrowser.reference.clearFilters')}<Icon name="arrow-right" size={14} /></Button>
          </div> : <div className={homeStyles.board}>
            {visibleGroups.map(group => <section key={group.id} className={homeStyles.group}>
              <h4>{localizedReferenceGroupTitle(group, t)}<span>{String(group.sites.length).padStart(2, '0')}</span></h4>
              <div className={homeStyles.siteGrid}>
                {group.sites.map(site => <div key={site.url} className={homeStyles.siteEntry}>
                  <Button type="button" variant="ghost" className={homeStyles.siteCard}
                  aria-label={t('designBrowser.reference.openSite', { name: site.label })}
                  onPointerEnter={() => warmBrowserOrigin(site.url)} onClick={() => openSite(site)}>
                  <BrowserSiteIcon className={homeStyles.siteIcon} fallback="globe" iconUrl={site.customId ? undefined : referenceIconUrl(site.url)} />
                  <span className={homeStyles.siteCopy}><strong>{site.label}</strong><small>{hostnameFromUrl(site.url)}</small></span>
                  <span className={homeStyles.siteArrow}><Icon name="external-link" size={15} /></span>
                  <span className={homeStyles.siteDescription}>{localizedReferenceSiteDetail(site, t)}</span>
                </Button>
                {managing ? <Button type="button" variant="ghost" className={homeStyles.removeSite} disabled={locked}
                  aria-label={t('browserLibrary.removeSite', { name: site.label })} onClick={() => setRemoving(site)}><Icon name="trash" size={13} />{t('browserLibrary.remove')}</Button> : null}
                </div>)}
              </div>
            </section>)}
          </div>}
        </div>
        <footer className={homeStyles.footer}><span>{t('designBrowser.reference.footer')}</span><span aria-hidden="true">LOOM / DESIGN BROWSER</span></footer>
      </div>
      {adding ? <BrowserSiteDialog heading={t('browserLibrary.addReference')}
        initial={{ category: activeCategory === REFERENCE_ALL_CATEGORY ? 'inspiration' : activeCategory }}
        categories={REFERENCE_GROUPS.map(group => ({ id: group.id, title: localizedReferenceGroupTitle(group, t) }))}
        onClose={() => setAdding(false)} onSave={async draft => {
          try {
            await updateBrowserReferences(current => {
              if (REFERENCE_GROUPS.some(group => group.sites.some(site => browserHttpUrl(site.url) === draft.url)) || current.customSites.some(site => site.url === draft.url)) throw new Error(t('browserLibrary.duplicate'));
              if (current.customSites.length >= 200) throw new Error(t('browserLibrary.limit'));
              return { ...current, customSites: [...current.customSites, { ...draft, id: crypto.randomUUID() }] };
            });
            setActiveCategory(draft.category); setQuery('');
          } catch (reason) {
            if (reason instanceof Error && [t('browserLibrary.duplicate'), t('browserLibrary.limit')].includes(reason.message)) throw reason;
            throw new Error(t('browserBookmarks.saveFail'));
          }
        }} /> : null}
      {removing ? createPortal(<ConfirmDialog title={t('browserLibrary.removeSite', { name: removing.label })}
        description={t(removing.customId ? 'browserLibrary.removeDescription' : 'browserLibrary.hideDescription', { name: removing.label })}
        confirmLabel={saving ? t('browserLibrary.saving') : t('browserLibrary.remove')} cancelLabel={t('common.cancel')}
        onCancel={() => { if (!saving) setRemoving(null); }} onConfirm={saveRemoval} />, document.body) : null}
      {restoring ? createPortal(<ConfirmDialog title={t('browserLibrary.restore')} description={t('browserLibrary.restoreDescription')}
        destructive={false} confirmLabel={saving ? t('browserLibrary.saving') : t('browserLibrary.restore')} cancelLabel={t('common.cancel')}
        onCancel={() => { if (!saving) setRestoring(false); }} onConfirm={() => {
          if (saving) return; setSaving(true); setSaveError(false);
          void updateBrowserReferences(current => ({ ...current, hiddenUrls: [] })).then(() => setRestoring(false))
            .catch(() => { setSaveError(true); setRestoring(false); }).finally(() => setSaving(false));
        }} />, document.body) : null}
    </div>
  );
}

/** Original category illustrations, not screenshots or previews of third-party sites. */
function ReferenceCategoryArtwork({ category }: { category: 'interfaces' | 'type' | 'color' }) {
  if (category === 'type') return <svg viewBox="0 0 420 176" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="420" height="176" fill="#efece3" />
    <path d="M26 31H394M26 145H394M48 16V160M372 16V160" stroke="#bcb8ad" strokeWidth=".6" />
    <text x="44" y="134" fill="#272b27" fontFamily="Georgia, serif" fontSize="137" letterSpacing="-13">Aa</text>
    <text x="261" y="75" fill="#5b6257" fontFamily="Georgia, serif" fontSize="40" fontStyle="italic">&amp;</text>
    <text x="262" y="117" fill="#5b6257" fontFamily="monospace" fontSize="15" letterSpacing="5">0123</text>
    <circle cx="372" cy="31" r="3" fill="#668265" /><circle cx="48" cy="145" r="3" fill="#668265" />
  </svg>;
  if (category === 'color') return <svg viewBox="0 0 420 176" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="420" height="176" fill="#dce5dc" />
    <rect x="57" y="30" width="112" height="137" rx="5" fill="#db6746" transform="rotate(-12 113 98)" />
    <rect x="117" y="22" width="112" height="137" rx="5" fill="#ede9d7" transform="rotate(-4 173 90)" />
    <rect x="182" y="20" width="112" height="137" rx="5" fill="#b8cc95" transform="rotate(6 238 88)" />
    <rect x="243" y="32" width="112" height="137" rx="5" fill="#345c4b" transform="rotate(16 299 100)" />
    <path d="M267 124L329 141" stroke="#a4c0ad" strokeWidth="2" />
    <circle cx="299" cy="86" r="23" fill="#bfd0a4" /><circle cx="311" cy="86" r="23" fill="#345c4b" />
  </svg>;
  return <svg viewBox="0 0 420 176" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="420" height="176" fill="#e6ebdf" />
    <rect x="46" y="25" width="256" height="172" rx="8" fill="#fff" stroke="#d0d6d0" />
    <path d="M46 47H302" stroke="#e3e7e0" /><circle cx="59" cy="36" r="2" fill="#a0ac9d" /><circle cx="67" cy="36" r="2" fill="#c0c8bb" /><circle cx="75" cy="36" r="2" fill="#d9ded5" />
    <rect x="59" y="63" width="43" height="5" rx="2" fill="#4b5c4b" /><path d="M59 80H93M59 91H88M59 102H90M59 113H85" stroke="#d6dcd2" strokeWidth="4" />
    <rect x="119" y="61" width="161" height="61" rx="4" fill="#dde5d5" /><circle cx="248" cy="90" r="20" fill="#acbe97" />
    <path d="M132 76H185M132 86H172" stroke="#758b6d" strokeWidth="4" /><rect x="132" y="100" width="37" height="10" rx="5" fill="#42593c" />
    <rect x="119" y="131" width="76" height="44" rx="4" fill="#f0f2ec" /><rect x="203" y="131" width="77" height="44" rx="4" fill="#f0f2ec" />
    <rect x="287" y="51" width="88" height="154" rx="13" fill="#293d31" transform="rotate(8 331 128)" />
    <g transform="rotate(8 331 128)"><rect x="293" y="57" width="76" height="142" rx="9" fill="#f6f7ed" /><rect x="316" y="62" width="30" height="5" rx="3" fill="#293d31" /><circle cx="331" cy="104" r="23" fill="#b7c99b" /><path d="M309 143H354M309 154H340" stroke="#a5b499" strokeWidth="4" /><rect x="309" y="168" width="45" height="12" rx="6" fill="#42593c" /></g>
  </svg>;
}

function BrowserSiteIcon({
  className,
  fallback,
  iconUrl,
}: {
  className?: string;
  fallback: 'globe' | 'history';
  iconUrl?: string;
}) {
  const [failed, setFailed] = useState(false);
  const cleanUrl = cleanIconUrl(iconUrl);
  return (
    <span className={['db-site-icon', className].filter(Boolean).join(' ')}>
      {cleanUrl && !failed ? (
        <img alt="" src={cleanUrl} onError={() => setFailed(true)} />
      ) : (
        <Icon name={fallback} size={13} />
      )}
    </span>
  );
}

export function normalizeBrowserAddress(rawAddress: string): string {
  const value = rawAddress.trim();
  if (!value) return EMPTY_URL;
  if (value === EMPTY_URL) return EMPTY_URL;
  if (/^(https?|file):\/\//i.test(value)) return value;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(value)) return `http://${value}`;
  if (/^(127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(value)) return `http://${value}`;
  if (value.startsWith('/')) {
    if (/^\/(api|artifacts|frames)(\/|$)/.test(value) && typeof window !== 'undefined') {
      return new URL(value, window.location.origin).toString();
    }
    return `file://${encodeURI(value)}`;
  }
  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

export function labelFromUrl(url: string): string {
  if (url === EMPTY_URL) return 'New Tab';
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

export interface AddressDisplayParts {
  url: string;
  title?: string;
}

export function formatAddressDisplayParts(url: string, title?: string): AddressDisplayParts {
  if (url === EMPTY_URL) return { url: '' };
  const cleanTitle = title?.trim();
  if (!cleanTitle) return { url };
  const fallback = labelFromUrl(url);
  if (cleanTitle === fallback || cleanTitle === url) return { url };
  return { url: url.replace(/\/+$/, ''), title: cleanTitle };
}

export function formatAddressDisplay(url: string, title?: string): string {
  const parts = formatAddressDisplayParts(url, title);
  if (!parts.url) return '';
  if (!parts.title) return parts.url;
  return `${parts.url} / ${parts.title}`;
}

export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Slugs a reference site URL into the snake_case `site_id` reported by
// reference-board analytics: hostname minus the TLD, non-alphanumerics
// folded into underscores (`land-book.com` → `land_book`,
// `fonts.google.com` → `fonts_google`).
function referenceSiteId(url: string): string {
  const labels = hostnameFromUrl(url).toLowerCase().split('.');
  const slug = (labels.length > 1 ? labels.slice(0, -1) : labels)
    .join('_')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'unknown';
}

export function faviconUrl(url: string): string | undefined {
  if (!isHttpLikeUrl(url)) return undefined;
  try {
    return new URL('/favicon.ico', new URL(url).origin).toString();
  } catch {
    return undefined;
  }
}

/**
 * Resolve a reliable, colored favicon for a curated reference site.
 *
 * The Reference Board lists well-known public design sites, and many of them do
 * not serve a usable icon at `/favicon.ico` (wrong path, 404, or non-image), so
 * {@link faviconUrl} falls back to a flat grey globe for most of them. Routing
 * the request through a favicon service returns a real, correctly-sized brand
 * icon for essentially every domain, so the board shows actual logos instead.
 * Returns `undefined` for non-http(s) URLs so the globe fallback still applies.
 */
export function referenceIconUrl(url: string, size = 64): string | undefined {
  if (!isHttpLikeUrl(url)) return undefined;
  try {
    const host = new URL(url).hostname;
    if (!host) return undefined;
    return `https://www.google.com/s2/favicons?sz=${size}&domain=${encodeURIComponent(host)}`;
  } catch {
    return undefined;
  }
}

export function isHistoryUrl(url: string): boolean {
  return url !== EMPTY_URL && (isHttpLikeUrl(url) || /^file:\/\//i.test(url));
}

function isHttpLikeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function sameUrl(left: string, right: string): boolean {
  return left.replace(/\/+$/, '') === right.replace(/\/+$/, '');
}

function safeGetWebviewUrl(node: WebviewElement): string {
  try {
    return node.getURL();
  } catch {
    return '';
  }
}

function safeGetWebviewTitle(node: WebviewElement): string {
  try {
    return node.getTitle();
  } catch {
    return '';
  }
}

function cleanIconUrl(url?: string): string | undefined {
  const value = url?.trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) return value;
  return undefined;
}

function warmBrowserOrigin(url: string): void {
  if (typeof document === 'undefined' || !isHttpLikeUrl(url)) return;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return;
  }
  if (warmedOrigins.has(origin)) return;
  const links: HTMLLinkElement[] = [];
  for (const rel of ['dns-prefetch', 'preconnect']) {
    const link = document.createElement('link');
    link.rel = rel;
    link.href = origin;
    if (rel === 'preconnect') link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
    links.push(link);
  }
  warmedOrigins.set(origin, links);
  // FIFO-evict the oldest warmed origin once over the cap, removing its links.
  while (warmedOrigins.size > WARMED_ORIGIN_LIMIT) {
    const oldest = warmedOrigins.keys().next().value as string | undefined;
    if (oldest == null) break;
    warmedOrigins.get(oldest)?.forEach((link) => link.remove());
    warmedOrigins.delete(oldest);
  }
}

function canUseNativeHistoryNavigation(node: WebviewElement, delta: -1 | 1): boolean {
  try {
    if (delta < 0) return typeof node.canGoBack === 'function' && node.canGoBack();
    return typeof node.canGoForward === 'function' && node.canGoForward();
  } catch {
    return false;
  }
}

function imageSizeFromDataUrl(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({
      w: Math.max(1, img.naturalWidth || img.width),
      h: Math.max(1, img.naturalHeight || img.height),
    });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function cropDataUrl(
  dataUrl: string,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Promise<{ dataUrl: string; w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const naturalW = Math.max(1, img.naturalWidth || img.width);
        const naturalH = Math.max(1, img.naturalHeight || img.height);
        const cx = Math.max(0, Math.min(Math.round(sx), naturalW - 1));
        const cy = Math.max(0, Math.min(Math.round(sy), naturalH - 1));
        const cw = Math.max(1, Math.min(Math.round(sw), naturalW - cx));
        const ch = Math.max(1, Math.min(Math.round(sh), naturalH - cy));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
        resolve({ dataUrl: canvas.toDataURL('image/png'), w: cw, h: ch });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export function browserFileName(prefix: string, url: string, extension: 'md' | 'png'): string {
  const host = labelFromUrl(url).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'page';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `browser/${prefix}-${host}-${stamp}.${extension}`;
}

function pageSnapshotAbortError(): Error {
  const error = new Error('Page snapshot canceled.');
  error.name = 'AbortError';
  return error;
}

function isPageSnapshotAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function throwIfPageSnapshotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw pageSnapshotAbortError();
}

function abortablePageSnapshotPromise<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(pageSnapshotAbortError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => settle(() => reject(pageSnapshotAbortError()));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

function pageSnapshotRunElapsedSeconds(run: { startedAt: number }): number {
  return Math.max(0, Math.floor((Date.now() - run.startedAt) / 1000));
}

function formatBrowserSnapshotElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

function browserPageArchiveDir(url: string, date = new Date()): string {
  const host = labelFromUrl(url).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'page';
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `browser/snapshots/${host}-${stamp}`;
}

function isBrowserPageArchiveCapture(value: unknown): value is BrowserPageArchiveCapture {
  if (!value || typeof value !== 'object') return false;
  const capture = value as Partial<BrowserPageArchiveCapture>;
  return (
    typeof capture.url === 'string' &&
    typeof capture.html === 'string' &&
    typeof capture.css === 'string' &&
    Array.isArray(capture.resources)
  );
}

// Writes a captured page image onto the system clipboard via the async
// Clipboard API. Decodes the data URL locally (no fetch) so it works under a
// strict connect-src CSP, and returns false instead of throwing when the
// browser lacks ClipboardItem or the write is blocked, so the caller can still
// fall back to the saved-to-project confirmation.
async function copyImageToClipboard(dataUrl: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
    const [header = '', base64 = ''] = dataUrl.split(',', 2);
    const mime = /^data:([^;,]+)/.exec(header)?.[1] || 'image/png';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const blob = new Blob([bytes], { type: mime });
    await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
    return true;
  } catch {
    return false;
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall back for desktop/web contexts where clipboard permission is blocked.
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}
