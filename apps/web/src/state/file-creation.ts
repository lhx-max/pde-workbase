// Original FileWorkspace creation defaults; no product runtime dependency.
import type { ProjectFile } from '@bezier/contracts';
import type { TrackingProjectKind } from '@bezier/contracts/analytics';
import type { Dict } from '../i18n/types';
import type { useT } from '../i18n';
type TranslateFn = ReturnType<typeof useT>;
function normalizeProjectFilePath(path: string): string {
    return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/');
}
function joinProjectFilePath(dir: string, name: string): string {
    const normalizedDir = normalizeProjectFilePath(dir);
    return normalizedDir ? `${normalizedDir}/${name}` : name;
}
export function nextMarkdownDocumentPath(files: ProjectFile[], dir: string): string {
    const existing = new Set(files.map((file) => normalizeProjectFilePath(file.name).toLowerCase()));
    for (let index = 1; index < 1000; index += 1) {
        const name = index === 1 ? 'document.md' : `document-${index}.md`;
        const candidate = joinProjectFilePath(dir, name);
        if (!existing.has(normalizeProjectFilePath(candidate).toLowerCase()))
            return candidate;
    }
    return joinProjectFilePath(dir, `document-${Date.now()}.md`);
}
export function initialMarkdownDocument(path: string, projectKind: TrackingProjectKind, t: TranslateFn): string {
    const title = normalizeProjectFilePath(path)
        .split('/')
        .pop()
        ?.replace(/\.mdx?$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase()) || t('designFiles.documentTemplate.titleFallback');
    return `# ${title}

## ${t('designFiles.documentTemplate.goalHeading')}

${t('designFiles.documentTemplate.goalBody')}

## ${t('designFiles.documentTemplate.capabilitiesHeading')}

- ${t('designFiles.documentTemplate.capabilityMarkdown')}
- ${t('designFiles.documentTemplate.capabilityAgent')}
- ${t('designFiles.documentTemplate.capabilityImages')}

## ${t('designFiles.documentTemplate.scenarioHeading')}

${t(documentTemplateScenarioKey(projectKind))}

## ${t('designFiles.documentTemplate.nextHeading')}

${t('designFiles.documentTemplate.nextBody')}
`;
}
function documentTemplateScenarioKey(projectKind: TrackingProjectKind): keyof Dict {
    switch (projectKind) {
        case 'prototype':
            return 'designFiles.documentTemplate.scenario.prototype';
        case 'wireframe':
            return 'designFiles.documentTemplate.scenario.wireframe';
        case 'mobile':
            return 'designFiles.documentTemplate.scenario.mobile';
        case 'slide_deck':
            return 'designFiles.documentTemplate.scenario.slideDeck';
        case 'document':
            return 'designFiles.documentTemplate.scenario.document';
        case 'image':
            return 'designFiles.documentTemplate.scenario.image';
        case 'video':
            return 'designFiles.documentTemplate.scenario.video';
        case 'hyperframes':
            return 'designFiles.documentTemplate.scenario.hyperframes';
        case 'audio':
            return 'designFiles.documentTemplate.scenario.audio';
        case 'live_artifact':
            return 'designFiles.documentTemplate.scenario.liveArtifact';
        case 'brand':
        case 'design_system':
            return 'designFiles.documentTemplate.scenario.designSystem';
        case 'template':
        default:
            return 'designFiles.documentTemplate.scenario.default';
    }
}
