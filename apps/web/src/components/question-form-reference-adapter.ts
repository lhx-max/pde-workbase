import type { ReactNode } from 'react';
import type { QuestionForm } from '../artifacts/question-form';
import type { AssetPreviewSource } from './AssetContentPreview';

/** Host-owned reference identity; no personal/team asset store or route implied. */
export interface QuestionReferenceAsset {
  id: string;
  name: string;
  description?: string;
  kind: string;
  spaceId?: string;
  deletedAt?: number | null;
  versions: Array<{ id: string }>;
  preview?: AssetPreviewSource;
}

export interface QuestionReferenceAdapter {
  /** Query project or external references; must preserve authoritative revision ids. */
  query: (request: { form: QuestionForm; signal?: AbortSignal }) => Promise<QuestionReferenceAsset[]>;
  /** Open the embedding host's picker or read-only library, never a global route. */
  open?: (request: {
    initial?: QuestionReferenceAsset;
    form: QuestionForm;
    signal: AbortSignal;
    readOnly: boolean;
    onSelect: (asset: QuestionReferenceAsset) => Promise<boolean>;
  }) => void | Promise<void>;
  subscribe?: (refresh: () => void) => (() => void);
  renderThumbnail?: (asset: QuestionReferenceAsset) => ReactNode;
  renderPreview?: (asset: QuestionReferenceAsset, onClose: () => void) => ReactNode;
}

export class QuestionReferenceUnavailable extends Error {
  readonly code = 'UNSUPPORTED_CAPABILITY';
  constructor(message = 'Reference selection is unavailable in this host.') {
    super(message);
    this.name = 'QuestionReferenceUnavailable';
  }
}

export function queryQuestionReferences(adapter: QuestionReferenceAdapter | undefined, form: QuestionForm, signal?: AbortSignal) {
  if (!adapter) return Promise.reject(new QuestionReferenceUnavailable());
  return adapter.query({ form, signal });
}
