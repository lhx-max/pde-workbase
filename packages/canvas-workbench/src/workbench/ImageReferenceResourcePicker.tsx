'use client';
import { ir } from '../locales/image-reference-picker';

import React from 'react';
import { platformFetch as fetch } from '../platform/api-base';
import { Button } from '@bezier/components';

import {
  requireCanvasDialogRenderer,
  requireCanvasTabsRenderer,
  useCanvasUiHost,
  type CanvasDialogRenderProps,
  type CanvasDialogRenderer,
  type CanvasResourceGridItem,
  type CanvasResourceGridRenderProps,
  type CanvasResourceGridRenderer,
  type CanvasTabsRenderer,
  type CanvasAssetPickerRenderer,
} from '../platform/ui-host';
import { imageFileUrl } from './ImageAssetNode';
import { CanvasSelectionItem } from './CanvasSelectionItem';
import { CompositionSafeInput } from './CompositionSafeField';

export type ReferenceUploadFiles = FileList | readonly File[] | null;

export type ResourceDialogRenderProps = CanvasDialogRenderProps;
export type ResourceDialogRenderer = CanvasDialogRenderer;

export type ResourceDialogTitleRenderer = (props: {
  id: string;
  children: React.ReactNode;
}) => React.ReactNode;

export type ImageReferenceResourceGridItem = CanvasResourceGridItem;
export type ImageReferenceResourceGridRenderProps = CanvasResourceGridRenderProps;
export type ImageReferenceResourceGridRenderer = CanvasResourceGridRenderer;

export type CanvasReferenceResourceKind = 'image' | 'video' | 'audio';

export type CanvasReferenceResource = {
  id: string;
  name: string;
  path?: string;
  src?: string;
  kind?: CanvasReferenceResourceKind;
  mimeType?: string;
};

export type PositiveOperationReferenceAsset = {
  id: string;
  business: string;
  businessLabel: string;
  styleId: string;
  styleName: string;
  title: string;
  prompt?: string;
  posterUrl: string;
  originalUrl: string;
};

export type ReferenceImageAsset = {
  id: string;
  business: string;
  businessLabel: string;
  styleId: string;
  styleName: string;
  title: string;
  prompt?: string;
  posterUrl: string;
  originalUrl: string;
};

export type PresentationTemplateReference = {
  id: string;
  title: string;
  description: string;
  category: string;
  posterUrl: string;
  previewSrc?: string;
  previewVideoUrl?: string;
  referencePath: string;
  prompt: string;
};

export type WebpageTemplateReference = PresentationTemplateReference;

export type CanvasDesignSystemReference = {
  id: string;
  title: string;
  category: string;
  summary: string;
  swatches?: string[];
};

type CanvasDesignSystemDetail = CanvasDesignSystemReference & {
  body?: string;
};

type ImageLibraryTemplatePayload = {
  ok?: boolean;
  templates?: ReferenceImageAsset[];
  status?: { message?: string };
  error?: { message?: string };
};

type DesignTemplatePayload = {
  designTemplates?: Array<{
    id: string;
    name: string;
    displayName?: Record<string, string>;
    description: string;
    descriptionI18n?: Record<string, string>;
    mode: string;
    category?: string | null;
    examplePrompt: string;
    examplePromptI18n?: Record<string, string>;
    previewType?: string;
    hasExamplePreview?: boolean;
    bakedPreview?: { poster?: string | null; video?: string | null } | null;
  }>;
};

function MiniMaxImagePlaceholderIcon() {
  return (
    <svg viewBox="0 0 56 56" aria-hidden="true">
      <rect x="7" y="8" width="42" height="40" rx="5" fill="currentColor" opacity="0.72" />
      <circle cx="38" cy="19" r="3.2" fill="#fff" />
      <path d="m12 43 11.5-18 8 11 5-6 8.5 13H12Z" fill="#fff" />
    </svg>
  );
}

function MediaReferencePlaceholderIcon({ kind }: { kind: CanvasReferenceResourceKind }) {
  if (kind === 'audio') {
    return <svg viewBox="0 0 56 56" aria-hidden="true"><path d="M23 39V16l20-4v22" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><circle cx="17" cy="40" r="7" fill="currentColor" /><circle cx="37" cy="35" r="7" fill="currentColor" /></svg>;
  }
  if (kind === 'video') {
    return <svg viewBox="0 0 56 56" aria-hidden="true"><rect x="7" y="12" width="42" height="32" rx="5" fill="currentColor" opacity=".72" /><path d="m24 21 14 7-14 7V21Z" fill="#fff" /></svg>;
  }
  return <MiniMaxImagePlaceholderIcon />;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('jpeg')) return '.jpg';
  if (mimeType.includes('webp')) return '.webp';
  if (mimeType.includes('gif')) return '.gif';
  return '.png';
}

function safeAssetFileName(title: string, mimeType: string, index: number): string {
  const stem = title
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || ir().libraryImageName(index + 1);
  return `${stem}${extensionForMimeType(mimeType)}`;
}

