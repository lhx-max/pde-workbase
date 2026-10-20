'use client';

import type { ArtifactResource } from '@bezier/contracts';
import { cr } from '../locales/canvas-remainder';

export type ArtifactOpener = (resource: ArtifactResource) => void | Promise<void>;

export type TextDocumentOpenRequest = {
  preferContent?: boolean;
  path: string;
  title: string;
  content: string;
};

export type TextDocumentOpenResult = {
  content: string;
};

export type TextDocumentOpener = (
  request: TextDocumentOpenRequest,
) => TextDocumentOpenResult | Promise<TextDocumentOpenResult>;

export type TextDocumentChange = {
  path: string;
  content: string;
  revision: number;
};

let opener: ArtifactOpener | null = null;
let textDocumentOpener: TextDocumentOpener | null = null;

export function setArtifactOpener(next: ArtifactOpener | null): void {
  opener = next;
}

export function setTextDocumentOpener(next: TextDocumentOpener | null): void {
  textDocumentOpener = next;
}

export function openArtifact(resource: ArtifactResource): Promise<void> {
  if (!opener) {
    return Promise.reject(new Error(cr().boardNoFiles));
  }
  return Promise.resolve(opener(resource));
}

export function openTextDocument(
  request: TextDocumentOpenRequest,
): Promise<TextDocumentOpenResult> {
  if (!textDocumentOpener) {
    return Promise.reject(new Error(cr().boardNoDocs));
  }
  return Promise.resolve(textDocumentOpener(request));
}
