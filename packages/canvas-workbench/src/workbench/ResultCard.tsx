'use client';

import React from 'react';
import { Button } from '@bezier/components';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { rc } from '../locales/result-card';
import type {
  ArtifactDescriptor,
  JsonValue,
  ResultRenderer,
} from '@bezier/contracts';
import { projectFileUrl } from '../platform/api-base';

export type ResultCardAction = {
  id: string;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onInvoke: () => void;
};

export type ResultCardProps = {
  artifact: ArtifactDescriptor;
  actions?: ResultCardAction[];
  onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Some canvas nodes use the preview as an in-card mode switch and own their actions outside. */
  showFooter?: boolean;
  /** Canvas text already has a node label; its reading surface needs only the document. */
  showHeader?: boolean;
  openLabel?: string;
  /** 画布上的本地草稿还未发布为真实产物时，可以覆盖默认的状态文案。 */
  statusLabel?: string;
};

type PreviewProps = {
  artifact: ArtifactDescriptor;
};

type ResultPreviewRenderer = (props: PreviewProps) => React.ReactNode;

const rendererLabels: Record<ResultRenderer, string> = {
  document: rc().document,
  image: rc().image,
  video: rc().video,
  html: rc().html,
  audio: rc().audio,
  file: rc().file,
  code: rc().code,
  structured: rc().structured,
};

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

const documentPreview: ResultPreviewRenderer = ({ artifact }) => {
  const preview = record(artifact.preview);
  const markdown = text(preview.markdown);
  const sections = Array.isArray(preview.sections) ? preview.sections : [];
  if (markdown) {
    const normalizedMarkdown = markdown.replace(/<br\s*\/?>/gi, '\n\n');
    const html = micromark(normalizedMarkdown, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
    return (
      <div
        className="article-document article-markdown"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <div className="article-document">
      {text(preview.recipient) && (
        <div className="article-document-recipient">
          <span>{rc().recipients}</span>
          <strong>{text(preview.recipient)}</strong>
        </div>
      )}
      {text(preview.background) && <p className="article-background">{text(preview.background)}</p>}
      {sections.length > 0 && (
        <div className="article-sections">
          {sections.slice(0, 3).flatMap((value, index) => {
            const section = record(value);
            const body = text(section.body);
            if (!body && !text(section.heading)) return [];
            return (
              <section key={`${text(section.heading) || 'section'}-${index}`}>
                <h4>{text(section.heading) || rc().sectionN(index + 1)}</h4>
                {body && <p>{body}</p>}
              </section>
            );
          })}
        </div>
      )}
      {!text(preview.background) && sections.length === 0 && artifact.summary && (
        <p className="article-background">{artifact.summary}</p>
      )}
    </div>
  );
};

function previewSource(artifact: ArtifactDescriptor): string {
  if (artifact.thumbnail?.url) return artifact.thumbnail.url;
  if (artifact.thumbnail?.path) return projectFileUrl(artifact.thumbnail.path);
  if (artifact.resource.kind === 'project-file' && artifact.renderer === 'image') {
    return projectFileUrl(artifact.resource.path);
  }
  return '';
}

const mediaPreview: ResultPreviewRenderer = ({ artifact }) => {
  const src = previewSource(artifact);
  const isVideo = artifact.renderer === 'video';
  return (
    <div className={`result-card-media result-card-media--${artifact.renderer}`}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <div className="result-card-media-placeholder">
          <strong>{artifact.title}</strong>
          {artifact.summary && <span>{artifact.summary}</span>}
        </div>
      )}
      {isVideo && <span className="result-card-play" aria-hidden="true">▶</span>}
    </div>
  );
};

const summaryPreview: ResultPreviewRenderer = ({ artifact }) => (
  <div className="result-card-summary-preview">
    <strong>{artifact.title}</strong>
    {artifact.summary && <p>{artifact.summary}</p>}
  </div>
);

const rendererRegistry = new Map<ResultRenderer, ResultPreviewRenderer>([
  ['document', documentPreview],
  ['image', mediaPreview],
  ['video', mediaPreview],
  ['html', mediaPreview],
  ['audio', summaryPreview],
  ['file', summaryPreview],
  ['code', summaryPreview],
  ['structured', summaryPreview],
]);

export function ResultCard({ artifact, actions = [], onOpen, showFooter = true, showHeader = true, openLabel = rc().openDetails, statusLabel }: ResultCardProps) {
  const Preview = rendererRegistry.get(artifact.renderer) ?? summaryPreview;
  const generating = artifact.status === 'generating';

  return (
    <div className="node-inner result-card-inner">
      {showHeader && <div className="node-drag-surface">
        <div className="node-title-row">
          <h2>{artifact.title}</h2>
          <span className="result-card-meta">
            {rendererLabels[artifact.renderer]} ·{' '}
            <span className={`result-card-status is-${artifact.status}`}>
              {statusLabel ?? (generating ? rc().generating : artifact.status === 'failed' ? rc().failed : rc().complete)}
            </span>
          </span>
        </div>
        {artifact.summary && <p className="canvas-result-summary">{artifact.summary}</p>}
      </div>}

      {generating ? (
        <div className="canvas-result-loading" aria-label={rc().generatingTitle(artifact.title)}>
          <span className="canvas-result-spinner" aria-hidden="true" />
          <div className="canvas-result-skeletons">
            <span className="canvas-result-skeleton" />
            <span className="canvas-result-skeleton" />
            <span className="canvas-result-skeleton" />
          </div>
        </div>
      ) : artifact.renderer === 'audio' && artifact.resource.kind === 'project-file' ? (
        <div className="result-card-summary-preview nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()}>
          <audio controls preload="metadata" src={projectFileUrl(artifact.resource.path)} aria-label={artifact.title} style={{ width: '100%' }} />
        </div>
      ) : (
        <Button
          variant="ghost"
          className="result-card-open nodrag nopan nowheel"
          title={openLabel}
          aria-label={openLabel}
          onClick={onOpen}
          onWheel={event => event.stopPropagation()}
        >
          <Preview artifact={artifact} />
        </Button>
      )}

      {showFooter && <div className="article-review-footer nodrag nopan">
        <span title={artifact.resource.kind === 'project-file' ? artifact.resource.path : undefined}>
          {artifact.resource.kind === 'project-file'
            ? artifact.resource.path
            : rc().liveArtifact(artifact.resource.artifactId)}
        </span>
        <div>
          {actions.map(action => (
            <Button
              key={action.id}
              variant={action.primary ? 'primary' : 'ghost'}
              className={action.primary ? undefined : 'is-secondary'}
              disabled={action.disabled}
              onClick={event => {
                event.stopPropagation();
                action.onInvoke();
              }}
            >
              {action.label}
            </Button>
          ))}
          <Button variant="ghost" onClick={onOpen}>{rc().openDetails}</Button>
        </div>
      </div>}
    </div>
  );
}