function colorLuminance(color: string): number {
  const normalized = color.trim().replace(/^#/, '');
  const hex = normalized.length === 3
    ? normalized.split('').map(value => `${value}${value}`).join('')
    : normalized;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return 0.5;
  const channels = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

export async function downloadReferenceAssets(
  assets: readonly ReferenceImageAsset[],
  fetcher: typeof fetch = fetch,
): Promise<File[]> {
  return Promise.all(assets.map(async (asset, index) => {
    const response = await fetcher(asset.originalUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(ir().readAssetFailed(asset.title));
    const blob = await response.blob();
    return new File(
      [blob],
      safeAssetFileName(asset.title, blob.type || 'image/png', index),
      { type: blob.type || 'image/png', lastModified: Date.now() },
    );
  }));
}

export type ImageReferencePickerProps = React.ComponentProps<typeof LegacyImageReferenceResourcePicker> & {
  renderAssetPicker?: CanvasAssetPickerRenderer;
};

export function ImageReferenceResourcePicker(props: ImageReferencePickerProps) {
  const host = useCanvasUiHost();
  const render = props.renderAssetPicker ?? host?.renderAssetPicker;
  return render ? render({ ...props, kind: 'media', resources: props.resources.map(resource => ({
    ...resource, src: resource.path ? imageFileUrl(resource.path) : resource.src,
  })) }) : <LegacyImageReferenceResourcePicker {...props} />;
}

function LegacyImageReferenceResourcePicker({
  open,
  resources,
  acceptedKinds = ['image'],
  libraryOnly = false,
  includeLibraryTab = false,
  initialSource,
  libraryAvailable = true,
  singleSelection = false,
  onClose,
  onUseCanvas,
  onUseLibrary,
  onUpload,
  renderDialog,
  renderGrid,
  renderTitle,
  renderTabs,
}: {
  open: boolean;
  resources: CanvasReferenceResource[];
  acceptedKinds?: readonly CanvasReferenceResourceKind[];
  libraryOnly?: boolean;
  includeLibraryTab?: boolean;
  /** Source shown when the picker opens. The host maps library to its space assets. */
  initialSource?: 'canvas' | 'library' | 'upload';
  /** Whether the current product provides the template-library data source. */
  libraryAvailable?: boolean;
  singleSelection?: boolean;
  onClose: () => void;
  onUseCanvas: (assetIds: string[]) => void;
  onUseLibrary: (
    files: readonly File[],
    assets: readonly ReferenceImageAsset[],
  ) => boolean | void | Promise<boolean | void>;
  onUpload: (files: ReferenceUploadFiles) => boolean | void | Promise<boolean | void>;
  renderDialog?: ResourceDialogRenderer;
  renderGrid?: ImageReferenceResourceGridRenderer;
  renderTitle?: ResourceDialogTitleRenderer;
  renderTabs?: CanvasTabsRenderer;
}) {
  const uiHost = useCanvasUiHost();
  const mediaMode = acceptedKinds.some(kind => kind !== 'image');
  const dialogRenderer = requireCanvasDialogRenderer(uiHost, renderDialog);
  const tabsRenderer = requireCanvasTabsRenderer(uiHost, renderTabs);
  const [tab, setTab] = React.useState<'canvas' | 'library' | 'upload'>(libraryOnly ? 'library' : initialSource ?? 'canvas');
  const [query, setQuery] = React.useState('');
  const [selectedCanvasIds, setSelectedCanvasIds] = React.useState<string[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = React.useState<string[]>([]);
  const [libraryAssets, setLibraryAssets] = React.useState<ReferenceImageAsset[]>([]);
  const [libraryLoading, setLibraryLoading] = React.useState(false);
  const [libraryMessage, setLibraryMessage] = React.useState('');
  const [uploadMessage, setUploadMessage] = React.useState('');
  const [activeBusiness, setActiveBusiness] = React.useState('all');
  const [applying, setApplying] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTab(libraryOnly ? 'library' : initialSource ?? 'canvas');
    setQuery('');
    setSelectedCanvasIds([]);
    setSelectedLibraryIds([]);
    setActiveBusiness('all');
    setApplying(false);
    setUploadMessage('');
  }, [initialSource, libraryOnly, open]);

  React.useEffect(() => {
    if (!open || (!libraryOnly && !includeLibraryTab)) return;
    if (!libraryAvailable) {
      setLibraryAssets([]);
      setLibraryLoading(false);
      setLibraryMessage('');
      return;
    }
    let active = true;
    setLibraryLoading(true);
    setLibraryMessage('');
    void fetch('/api/image-library-templates', { cache: 'no-store' })
      .then(async response => {
        if (response.status === 404 || !response.headers.get('content-type')?.includes('application/json')) {
          throw new Error(ir().noWorkbenchLibrary);
        }
        const payload = await response.json() as ImageLibraryTemplatePayload;
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error?.message || ir().libraryLoadFailed);
        }
        if (!active) return;
        setLibraryAssets(Array.isArray(payload.templates) ? payload.templates : []);
        setLibraryMessage(payload.status?.message ?? '');
      })
      .catch(error => {
        if (!active) return;
        setLibraryAssets([]);
        setLibraryMessage(libraryOnly
          ? ir().noImageTemplates
          : (error instanceof Error ? error.message : ir().libraryLoadFailed));
      })
      .finally(() => {
        if (active) setLibraryLoading(false);
      });
    return () => { active = false; };
  }, [includeLibraryTab, libraryAvailable, libraryOnly, open]);

  if (typeof document === 'undefined') return null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredCanvas = resources.filter(resource => (
    acceptedKinds.includes(resource.kind || 'image')
    && (!normalizedQuery || resource.name.toLocaleLowerCase().includes(normalizedQuery))
  ));
  const filteredLibrary = libraryAssets.filter(asset => (
    (activeBusiness === 'all' || asset.business === activeBusiness)
    && (!normalizedQuery || `${asset.title} ${asset.styleName} ${asset.businessLabel}`.toLocaleLowerCase().includes(normalizedQuery))
  ));
  const libraryBusinessOptions = Array.from(
    new Map(libraryAssets.map(asset => [asset.business, asset.businessLabel])).entries(),
  );
  const selectedCount = tab === 'canvas' ? selectedCanvasIds.length : selectedLibraryIds.length;
  const activeItems = tab === 'canvas'
    ? filteredCanvas.map(resource => ({
      id: resource.id,
      name: resource.name,
      meta: mediaMode ? (resource.kind === 'audio' ? ir().audio : resource.kind === 'video' ? ir().video : ir().image) : '',
      preview: resource.path ? imageFileUrl(resource.path) : resource.src,
      kind: resource.kind || 'image',
      checked: selectedCanvasIds.includes(resource.id),
    }))
    : filteredLibrary.map(asset => ({
      id: asset.id,
      name: asset.title,
      meta: `${asset.businessLabel} · ${asset.styleName}`,
      preview: asset.posterUrl,
      kind: 'image' as const,
      checked: selectedLibraryIds.includes(asset.id),
    }));

  const selectSource = (nextTab: 'canvas' | 'library' | 'upload') => {
    setTab(nextTab);
    setQuery('');
    setUploadMessage('');
  };
  const toggle = (id: string) => {
    const setter = tab === 'canvas' ? setSelectedCanvasIds : setSelectedLibraryIds;
    setter(current => current.includes(id)
      ? current.filter(item => item !== id)
      : singleSelection ? [id] : [...current, id]);
  };
  const applySelection = async () => {
    if (!selectedCount || applying) return;
    if (tab === 'canvas') {
      onUseCanvas(selectedCanvasIds);
      return;
    }
    setApplying(true);
    setLibraryMessage('');
    try {
      const selected = libraryAssets.filter(asset => selectedLibraryIds.includes(asset.id));
      const files = await downloadReferenceAssets(selected);
      const accepted = await onUseLibrary(files, selected);
      if (accepted === false) {
        setApplying(false);
        return;
      }
      onClose();
    } catch (error) {
      setLibraryMessage(error instanceof Error ? error.message : ir().addAssetFailed);
      setApplying(false);
    }
  };

  const dialogContent = (
    <>
        <header className="minimax-resource-head">
          {renderTitle
            ? renderTitle({
              id: 'minimax-resource-title',
              children: libraryOnly ? ir().pickImageTemplate : mediaMode ? ir().pickClipMedia : ir().pickResource,
            })
            : <h2 id="minimax-resource-title">{libraryOnly ? ir().pickImageTemplate : mediaMode ? ir().pickClipMedia : ir().pickResource}</h2>}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={ir().closePicker}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4l12 12M16 4 4 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </Button>
        </header>

        {!libraryOnly && (
          <div className="minimax-resource-sourcebar">
            {tabsRenderer({
              value: tab,
              onValueChange: value => selectSource(value as 'canvas' | 'library' | 'upload'),
              ariaLabel: ir().resourceSource,
              className: 'minimax-resource-tabs',
              items: [
                { value: 'canvas', label: <>{ir().onCanvas} <span>({resources.length})</span></> },
                ...(includeLibraryTab
                  ? [{ value: 'library', label: <>{ir().assetLibrary} <span>({libraryAssets.length})</span></> }]
                  : []),
                { value: 'upload', label: ir().localUpload },
              ],
            })}
            {tab !== 'upload' && (
              <label className="minimax-resource-search">
                <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                <CompositionSafeInput value={query} onValueChange={setQuery} placeholder={ir().searchResources} />
              </label>
            )}
          </div>
        )}

        {tab === 'library' && !libraryOnly && (
          <div className="minimax-resource-library-filters">
            <div className="minimax-resource-library-category" aria-label={ir().libraryCategory}>
              <span>{ir().templateCategory}</span>
            </div>
          </div>
        )}

        {tab !== 'upload' ? (
          <>
            {tab === 'library' && <div className={`minimax-resource-tools is-library is-businesses${libraryOnly ? ' is-library-only' : ''}`}>
              {!libraryOnly && tabsRenderer?.({
                  value: activeBusiness,
                  onValueChange: setActiveBusiness,
                  ariaLabel: ir().templateCategory,
                  className: 'minimax-resource-library-businesses',
                  items: [
                    { value: 'all', label: ir().all },
                    ...libraryBusinessOptions.map(([business, label]) => ({ value: business, label })),
                  ],
                })}
              {libraryOnly && (
                <label className="minimax-resource-search">
                  <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  <CompositionSafeInput value={query} onValueChange={setQuery} placeholder={ir().searchResources} />
                </label>
              )}
            </div>}
            {(() => {
              const emptyState = !activeItems.length ? (
                <div className="minimax-resource-empty">
                  {tab === 'library'
                    ? (libraryLoading ? ir().readingImageTemplates : (libraryMessage || (libraryAssets.length ? ir().noMatchingImageTemplates : ir().noImageTemplates)))
                    : (resources.length ? ir().noMatchingResources : mediaMode ? ir().noCanvasMedia : ir().noCanvasImages)}
                </div>
              ) : null;
              if (renderGrid) {
                return renderGrid({ items: activeItems, onToggle: toggle, emptyState });
              }
              return (
                <div className={`minimax-resource-results is-grid ${tab === 'library' ? 'is-library' : ''}`}>
                  {activeItems.map(item => (
                    <CanvasSelectionItem key={item.id} selected={item.checked} selectedClassName="is-selected" onClick={() => toggle(item.id)}>
                      <span className="minimax-resource-thumb">
                        {item.preview && item.kind === 'image' ? <img src={item.preview} alt="" draggable={false} /> : null}
                        {item.preview && item.kind === 'video' ? <video src={item.preview} muted preload="metadata" playsInline /> : null}
                        {!item.preview || item.kind === 'audio' ? <MediaReferencePlaceholderIcon kind={item.kind || 'image'} /> : null}
                        {item.checked && <i aria-hidden="true">✓</i>}
                      </span>
                      <span className="minimax-resource-label" title={item.name}>
                        <b>{item.name}</b>
                        {item.meta && <small>{item.meta}</small>}
                      </span>
                    </CanvasSelectionItem>
                  ))}
                  {emptyState}
                </div>
              );
            })()}
          </>
        ) : (
          <label className="minimax-resource-upload">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <strong>{applying ? ir().adding : mediaMode ? ir().pickLocalMedia : ir().pickLocalImages}</strong>
            <span>{mediaMode ? ir().supportMediaMulti : ir().supportImageMulti}</span>
            <input type="file" accept={acceptedKinds.map(kind => `${kind}/*`).join(',')} multiple={!singleSelection} disabled={applying} onChange={event => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              if (!files.length) return;
              setApplying(true);
              setUploadMessage('');
              void Promise.resolve(onUpload(files))
                .then(accepted => {
                  if (accepted === false) {
                    setUploadMessage(ir().addFailedRetry);
                    return;
                  }
                  onClose();
                })
                .catch(error => setUploadMessage(error instanceof Error ? error.message : ir().addFailedRetry))
                .finally(() => setApplying(false));
            }} />
          </label>
        )}

        {tab === 'upload' && uploadMessage ? <div className="minimax-resource-upload-message" role="alert">{uploadMessage}</div> : null}

        {tab === 'library' && libraryMessage.includes(ir().failed) && libraryAssets.length > 0 && (
          <div className="minimax-resource-library-message" role="alert">{libraryMessage}</div>
        )}
        <footer className="minimax-resource-actions">
          <Button variant="ghost" onClick={onClose}>{ir().cancel}</Button>
          {tab !== 'upload' && (
            <Button variant="primary" className="is-primary" disabled={!selectedCount || applying} onClick={() => { void applySelection(); }}>
              {applying ? ir().adding : ir().useCount(selectedCount)}
            </Button>
          )}
        </footer>
    </>
  );
  return dialogRenderer({
    open,
    onOpenChange: nextOpen => { if (!nextOpen) onClose(); },
    children: dialogContent,
    className: 'canvas-workbench minimax-resource-dialog',
    ariaLabelledBy: 'minimax-resource-title',
  });
}

