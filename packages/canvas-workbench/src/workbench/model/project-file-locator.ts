import type { Node } from '@xyflow/react';
import type { BasicCanvasNodeData } from '../BasicCanvasNode';
import type { ImageAssetData } from '../ImageAssetNode';
import type {
  ArticleReviewData,
  WorkbenchCardData,
  WorkflowStageData,
} from './canvas-domain';
import { canvasTextDocumentPath, normalizeCanvasProjectFilePath } from './canvas-text-files';

export function normalizedProjectFilePath(path: string | undefined): string {
  return normalizeCanvasProjectFilePath(path);
}

function artifactValueProjectFilePaths(value: unknown, depth = 0): string[] {
  if (depth > 3 || value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap(item => artifactValueProjectFilePaths(item, depth + 1));
  }
  if (typeof value !== 'object') return [];
  const paths: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof nested === 'string'
      && ['path', 'filePath', 'outputPath', 'relPath', 'relativePath'].includes(key)
    ) {
      paths.push(normalizedProjectFilePath(nested));
      continue;
    }
    paths.push(...artifactValueProjectFilePaths(nested, depth + 1));
  }
  return paths;
}

function nodeProjectFilePaths(node: Node): string[] {
  if (node.type === 'imageAsset') {
    const data = node.data as Partial<ImageAssetData>;
    return [normalizedProjectFilePath(data.image?.path)];
  }
  if (node.type === 'workflowStage') {
    const data = node.data as Partial<WorkflowStageData>;
    return artifactValueProjectFilePaths(data.artifact?.value);
  }
  if (node.type === 'resultCard') {
    const data = node.data as Partial<ArticleReviewData>;
    const resource = data.artifact?.resource;
    return [normalizedProjectFilePath(resource?.kind === 'project-file' ? resource.path : undefined)];
  }
  if (node.type === 'basicCanvas') {
    const data = node.data as Partial<BasicCanvasNodeData>;
    const basicNode = data.node;
    return [
      normalizedProjectFilePath(basicNode?.kind === 'text' ? canvasTextDocumentPath(basicNode) : basicNode?.projectFilePath),
      ...artifactValueProjectFilePaths(basicNode?.videoResults),
      ...artifactValueProjectFilePaths(basicNode?.linkedAttachments),
    ];
  }
  if (node.type === 'workbenchCard') {
    const data = node.data as Partial<WorkbenchCardData>;
    return [normalizedProjectFilePath(data.primaryImage?.path)];
  }
  return [];
}

export function projectFileNodeId(nodes: Node[], fileName: string): string | null {
  return projectFileNodeIds(nodes, fileName)[0] ?? null;
}

export function projectFileNodeIds(nodes: Node[], fileName: string): string[] {
  const normalized = normalizedProjectFilePath(fileName);
  if (!normalized) return [];
  return nodes.filter(node => nodeProjectFilePaths(node).includes(normalized)).map(node => node.id);
}

export function projectFileReferences(nodes: Node[]): Record<string, string[]> {
  const result: Record<string, string[]> = Object.create(null);
  for (const node of nodes) {
    for (const path of new Set(nodeProjectFilePaths(node).filter(Boolean))) {
      (result[path] ??= []).push(node.id);
    }
  }
  return result;
}
