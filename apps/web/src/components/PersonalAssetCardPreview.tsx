import type { ReactNode } from 'react';
import type { PersonalAsset } from '@bezier/contracts';
import { CollectionCardMedia } from './CollectionCard';
import { TemplateCardPreview } from './TemplateCardPreview';
import type { TemplateDemo } from './asset-ui-ports';
import { Icon, type IconName } from './Icon';
import { personalAssets } from '../providers/asset-library';
import styles from './PersonalAssetLibrary.module.css';
import { personalAssetTemplate } from './personal-asset-template';
import { AssetDocumentPreview } from './AssetDocumentPreview';
import './asset-library/AssetCardShared.css';

/** Shared original-file cover for the library and read-only attachment picker. */
export function PersonalAssetFileCover({ name, label, icon = 'file-text', title }: { name: string; label: string; icon?: IconName; title?: string }) {
  return <div className={styles.fileCover} aria-hidden="true" title={title}>
    <Icon name={icon} size={28} />
    <strong>{name}</strong><span>{label}</span>
  </div>;
}

/** Personal records adapt to the same preview renderer as the official gallery. */
export function PersonalAssetCardPreview({ asset, label, foreground = false, children }: { asset: PersonalAsset; label: string; foreground?: boolean; children: ReactNode }) {
  const installed = personalAssetTemplate(asset);
  if (installed) return <TemplateCardPreview template={installed} priority={false} foreground={foreground}>{children}</TemplateCardPreview>;
  const version = asset.versions.at(-1);
  return <AssetFileCardPreview id={`${asset.id}-${version?.id || ''}`} name={asset.name} description={asset.description} tags={asset.tags} kind={asset.kind} mime={version?.mime} url={personalAssets.contentUrl(asset)} label={label} foreground={foreground}>{children}</AssetFileCardPreview>;
}

/** Same visual renderer for personal originals and authorized team file packages. */
export function AssetFileCardPreview({ id, name, description = '', tags = [], kind, mime, url, label, foreground = false, children }: {
  id: string; name: string; description?: string; tags?: string[]; kind: string; mime?: string; url?: string; label: string; foreground?: boolean; children: ReactNode;
}) {
  if ((kind === 'text' || kind === 'script') && url) return <CollectionCardMedia className="community-template-card__preview">
    <AssetDocumentPreview kind={kind} url={url} compact />
    {children}
  </CollectionCardMedia>;
  const image = kind === 'image';
  const html = ['slides', 'webpage', 'motion'].includes(kind) && mime === 'text/html';
  if (url && (image || html)) {
    const source = url;
    const template: TemplateDemo = {
      id, title: name, description,
      author: '', tags, accent: '', meta: label, subtype: '', referencePath: '', prompt: '',
      type: image ? 'Image' : kind === 'slides' ? 'Slides' : kind === 'motion' ? 'HyperFrames' : 'Prototype',
      cardMedia: image ? { kind: 'media', mediaType: 'image', poster: source, videoUrl: null, audioUrl: null, imageOnly: true, loopHoldMs: null } : null,
      posterSrc: image ? source : null, previewSrc: html ? source : null, previewVideo: null,
    };
    return <TemplateCardPreview template={template} priority={false} foreground={foreground}>{children}</TemplateCardPreview>;
  }
  return <CollectionCardMedia className="community-template-card__preview">
    <PersonalAssetFileCover name={name} label={label} icon={kind === 'folder' ? 'folder' : kind === 'audio' || kind === 'video' ? 'video-ai' : 'file-text'} />
    {children}
  </CollectionCardMedia>;
}