export type ArtifactTemplatePickerProps = React.ComponentProps<typeof LegacyArtifactTemplateResourcePicker> & {
  renderAssetPicker?: CanvasAssetPickerRenderer;
};

function ArtifactTemplateResourcePicker(props: ArtifactTemplatePickerProps) {
  const host = useCanvasUiHost();
  const render = props.renderAssetPicker ?? host?.renderAssetPicker;
  return render ? render({ ...props, kind: 'artifact' }) : <LegacyArtifactTemplateResourcePicker {...props} />;
}

function LegacyArtifactTemplateResourcePicker({
  open,
  selectedId,
  mode,
  artifactLabel,
  onClose,
  onSelect,
  renderDialog,
  renderGrid,
  renderTabs,
  renderCategories,
  formatCategory,
}: {
  open: boolean;
  selectedId?: string | null;
  mode: 'deck' | 'prototype' | 'text';
  artifactLabel: string;
  onClose: () => void;
  onSelect: (template: PresentationTemplateReference) => void;
  renderDialog?: ResourceDialogRenderer;
  renderGrid?: ImageReferenceResourceGridRenderer;
  renderTabs?: CanvasTabsRenderer;
  renderCategories?: CanvasTabsRenderer;
  formatCategory?: (category: string) => string;
}) {
  const uiHost = useCanvasUiHost();
  const dialogRenderer = requireCanvasDialogRenderer(uiHost, renderDialog);
  const tabsRenderer = requireCanvasTabsRenderer(uiHost, renderTabs);
  const categoryRenderer = renderCategories ?? uiHost?.renderTemplateCategories ?? tabsRenderer;
  const gridRenderer = renderGrid ?? uiHost?.renderTemplateGrid;
  const categoryLabel = formatCategory ?? uiHost?.formatTemplateCategory ?? ((category: string) => category);
  const [query, setQuery] = React.useState('');
  const [activeCategory, setActiveCategory] = React.useState('all');
  const [templates, setTemplates] = React.useState<PresentationTemplateReference[]>([]);
  const [pendingId, setPendingId] = React.useState(selectedId ?? '');
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveCategory('all');
    setPendingId(selectedId ?? '');
  }, [open, selectedId]);

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setMessage('');
    void fetch('/api/design-templates', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(ir().artifactTemplateFailed(artifactLabel));
        const payload = await response.json() as DesignTemplatePayload;
        if (!active) return;
        const rows = Array.isArray(payload.designTemplates) ? payload.designTemplates : [];
        setTemplates(rows
          .filter(template => template.mode === mode)
          .map(template => ({
            id: template.id,
            title: template.displayName?.['zh-CN'] || template.name,
            description: template.descriptionI18n?.['zh-CN'] || template.description,
            category: template.category?.trim() || ir().general,
            posterUrl: template.bakedPreview?.poster || '',
            previewSrc: template.previewType === 'html' && template.hasExamplePreview !== false
              ? `/api/skills/${encodeURIComponent(template.id)}/example`
              : '',
            previewVideoUrl: template.bakedPreview?.video || '',
            referencePath: `design-templates/${template.id}/TEMPLATE.md`,
            prompt: template.examplePromptI18n?.['zh-CN'] || template.examplePrompt,
          })));
      })
      .catch(error => {
        if (active) setMessage(error instanceof Error ? error.message : ir().artifactTemplateFailed(artifactLabel));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [artifactLabel, mode, open]);

  if (typeof document === 'undefined') return null;
  // Automatic matching is the absence of an explicit template, not a
  // selectable library asset. Keep the picker limited to real templates.
  const availableTemplates = templates;
  const categories = Array.from(new Set(availableTemplates.map(template => template.category)));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredTemplates = availableTemplates.filter(template => (
    (activeCategory === 'all' || template.category === activeCategory)
    && (!normalizedQuery || `${template.title} ${template.description} ${template.category}`.toLocaleLowerCase().includes(normalizedQuery))
  ));
  const selectedTemplate = availableTemplates.find(template => template.id === pendingId) ?? null;
  const gridItems = filteredTemplates.map(template => ({
    id: template.id,
    name: template.title,
    meta: categoryLabel(template.category),
    preview: template.posterUrl || undefined,
    checked: pendingId === template.id,
    ...(mode !== 'text' ? { templatePreview: {
      type: mode,
      previewSrc: template.previewSrc || undefined,
      videoUrl: template.previewVideoUrl || undefined,
    } } : {}),
  }));
  const gridEmptyState = !filteredTemplates.length
    ? <div className="minimax-resource-empty">{loading ? ir().readingArtifactTemplates(artifactLabel) : (message || (templates.length ? ir().noMatchingArtifactTemplates(artifactLabel) : ir().noArtifactTemplates(artifactLabel)))}</div>
    : null;

  const dialogContent = (
    <>
        <header className="minimax-resource-head">
          <h2 id="presentation-template-resource-title">{ir().pickArtifactTemplate(artifactLabel)}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={ir().closeArtifactLibrary(artifactLabel)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4l12 12M16 4 4 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </Button>
        </header>
        <div className="minimax-resource-tools is-library">
          {categoryRenderer({
            value: activeCategory,
            onValueChange: setActiveCategory,
            ariaLabel: ir().artifactCategory(artifactLabel),
            className: 'minimax-resource-library-businesses',
            items: [
              { value: 'all', label: ir().all },
              ...categories.map(category => ({
                value: category,
                label: categoryLabel(category),
              })),
            ],
          })}
          <label className="minimax-resource-search">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <CompositionSafeInput value={query} onValueChange={setQuery} placeholder={ir().searchArtifactTemplates(artifactLabel)} />
          </label>
        </div>
        {gridRenderer
          ? gridRenderer({ items: gridItems, onToggle: setPendingId, emptyState: gridEmptyState })
          : (
            <div className="minimax-resource-results is-grid is-library">
              {filteredTemplates.map(template => (
                <CanvasSelectionItem key={template.id} selected={pendingId === template.id} selectedClassName="is-selected" onClick={() => setPendingId(template.id)}>
                  <span className="minimax-resource-thumb is-artifact-template">
                    {template.posterUrl ? <img src={template.posterUrl} alt="" draggable={false} /> : <MiniMaxImagePlaceholderIcon />}
                    {pendingId === template.id && <i aria-hidden="true">✓</i>}
                  </span>
                  <span className="minimax-resource-label" title={template.title}>
                    <b>{template.title}</b><small>{template.category}</small>
                  </span>
                </CanvasSelectionItem>
              ))}
              {gridEmptyState}
            </div>
          )}
        <footer className="minimax-resource-actions">
          <Button variant="ghost" onClick={onClose}>{ir().cancel}</Button>
          <Button variant="primary" className="is-primary" disabled={!selectedTemplate} onClick={() => { if (!selectedTemplate) return; onSelect(selectedTemplate); onClose(); }}>{ir().useTemplate}</Button>
        </footer>
    </>
  );
  return dialogRenderer({
    open,
    onOpenChange: nextOpen => { if (!nextOpen) onClose(); },
    children: dialogContent,
    className: 'canvas-workbench minimax-resource-dialog',
    ariaLabelledBy: 'presentation-template-resource-title',
  });
}

export function TextTemplateResourcePicker(props: Omit<ArtifactTemplatePickerProps, 'mode' | 'artifactLabel'>) {
  return <ArtifactTemplateResourcePicker {...props} mode="text" artifactLabel={ir().text} />;
}

export function PresentationTemplateResourcePicker(props: {
  renderAssetPicker?: CanvasAssetPickerRenderer;
  open: boolean;
  selectedId?: string | null;
  onClose: () => void;
  onSelect: (template: PresentationTemplateReference) => void;
  renderDialog?: ResourceDialogRenderer;
  renderGrid?: ImageReferenceResourceGridRenderer;
  renderTabs?: CanvasTabsRenderer;
  renderCategories?: CanvasTabsRenderer;
  formatCategory?: (category: string) => string;
}) {
  return <ArtifactTemplateResourcePicker {...props} mode="deck" artifactLabel="PPT" />;
}

export function WebpageTemplateResourcePicker(props: {
  renderAssetPicker?: CanvasAssetPickerRenderer;
  open: boolean;
  selectedId?: string | null;
  onClose: () => void;
  onSelect: (template: WebpageTemplateReference) => void;
  renderDialog?: ResourceDialogRenderer;
  renderGrid?: ImageReferenceResourceGridRenderer;
  renderTabs?: CanvasTabsRenderer;
  renderCategories?: CanvasTabsRenderer;
  formatCategory?: (category: string) => string;
}) {
  return <ArtifactTemplateResourcePicker {...props} mode="prototype" artifactLabel={ir().web} />;
}

export type CanvasDesignSystemPickerProps = React.ComponentProps<typeof LegacyCanvasDesignSystemResourcePicker>;

export function CanvasDesignSystemResourcePicker(props: CanvasDesignSystemPickerProps) {
  const host = useCanvasUiHost();
  return host?.renderAssetPicker ? host.renderAssetPicker({...props, kind: 'design-system'}) : <LegacyCanvasDesignSystemResourcePicker {...props}/>;
}

function LegacyCanvasDesignSystemResourcePicker({
  open,
  selectedId,
  onClose,
  onSelect,
  renderDialog,
}: {
  open: boolean;
  selectedId?: string | null;
  onClose: () => void;
  onSelect: (system: CanvasDesignSystemReference | null) => void;
  renderDialog?: ResourceDialogRenderer;
}) {
  const uiHost = useCanvasUiHost();
  const dialogRenderer = requireCanvasDialogRenderer(uiHost, renderDialog);
  const [query, setQuery] = React.useState('');
  const [systems, setSystems] = React.useState<CanvasDesignSystemReference[]>([]);
  const [pendingId, setPendingId] = React.useState(selectedId ?? '');
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [detail, setDetail] = React.useState<CanvasDesignSystemDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [showcaseHtml, setShowcaseHtml] = React.useState('');
  const [showcaseLoading, setShowcaseLoading] = React.useState(false);
  const [showcaseFailed, setShowcaseFailed] = React.useState(false);
  const detailCache = React.useRef(new Map<string, CanvasDesignSystemDetail>());
  const showcaseCache = React.useRef(new Map<string, string>());

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setPendingId(selectedId ?? '');
  }, [open, selectedId]);

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setMessage('');
    void fetch('/api/design-systems', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(ir().designSystemLoadFailed);
        const payload = await response.json() as {
          designSystems?: Array<CanvasDesignSystemReference & { surface?: string }>;
        };
        if (!active) return;
        setSystems((payload.designSystems || [])
          .filter(system => !system.surface || system.surface === 'web')
          .map(system => ({
            id: system.id,
            title: system.title,
            category: system.category || ir().general,
            summary: system.summary || '',
            ...(system.swatches?.length ? { swatches: system.swatches } : {}),
          })));
      })
      .catch(error => {
        if (active) setMessage(error instanceof Error ? error.message : ir().designSystemLoadFailed);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [open]);

  React.useEffect(() => {
    if (!open || !pendingId) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    const cached = detailCache.current.get(pendingId);
    if (cached) {
      setDetail(cached);
      setDetailLoading(false);
      return;
    }
    let active = true;
    setDetail(null);
    setDetailLoading(true);
    void fetch(`/api/design-systems/${encodeURIComponent(pendingId)}`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(ir().designDetailFailed);
        const payload = await response.json() as CanvasDesignSystemDetail & {
          designSystem?: CanvasDesignSystemDetail;
        };
        if (!active) return;
        const resolved = payload.designSystem
          ? { ...payload.designSystem, body: payload.body || payload.designSystem.body }
          : payload;
        detailCache.current.set(pendingId, resolved);
        setDetail(resolved);
      })
      .catch(() => {
        if (active) setDetail(null);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => { active = false; };
  }, [open, pendingId]);

  React.useEffect(() => {
    if (!open || !pendingId) {
      setShowcaseHtml('');
      setShowcaseLoading(false);
      setShowcaseFailed(false);
      return;
    }
    const cached = showcaseCache.current.get(pendingId);
    if (cached) {
      setShowcaseHtml(cached);
      setShowcaseLoading(false);
      setShowcaseFailed(false);
      return;
    }
    let active = true;
    setShowcaseHtml('');
    setShowcaseLoading(true);
    setShowcaseFailed(false);
    void fetch(`/api/design-systems/${encodeURIComponent(pendingId)}/showcase`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(ir().designPreviewFailed);
        const html = await response.text();
        if (!html.trim()) throw new Error(ir().designPreviewEmpty);
        if (!active) return;
        showcaseCache.current.set(pendingId, html);
        setShowcaseHtml(html);
      })
      .catch(() => {
        if (active) setShowcaseFailed(true);
      })
      .finally(() => {
        if (active) setShowcaseLoading(false);
      });
    return () => { active = false; };
  }, [open, pendingId]);

  if (typeof document === 'undefined') return null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredSystems = systems.filter(system => (
    !normalizedQuery
    || `${system.title} ${system.category} ${system.summary}`.toLocaleLowerCase().includes(normalizedQuery)
  ));
  const selectedSystem = systems.find(system => system.id === pendingId) ?? null;
  const previewSystem = detail || selectedSystem;
  const palette = (previewSystem?.swatches?.length
    ? previewSystem.swatches
    : ['#ffffff', '#f4f4f1', '#171717', '#6b5cff']).slice(0, 4);
  const paletteByLightness = [...palette].sort((left, right) => colorLuminance(left) - colorLuminance(right));
  const previewBackground = paletteByLightness.at(-1) || '#ffffff';
  const previewSurface = paletteByLightness.at(-2) || '#f4f4f1';
  const darkestColor = paletteByLightness[0] || '#171717';
  const previewText = colorLuminance(darkestColor) < 0.22 ? darkestColor : '#171717';
  const previewAccent = palette.at(-1) || darkestColor || '#6b5cff';
  const visualStyle = detail?.body?.match(/\*\*Visual style:\*\*\s*([^\n]+)/i)?.[1]?.trim()
    || detail?.body?.match(/\*\*视觉风格：\*\*\s*([^\n]+)/i)?.[1]?.trim()
    || previewSystem?.summary
    || ir().designSystemHint;

  const dialogContent = (
    <>
        <header className="minimax-resource-head">
          <h2 id="canvas-design-system-resource-title">{ir().pickAiDesignSystem}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={ir().closeAiDesignSystem}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4l12 12M16 4 4 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </Button>
        </header>
        <div className="canvas-design-system-layout">
          <aside className="canvas-design-system-sidebar">
            <label className="minimax-resource-search canvas-design-system-search">
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              <CompositionSafeInput value={query} onValueChange={setQuery} placeholder={ir().searchDesignSystems} />
            </label>
            <div className="canvas-design-system-list" role="listbox" aria-label={ir().webDesignSystem}>
              <CanvasSelectionItem selected={!pendingId} semantics="selected" selectedClassName="is-selected" role="option" className="canvas-design-system-item is-default" onClick={() => setPendingId('')}>
                <span className="canvas-design-system-default-icon" aria-hidden="true">◌</span>
                <span className="canvas-design-system-item-copy"><strong>{ir().followProjectDefault}</strong><small>{ir().useProjectDesignSystem}</small></span>
                {!pendingId && <span className="canvas-design-system-check" aria-hidden="true">✓</span>}
              </CanvasSelectionItem>
              {filteredSystems.map(system => (
                <CanvasSelectionItem key={system.id} selected={pendingId === system.id} semantics="selected" selectedClassName="is-selected" role="option" className="canvas-design-system-item" onClick={() => setPendingId(system.id)}>
                  <span className="canvas-design-system-item-swatches" aria-hidden="true">
                    {(system.swatches?.length ? system.swatches : ['#f4f4f1', '#171717', '#6b5cff']).slice(0, 4).map((color, index) => <i key={`${system.id}:${index}`} style={{ background: color }} />)}
                  </span>
                  <span className="canvas-design-system-item-copy"><strong>{system.title}</strong><small>{system.category}</small></span>
                  {pendingId === system.id && <span className="canvas-design-system-check" aria-hidden="true">✓</span>}
                </CanvasSelectionItem>
              ))}
              {!filteredSystems.length && <div className="canvas-design-system-list-empty">{loading ? ir().reading : (message || (systems.length ? ir().noMatchingDesignSystems : ir().noDesignSystems))}</div>}
            </div>
          </aside>
          <main className="canvas-design-system-preview" aria-live="polite">
            {!pendingId ? (
              <div className="canvas-design-system-project-default">
                <span className="canvas-design-system-default-mark" aria-hidden="true">◌</span>
                <strong>{ir().followProjectDefault}</strong>
                <p>{ir().projectDesignSystemNote}</p>
              </div>
            ) : (
              <>
                <div className="canvas-design-system-preview-head">
                  <div><span>{previewSystem?.category || ir().webDesignSystem}</span><h3>{previewSystem?.title || ir().designSystem}</h3></div>
                  <div className="canvas-design-system-preview-palette" aria-label={ir().designPalette}>
                    {palette.map((color, index) => <i key={`${color}:${index}`} style={{ background: color }} title={color} />)}
                  </div>
                </div>
                {showcaseHtml ? (
                  <div className="canvas-design-system-showcase-wrap">
                    <iframe
                      key={pendingId}
                      className="canvas-design-system-showcase"
                      title={ir().livePreviewTitle(previewSystem?.title || ir().designSystemFallbackTitle)}
                      srcDoc={showcaseHtml}
                      sandbox="allow-scripts"
                    />
                  </div>
                ) : (
                  <div
                    className={`canvas-design-system-specimen${showcaseLoading ? ' is-loading' : ''}`}
                    style={{
                      '--ds-preview-bg': previewBackground,
                      '--ds-preview-surface': previewSurface,
                      '--ds-preview-text': previewText,
                      '--ds-preview-accent': previewAccent,
                    } as React.CSSProperties}
                  >
                    {showcaseLoading && <div className="canvas-design-system-showcase-loading"><i aria-hidden="true" /><span>{ir().loadingComponentPreview}</span></div>}
                    {!showcaseLoading && <>
                      <div className="canvas-design-system-specimen-nav"><span>Design / System</span><i /><i /><i /></div>
                      <div className="canvas-design-system-specimen-hero">
                        <span>PRODUCT EXPERIENCE</span>
                        <strong>{ir().makeVisualRules}<br />{ir().intoRealPages}</strong>
                        <p>{ir().colorTypeHierarchy}</p>
                        <div><span className="canvas-design-system-specimen-action">{ir().primaryAction}</span><span className="canvas-design-system-specimen-action">{ir().learnMore}</span></div>
                      </div>
                      <div className="canvas-design-system-specimen-cards"><section><small>01 / PRINCIPLE</small><b>{ir().clearHierarchy}</b></section><section><small>02 / COMPONENT</small><b>{ir().consistentInteraction}</b></section></div>
                    </>}
                  </div>
                )}
                <p className="canvas-design-system-preview-summary">{detailLoading ? ir().readingDesignMd : visualStyle}</p>
                {showcaseFailed && <p className="canvas-design-system-preview-fallback">{ir().previewFallback}</p>}
              </>
            )}
          </main>
        </div>
        <footer className="minimax-resource-actions">
          <Button variant="ghost" onClick={onClose}>{ir().cancel}</Button>
          <Button variant="primary" className="is-primary" onClick={() => { onSelect(selectedSystem); onClose(); }}>{selectedSystem ? ir().useDesignSystem : ir().useProjectDefault}</Button>
        </footer>
    </>
  );
  return dialogRenderer({
    open,
    onOpenChange: nextOpen => { if (!nextOpen) onClose(); },
    children: dialogContent,
    className: 'canvas-workbench minimax-resource-dialog canvas-design-system-dialog',
    ariaLabelledBy: 'canvas-design-system-resource-title',
  });
}
