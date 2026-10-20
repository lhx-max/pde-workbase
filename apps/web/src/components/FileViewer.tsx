// Original FileViewer sections extracted without chat, deployment, public-sharing or library product UI.
import { documentPreviewSectionLines, documentPreviewSectionTitle } from './document-preview-labels';
import { useCallback,useEffect,useMemo,useRef,useState,type ClipboardEvent as ReactClipboardEvent,type DragEvent as ReactDragEvent,type MouseEvent as ReactMouseEvent } from 'react';
import type { ProjectFile, WorkspaceCollabContext } from '@bezier/contracts';
import { Button, Textarea } from './ui';
import { Icon } from './Icon';
import { useT,useI18n } from '../i18n';
import type { Dict } from '../i18n/types';
import { useProjectCollabContext } from '../collab/collab-context';
import { appendResourceQuery } from '../collab/workspace-identity';
import { downloadProjectResource } from '../providers/project-usage';
import { fetchProjectFileText,fetchProjectFilePreview,projectFileUrl,writeProjectTextFile,uploadProjectFiles,type ProjectFilePreview } from '../providers/registry';
import { MarkdownWordDocument,sanitizeMarkdownWordHtml } from './MarkdownWordDocument';
import { renderMarkdownToSafeHtml } from '../artifacts/markdown';
import { artifactRendererRegistry } from '../artifacts/renderer-registry';
import { exportAsMd,exportProjectTextDocument } from '../runtime/exports';
import { buildScrollAnchors,extractMarkdownBlockLines,mapScrollPosition,measureEditorBlockOffsets,measurePreviewBlockOffsets } from './markdown-scroll-sync';
import { useDismissOnOutsideInteraction } from '../hooks/useDismissOnOutsideInteraction';
import type { MarkdownTextSelectionAction,MarkdownTextSelectionContext } from './markdown-text-selection';
import { SketchPreview } from './SketchPreview';
import { HtmlViewer, type HtmlViewerProps } from './HtmlViewer';
/** Preserve the original HTML viewer host contract through the file router.
 * Safe-exit and retention handlers must reach the workspace: an HTML manual-edit
 * session is not an ordinary closable tab. Spread forwarding below is deliberate.
 */
export type FileViewerProps = HtmlViewerProps & {
  onTextSaved?: (fileName: string, content: string) => void;
  onStageTextSelection?: (
    file: ProjectFile,
    action: MarkdownTextSelectionAction,
    selection: MarkdownTextSelectionContext,
    instruction?: string,
  ) => void;
};
export function FileViewer(props:FileViewerProps) {
 const {file}=props;
 const rendererMatch = artifactRendererRegistry.resolve({ file, isDeckHint: Boolean(props.isDeck) });
 if (rendererMatch?.renderer.id === 'html' || rendererMatch?.renderer.id === 'deck-html') {
   return <HtmlViewer {...props} isDeck={rendererMatch.renderer.id === 'deck-html'} />;
 }
 if(file.kind==='html'||/\.html?$/i.test(file.name))return <HtmlViewer {...props}/>;
 if(/\.svg$/i.test(file.name))return <SvgViewer {...props}/>;
 if(/\.mdx?$/i.test(file.name))return <MarkdownViewer {...props}/>;
 if(file.kind==='image')return <ImageViewer {...props}/>;
 if(file.kind==='video')return <VideoViewer {...props}/>;
 if(file.kind==='audio')return <AudioViewer {...props}/>;
 if(file.kind==='sketch')return <SketchViewer {...props}/>;
 if(['pdf','document','presentation','spreadsheet'].includes(file.kind))return <DocumentPreviewViewer {...props}/>;
 if(file.kind==='text'||file.kind==='code')return <TextViewer {...props}/>;
 return <BinaryViewer {...props}/>;
}
type TranslateFn = (key:keyof Dict,vars?:Record<string,string|number>)=>string;
const MARKDOWN_CODE_BLOCK_ATTR = 'data-markdown-code-block';
const MARKDOWN_CODE_LANGUAGE_ATTR = 'data-code-language';
const MARKDOWN_COPY_BLOCK_ATTR = 'data-copy-code-block';
const MARKDOWN_COPY_BUTTON_CLASS = 'markdown-code-copy';
const MARKDOWN_COPY_TOAST_CLASS = 'markdown-code-toast';
const ABSOLUTE_MARKDOWN_IMAGE_SOURCE_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
      if (priorFocus?.isConnected) {
        try {
          priorFocus.focus({ preventScroll: true });
        } catch {
          priorFocus.focus();
        }
      }
    }
  }
}

function decorateMarkdownCodeBlocks(html: string): string {
  let blockIndex = 0;
  return html.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/g, (_match, attrs: string, content: string) => {
    const blockId = String(blockIndex++);
    const language = markdownCodeBlockLanguage(content);
    const languageAttr = language ? ` ${MARKDOWN_CODE_LANGUAGE_ATTR}="${escapeHtmlAttribute(language.label)}"` : '';
    return `<div class="markdown-code-block" ${MARKDOWN_CODE_BLOCK_ATTR}="${blockId}"${languageAttr}><pre${attrs}>${content}</pre></div>`;
  });
}

type MarkdownCodeLanguage = {
  lang: string;
  label: string;
};

function markdownCodeBlockLanguage(content: string): MarkdownCodeLanguage | null {
  const codeMatch = content.match(/<code\b([^>]*)>/);
  if (!codeMatch) return null;
  const classMatch = codeMatch[1]?.match(/\bclass=(["'])(.*?)\1/);
  const className = classMatch?.[2] ?? '';
  const languageClass = className
    .split(/\s+/)
    .map((item) => item.trim())
    .find((item) => /^(?:language|lang)-/i.test(item));
  if (!languageClass) return null;
  const raw = languageClass.replace(/^(?:language|lang)-/i, '').replace(/[^a-z0-9+#.-]/gi, '');
  if (!raw) return null;
  const aliases: Record<string, MarkdownCodeLanguage> = {
    bash: { lang: 'bash', label: 'Bash' },
    c: { lang: 'c', label: 'C' },
    cpp: { lang: 'cpp', label: 'C++' },
    css: { lang: 'css', label: 'CSS' },
    diff: { lang: 'diff', label: 'Diff' },
    dockerfile: { lang: 'dockerfile', label: 'Dockerfile' },
    go: { lang: 'go', label: 'Go' },
    graphql: { lang: 'graphql', label: 'GraphQL' },
    html: { lang: 'html', label: 'HTML' },
    java: { lang: 'java', label: 'Java' },
    js: { lang: 'javascript', label: 'JS' },
    javascript: { lang: 'javascript', label: 'JS' },
    json: { lang: 'json', label: 'JSON' },
    jsx: { lang: 'jsx', label: 'JSX' },
    markdown: { lang: 'markdown', label: 'Markdown' },
    md: { lang: 'markdown', label: 'Markdown' },
    php: { lang: 'php', label: 'PHP' },
    py: { lang: 'python', label: 'Python' },
    python: { lang: 'python', label: 'Python' },
    rb: { lang: 'ruby', label: 'Ruby' },
    ruby: { lang: 'ruby', label: 'Ruby' },
    rust: { lang: 'rust', label: 'Rust' },
    shell: { lang: 'shell', label: 'Shell' },
    sh: { lang: 'shell', label: 'Shell' },
    sql: { lang: 'sql', label: 'SQL' },
    swift: { lang: 'swift', label: 'Swift' },
    toml: { lang: 'toml', label: 'TOML' },
    ts: { lang: 'typescript', label: 'TS' },
    tsx: { lang: 'tsx', label: 'TSX' },
    typescript: { lang: 'typescript', label: 'TS' },
    xml: { lang: 'xml', label: 'XML' },
    yaml: { lang: 'yaml', label: 'YAML' },
    yml: { lang: 'yaml', label: 'YAML' },
  };
  return aliases[raw.toLowerCase()] ?? { lang: raw.toLowerCase(), label: raw.toUpperCase() };
}

async function highlightMarkdownCodeBlocks(html: string): Promise<string> {
  if (typeof document === 'undefined') return html;
  const root = document.createElement('div');
  root.innerHTML = html;
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(`[${MARKDOWN_CODE_BLOCK_ATTR}]`));
  if (blocks.length === 0) return html;
  const { highlightCode } = await import('../runtime/shiki');
  let changed = false;
  await Promise.all(blocks.map(async (block) => {
    const code = block.querySelector<HTMLElement>('pre > code');
    if (!code) return;
    const language = markdownCodeBlockLanguage(code.outerHTML);
    if (!language) return;
    const source = (code.textContent ?? '').replace(/\n$/, '');
    const highlighted = await highlightCode(source, language.lang);
    if (!highlighted) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = highlighted;
    const highlightedPre = wrapper.firstElementChild;
    if (!(highlightedPre instanceof HTMLElement)) return;
    highlightedPre.classList.add('markdown-shiki');
    highlightedPre.setAttribute('data-lang', language.label);
    code.closest('pre')?.replaceWith(highlightedPre);
    block.setAttribute(MARKDOWN_CODE_LANGUAGE_ATTR, language.label);
    changed = true;
  }));
  return changed ? root.innerHTML : html;
}

function rewriteMarkdownImageSources(
  html: string,
  projectId: string,
  markdownPath: string,
  workspaceContext?: WorkspaceCollabContext | null,
): string {
  return html.replace(/<img\b([^>]*?)\bsrc="([^"]*)"([^>]*)>/g, (match, before: string, src: string, after: string) => {
    const resolved = markdownImageSourceUrl(
      projectId,
      markdownPath,
      decodeHtmlAttribute(src),
      workspaceContext,
    );
    if (!resolved) return match;
    const attrs = `${before}${after}`;
    const loadingAttr = /\sloading=/.test(attrs) ? '' : ' loading="lazy"';
    return `<img${before}src="${escapeHtmlAttribute(resolved)}"${loadingAttr}${after}>`;
  });
}

export function markdownImageSourceUrl(
  projectId: string,
  markdownPath: string,
  src: string,
  workspaceContext?: WorkspaceCollabContext | null,
): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (ABSOLUTE_MARKDOWN_IMAGE_SOURCE_RE.test(trimmed)) return trimmed;
  const relativePath = trimmed.startsWith('/')
    ? normalizeMarkdownProjectPath(trimmed.slice(1))
    : normalizeMarkdownProjectPath(`${markdownDirectory(markdownPath)}/${trimmed}`);
  return relativePath
    ? projectFileUrl(projectId, relativePath, workspaceContext)
    : null;
}

function markdownDirectory(path: string): string {
  const normalized = normalizeMarkdownProjectPath(path);
  const slash = normalized.lastIndexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : '';
}

function normalizeMarkdownProjectPath(path: string): string {
  const parts: string[] = [];
  for (const raw of path.replace(/\\/g, '/').split('/')) {
    const part = raw.trim();
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function markdownRelativeProjectPath(fromPath: string, targetPath: string): string {
  const fromDir = markdownDirectory(fromPath);
  const target = normalizeMarkdownProjectPath(targetPath);
  if (!fromDir) return target;
  if (target.startsWith(`${fromDir}/`)) return target.slice(fromDir.length + 1);
  const fromParts = fromDir.split('/').filter(Boolean);
  const targetParts = target.split('/').filter(Boolean);
  let common = 0;
  while (common < fromParts.length && common < targetParts.length && fromParts[common] === targetParts[common]) {
    common += 1;
  }
  const up = Array.from({ length: fromParts.length - common }, () => '..');
  const down = targetParts.slice(common);
  return [...up, ...down].join('/') || target;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setMarkdownCodeBlockCopiedState(block: HTMLElement, copied: boolean, t: TranslateFn) {
  const button = block.querySelector<HTMLButtonElement>(`.${MARKDOWN_COPY_BUTTON_CLASS}`);
  if (!button) return;
  const label = copied ? t('fileViewer.copied') : t('fileViewer.copy');
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.title = t('fileViewer.copyTitle');

  const existingToast = block.querySelector(`.${MARKDOWN_COPY_TOAST_CLASS}`);
  if (copied) {
    if (existingToast instanceof HTMLElement) {
      existingToast.textContent = t('fileViewer.copied');
      return;
    }
    const toast = document.createElement('span');
    toast.className = MARKDOWN_COPY_TOAST_CLASS;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = t('fileViewer.copied');
    button.insertAdjacentElement('afterend', toast);
    return;
  }

  existingToast?.remove();
}

function ensureMarkdownCodeBlockControls(root: HTMLElement, t: TranslateFn) {
  for (const block of root.querySelectorAll<HTMLElement>(`[${MARKDOWN_CODE_BLOCK_ATTR}]`)) {
    let button = block.querySelector<HTMLButtonElement>(`.${MARKDOWN_COPY_BUTTON_CLASS}`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = MARKDOWN_COPY_BUTTON_CLASS;
      const blockId = block.getAttribute(MARKDOWN_CODE_BLOCK_ATTR) ?? '';
      button.setAttribute(MARKDOWN_COPY_BLOCK_ATTR, blockId);
      block.prepend(button);
    }
    setMarkdownCodeBlockCopiedState(block, false, t);
  }
}

function FileActions({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const { workspaceContext } = useProjectCollabContext();
  return (
    <div className="viewer-toolbar-actions">
      <a
        className="ghost-link"
        href={projectFileUrl(projectId, file.name, workspaceContext)}
        download={file.name}
        onClick={event => { event.preventDefault(); void downloadProjectResource(projectId, { url: projectFileUrl(projectId, file.name, workspaceContext), fileName: file.name }, workspaceContext).catch(error => window.alert(error.message)); }}
      >
        {t('fileViewer.download')}
      </a>
      <a
        className="ghost-link"
        href={projectFileUrl(projectId, file.name, workspaceContext)}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t('fileViewer.open')}
      </a>
    </div>
  );
}
function BinaryViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  return (
    <div className="viewer binary-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.binaryMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body">
        <div className="viewer-empty">
          {t('fileViewer.binaryNote', { size: file.size })}
        </div>
      </div>
    </div>
  );
}

function DocumentPreviewViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const { workspaceContext } = useProjectCollabContext();
  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    void fetchProjectFilePreview(projectId, file.name, workspaceContext).then((next) => {
      if (!cancelled) {
        setPreview(next);
        setLoadError('');
        setLoading(false);
      }
    }).catch(cause => { if (!cancelled) { setLoadError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); } });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, workspaceContext]);

  return (
    <div className="viewer document-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {documentMetaLabel(file, t)} · {humanSize(file.size)}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body">
        {loading ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : preview ? (
          <div className="document-preview">
            <h2>{preview.title}</h2>
            {preview.sections.map((section, idx) => (
              <section key={`${section.title}-${idx}`}>
                <h3>{documentPreviewSectionTitle(file.kind, section.title, idx, t, section)}</h3>
                {documentPreviewSectionLines(section, t).map((line, lineIdx) => (
                  <p key={`${lineIdx}-${line}`}>{line}</p>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="viewer-empty" role={loadError ? 'alert' : undefined}>{loadError || t('fileViewer.previewUnavailable')}</div>
        )}
      </div>
    </div>
  );
}
function ImageViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const { workspaceContext } = useProjectCollabContext();
  const url = appendResourceQuery(
    projectFileUrl(projectId, file.name, workspaceContext),
    `v=${Math.round(file.mtime)}`,
  );
  return (
    <div className="viewer image-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {file.kind === 'sketch'
              ? t('fileViewer.sketchMeta', { size: humanSize(file.size) })
              : t('fileViewer.imageMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <div className="viewer-toolbar-actions">
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name, workspaceContext)}
            download={file.name}
            onClick={event => { event.preventDefault(); void downloadProjectResource(projectId, { url: projectFileUrl(projectId, file.name, workspaceContext), fileName: file.name }, workspaceContext).catch(error => window.alert(error.message)); }}
          >
            {t('fileViewer.download')}
          </a>
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name, workspaceContext)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('fileViewer.open')}
          </a>
        </div>
      </div>
      <div className="viewer-body image-body">
        <img alt={file.name} src={url} />
      </div>
    </div>
  );
}

function SketchViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const { workspaceContext } = useProjectCollabContext();
  return (
    <div className="viewer image-viewer sketch-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.sketchMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body image-body">
        <SketchPreview
          projectId={projectId}
          file={file}
          className="viewer-sketch-preview"
          workspaceContext={workspaceContext}
        />
      </div>
    </div>
  );
}

function VideoViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const { workspaceContext } = useProjectCollabContext();
  const url = appendResourceQuery(
    projectFileUrl(projectId, file.name, workspaceContext),
    `v=${Math.round(file.mtime)}`,
  );
  return (
    <div className="viewer video-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.videoMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body video-body">
        <video src={url} controls playsInline preload="metadata" />
      </div>
    </div>
  );
}

function AudioViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const { workspaceContext } = useProjectCollabContext();
  const url = appendResourceQuery(
    projectFileUrl(projectId, file.name, workspaceContext),
    `v=${Math.round(file.mtime)}`,
  );
  return (
    <div className="viewer audio-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.audioMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <FileActions projectId={projectId} file={file} />
      </div>
      <div className="viewer-body audio-body">
        <div className="audio-card">
          <Icon name="mic" size={28} />
          <div className="audio-card-name">{file.name}</div>
          <audio src={url} controls preload="metadata" />
        </div>
      </div>
    </div>
  );
}

type SvgViewerMode = 'preview' | 'source';

interface SvgViewerProps {
  projectId: string;
  file: ProjectFile;
  initialMode?: SvgViewerMode;
  initialSource?: string | null | undefined;
}

export function SvgViewer({
  projectId,
  file,
  initialMode = 'preview',
  initialSource,
}: SvgViewerProps) {
  const t = useT();
  const { workspaceContext } = useProjectCollabContext();
  const [mode, setMode] = useState<SvgViewerMode>(initialMode);
  const [source, setSource] = useState<string | null>(initialSource ?? null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const url = appendResourceQuery(
    projectFileUrl(projectId, file.name, workspaceContext),
    `v=${Math.round(file.mtime)}&r=${reloadKey}`,
  );

  useEffect(() => {
    if (mode !== 'source') return;
    if (initialSource !== undefined && reloadKey === 0) return;
    let cancelled = false;
    setLoadingSource(true);
    setSourceError(false);
    void fetchProjectFileText(projectId, file.name, {
      cache: 'no-store',
      cacheBustKey: `${Math.round(file.mtime)}-${reloadKey}`,
      workspaceContext,
    }).then((next) => {
      if (cancelled) return;
      if (next === null) {
        setSource('');
        setSourceError(true);
      } else {
        setSource(next);
      }
      setLoadingSource(false);
    }).catch(() => {
      if (cancelled) return;
      setSourceError(true);
      setLoadingSource(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    file.name,
    file.mtime,
    initialSource,
    mode,
    reloadKey,
    workspaceContext,
  ]);

  return (
    <div className="viewer svg-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <span className="viewer-meta">
            {t('fileViewer.imageMeta', { size: humanSize(file.size) })}
          </span>
        </div>
        <div className="viewer-toolbar-actions">
          <div className="viewer-tabs">
            <Button
              type="button"
              className={`viewer-tab ${mode === 'preview' ? 'active' : ''}`}
              aria-pressed={mode === 'preview'}
              onClick={() => setMode('preview')}
            >
              {t('fileViewer.preview')}
            </Button>
            <Button
              type="button"
              className={`viewer-tab ${mode === 'source' ? 'active' : ''}`}
              aria-pressed={mode === 'source'}
              onClick={() => setMode('source')}
            >
              {t('fileViewer.source')}
            </Button>
          </div>
          <span className="viewer-divider" aria-hidden />
          <Button
            type="button"
            className="viewer-action"
            onClick={() => setReloadKey((n) => n + 1)}
            title={t('fileViewer.reloadDisk')}
          >
            <Icon name="reload" size={13} />
            <span>{t('fileViewer.reload')}</span>
          </Button>
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name, workspaceContext)}
            download={file.name}
            onClick={event => { event.preventDefault(); void downloadProjectResource(projectId, { url: projectFileUrl(projectId, file.name, workspaceContext), fileName: file.name }, workspaceContext).catch(error => window.alert(error.message)); }}
          >
            {t('fileViewer.download')}
          </a>
          <a
            className="ghost-link"
            href={projectFileUrl(projectId, file.name, workspaceContext)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('fileViewer.open')}
          </a>
        </div>
      </div>
      <div className={`viewer-body ${mode === 'preview' ? 'image-body' : ''}`}>
        {mode === 'preview' ? (
          <img alt={file.name} src={url} />
        ) : loadingSource ? (
          <div className="viewer-empty">{t('fileViewer.loading')}</div>
        ) : sourceError ? (
          <div className="viewer-empty">{t('fileViewer.previewUnavailable')}</div>
        ) : (
          <pre className="viewer-source">{source ?? ''}</pre>
        )}
      </div>
    </div>
  );
}

// Read-only fallback viewer for `text` / `code` files (JSON tokens, configs,
// source dumps). It renders the file body through `CodeWithLines` / `<pre>` and
// owns no editable buffer, so there is no state in which a save could ever
// apply. Its toolbar therefore exposes only reload + copy: a Save control here
// would be permanently unreachable, not merely idle. Viewers that DO own an
// editable buffer (MarkdownViewer's autosave, HtmlViewer's manual-edit save)
// keep their save affordance even while it is momentarily disabled, because
// there the disabled state is transient rather than structural.
function TextViewer({
  projectId,
  file,
}: {
  projectId: string;
  file: ProjectFile;
}) {
  const t = useT();
  const { workspaceContext } = useProjectCollabContext();
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setText(null);
    let cancelled = false;
    void fetchProjectFileText(projectId, file.name, { workspaceContext }).then((t) => {
      if (!cancelled) { setLoadError(''); setText(t ?? ''); }
    }).catch(cause => { if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause)); });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, reloadKey, workspaceContext]);

  async function copy() {
    if (text == null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // best-effort fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  const displayText = useMemo(
    () => (text == null ? null : formatJsonFileTextForDisplay(file, text)),
    [file.name, file.mime, text],
  );
  const lineCount = displayText ? displayText.split('\n').length : 0;

  return (
    <div className="viewer text-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left" />
        <div className="viewer-toolbar-actions">
          <Button
            type="button"
            className="viewer-action"
            onClick={() => setReloadKey((n) => n + 1)}
            title={t('fileViewer.reloadDisk')}
          >
            <Icon name="reload" size={13} />
            <span>{t('fileViewer.reload')}</span>
          </Button>
          <Button
            type="button"
            className="viewer-action"
            onClick={() => void copy()}
            title={t('fileViewer.copyTitle')}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            <span>{copied ? t('fileViewer.copied') : t('fileViewer.copy')}</span>
          </Button>
        </div>
      </div>
      <div className="viewer-body">
        {text === null ? (
          <div className="viewer-empty" role={loadError ? 'alert' : undefined}>{loadError || t('fileViewer.loading')}</div>
        ) : displayText !== null && lineCount > 0 ? (
          <CodeWithLines text={displayText} />
        ) : (
          <pre className="viewer-source">{displayText}</pre>
        )}
      </div>
    </div>
  );
}

function formatJsonFileTextForDisplay(file: ProjectFile, text: string): string {
  if (!isJsonFile(file)) return text;
  try {
    if (hasPrecisionSensitiveJsonNumberText(text)) return text;
    const parsed = JSON.parse(text) as unknown;
    if (hasUnsafeJsonNumber(parsed)) return text;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function hasPrecisionSensitiveJsonNumberText(text: string): boolean {
  let inString = false;
  let escaped = false;
  const numberTokenPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      i += 1;
      continue;
    }

    numberTokenPattern.lastIndex = i;
    const match = numberTokenPattern.exec(text);
    if (!match) {
      i += 1;
      continue;
    }

    const token = match[0];
    if (isSignedNegativeZeroJsonNumberToken(token)) return true;
    if (/[.eE]/.test(token) && isPrecisionSensitiveJsonNumberToken(token)) return true;
    i = numberTokenPattern.lastIndex;
  }
  return false;
}

function isSignedNegativeZeroJsonNumberToken(token: string): boolean {
  return /^-0(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(token);
}

function isPrecisionSensitiveJsonNumberToken(token: string): boolean {
  const parsed = Number(token);
  if (!Number.isFinite(parsed)) return true;
  const rendered = JSON.stringify(parsed);
  if (!rendered) return true;
  const originalValue = parseJsonNumberTokenAsDecimal(token);
  const renderedValue = parseJsonNumberTokenAsDecimal(rendered);
  return (
    !originalValue ||
    !renderedValue ||
    originalValue.coefficient !== renderedValue.coefficient ||
    originalValue.exponent !== renderedValue.exponent
  );
}

function parseJsonNumberTokenAsDecimal(token: string): { coefficient: bigint; exponent: number } | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) return null;
  const [, sign, integerPart, fractionPart = '', exponentPart = '0'] = match;
  const coefficient = BigInt(`${sign ?? ''}${integerPart}${fractionPart}`);
  const exponent = Number(exponentPart) - fractionPart.length;
  return normalizeDecimalParts(coefficient, exponent);
}

function normalizeDecimalParts(coefficient: bigint, exponent: number): { coefficient: bigint; exponent: number } {
  if (coefficient === 0n) return { coefficient: 0n, exponent: 0 };
  let normalizedCoefficient = coefficient;
  let normalizedExponent = exponent;
  while (normalizedCoefficient % 10n === 0n) {
    normalizedCoefficient /= 10n;
    normalizedExponent += 1;
  }
  return { coefficient: normalizedCoefficient, exponent: normalizedExponent };
}

function hasUnsafeJsonNumber(value: unknown): boolean {
  if (typeof value === 'number') {
    return !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value));
  }
  if (Array.isArray(value)) return value.some(hasUnsafeJsonNumber);
  if (value && typeof value === 'object') return Object.values(value).some(hasUnsafeJsonNumber);
  return false;
}

function isJsonFile(file: ProjectFile): boolean {
  return file.name.toLowerCase().endsWith('.json') || file.mime.toLowerCase().startsWith('application/json');
}

type MarkdownViewerMode = 'edit' | 'split' | 'document';
type MarkdownSaveState = 'idle' | 'saving' | 'saved' | 'error';
type MarkdownScrollPane = 'editor' | 'preview';
type MarkdownSaveOptions = {
  refreshFiles?: boolean;
  showSaving?: boolean;
};

function markdownScrollRange(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function markdownScrollRatio(element: HTMLElement): number {
  const range = markdownScrollRange(element);
  return range > 0 ? element.scrollTop / range : 0;
}

function markdownScrollTopForRatio(element: HTMLElement, ratio: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return markdownScrollRange(element) * clamped;
}

function mergeMarkdownSaveOptions(a: MarkdownSaveOptions, b: MarkdownSaveOptions): MarkdownSaveOptions {
  return {
    refreshFiles: a.refreshFiles !== false || b.refreshFiles !== false,
    showSaving: a.showSaving !== false || b.showSaving !== false,
  };
}

function MarkdownViewer({
  projectId,
  file,
  onFileSaved,
  onTextSaved,
  onStageTextSelection,
  viewerOnly = false,
}: {
  projectId: string;
  file: ProjectFile;
  onFileSaved?: () => Promise<void> | void;
  onTextSaved?: (fileName: string, content: string) => void;
  onStageTextSelection?: (
    file: ProjectFile,
    action: MarkdownTextSelectionAction,
    selection: MarkdownTextSelectionContext,
    instruction?: string,
  ) => void;
  viewerOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const { workspaceContext } = useProjectCollabContext();
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [copied, setCopied] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [documentExporting, setDocumentExporting] = useState<'txt' | 'docx' | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsideInteraction(downloadMenuOpen, downloadMenuRef, () => setDownloadMenuOpen(false));
  const [mode, setMode] = useState<MarkdownViewerMode>('document');
  const [saveState, setSaveState] = useState<MarkdownSaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<{ source: string; html: string; themeRevision: number } | null>(null);
  const [highlightThemeRevision, setHighlightThemeRevision] = useState(0);
  const [, bumpSavedRevision] = useState(0);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const markdownPreviewPaneRef = useRef<HTMLElement | null>(null);
  const markdownArticleRef = useRef<HTMLElement | null>(null);
  const copyBlockTimerRef = useRef<number | null>(null);
  const copiedMarkdownBlockRef = useRef<HTMLElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const programmaticScrollClearFrameRef = useRef<number | null>(null);
  const pendingScrollSyncRef = useRef<{ sourcePane: MarkdownScrollPane; targetPane: MarkdownScrollPane } | null>(null);
  const programmaticScrollRef = useRef<{ pane: MarkdownScrollPane; top: number } | null>(null);
  const activeMarkdownScrollPaneRef = useRef<MarkdownScrollPane>('editor');
  const editorBlockOffsetsRef = useRef<{ width: number; offsets: number[] } | null>(null);
  const previousModeRef = useRef<MarkdownViewerMode>('document');
  const saveInFlightRef = useRef(false);
  const pendingSaveAfterFlightRef = useRef<MarkdownSaveOptions | null>(null);
  const textRef = useRef('');
  const lastSavedTextRef = useRef<string | null>(null);
  const loadedFileKeyRef = useRef<string | null>(null);
  const markdownFileKey = `${projectId}::${file.name}`;
  const status = file.artifactManifest?.status ?? 'complete';
  const isStreaming = status === 'streaming';
  const isError = status === 'error';
  const exportTitle = file.name.replace(/\.mdx?$/i, '') || file.name;
  const viewerOnlyDisabledTitle = t('fileViewer.readonlySharedNoExport');

  const downloadTextDocument = useCallback(async (format: 'txt' | 'docx') => {
    if (viewerOnly) return;
    setDownloadMenuOpen(false);
    setDocumentExporting(format);
    try {
      const source = textRef.current;
      const result = await exportProjectTextDocument({
        projectId,
        source,
        title: exportTitle,
        format,
        workspaceContext,
      });
      if (!result.ok && typeof window !== 'undefined') {
        window.alert(result.error);
      }
    } finally {
      setDocumentExporting(null);
    }
  }, [exportTitle, file.name, projectId, viewerOnly, workspaceContext]);

  useEffect(() => {
    if (!viewerOnly) return;
    setMode('document');
    setDownloadMenuOpen(false);
  }, [viewerOnly]);

  useEffect(() => {
    const sameLoadedFile = loadedFileKeyRef.current === markdownFileKey;
    if (
      sameLoadedFile &&
      lastSavedTextRef.current !== null &&
      textRef.current !== lastSavedTextRef.current
    ) {
      return undefined;
    }
    if (!sameLoadedFile) {
      setText(null);
      setMode('document');
      previousModeRef.current = 'document';
    }
    copiedMarkdownBlockRef.current = null;
    if (copyBlockTimerRef.current) {
      window.clearTimeout(copyBlockTimerRef.current);
      copyBlockTimerRef.current = null;
    }
    let cancelled = false;
    void fetchProjectFileText(projectId, file.name, { workspaceContext }).then((next) => {
      if (cancelled) return;
      if (
        loadedFileKeyRef.current === markdownFileKey &&
        lastSavedTextRef.current !== null &&
        textRef.current !== lastSavedTextRef.current
      ) {
        return;
      }
      const loaded = next ?? '';
      if (
        sameLoadedFile &&
        lastSavedTextRef.current !== null &&
        textRef.current === lastSavedTextRef.current &&
        loaded === lastSavedTextRef.current
      ) {
        loadedFileKeyRef.current = markdownFileKey;
        pendingSaveAfterFlightRef.current = null;
        setSaveState((current) => current === 'saved' ? current : 'idle');
        return;
      }
      textRef.current = loaded;
      lastSavedTextRef.current = loaded;
      loadedFileKeyRef.current = markdownFileKey;
      pendingSaveAfterFlightRef.current = null;
      setSaveState('idle');
      setLoadError('');
      setText(loaded);
    }).catch(cause => { if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause)); });
    return () => {
      cancelled = true;
    };
  }, [projectId, file.name, file.mtime, markdownFileKey]);

  useEffect(() => {
    return () => {
      copiedMarkdownBlockRef.current = null;
      if (copyBlockTimerRef.current) {
        window.clearTimeout(copyBlockTimerRef.current);
      }
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (scrollSyncFrameRef.current) {
        window.cancelAnimationFrame(scrollSyncFrameRef.current);
        scrollSyncFrameRef.current = null;
      }
      if (programmaticScrollClearFrameRef.current) {
        window.cancelAnimationFrame(programmaticScrollClearFrameRef.current);
        programmaticScrollClearFrameRef.current = null;
      }
      pendingScrollSyncRef.current = null;
      programmaticScrollRef.current = null;
      activeMarkdownScrollPaneRef.current = 'editor';
    };
  }, []);

  const saveMarkdownText = useCallback(
    (value: string, options: MarkdownSaveOptions = {}) => {
      if (viewerOnly) return;
      const run = async (nextValue: string, saveOptions: MarkdownSaveOptions): Promise<void> => {
        if (lastSavedTextRef.current === nextValue) {
          const showSaving = saveOptions.showSaving !== false;
          if (textRef.current === nextValue) setSaveState(showSaving ? 'saved' : 'idle');
          if (saveOptions.refreshFiles !== false && onFileSaved) {
            void Promise.resolve(onFileSaved()).catch(() => undefined);
          }
          return;
        }
        if (saveInFlightRef.current) {
          pendingSaveAfterFlightRef.current = pendingSaveAfterFlightRef.current
            ? mergeMarkdownSaveOptions(pendingSaveAfterFlightRef.current, saveOptions)
            : saveOptions;
          return;
        }
        saveInFlightRef.current = true;
        const showSaving = saveOptions.showSaving !== false;
        if (showSaving) setSaveState('saving');
        try {
          const saved = await writeProjectTextFile(projectId, file.name, nextValue, undefined, workspaceContext);
          if (!saved) throw new Error('write failed');
          lastSavedTextRef.current = nextValue;
          onTextSaved?.(file.name, nextValue);
          bumpSavedRevision((n) => n + 1);
          setSavedAt(Date.now());
          if (textRef.current === nextValue) setSaveState(showSaving ? 'saved' : 'idle');
          if (saveOptions.refreshFiles !== false && onFileSaved) {
            void Promise.resolve(onFileSaved()).catch(() => undefined);
          }
        } catch {
          if (textRef.current === nextValue) setSaveState('error');
        } finally {
          saveInFlightRef.current = false;
          const pending = pendingSaveAfterFlightRef.current;
          if (pending) {
            pendingSaveAfterFlightRef.current = null;
            const latest = textRef.current;
            if (latest !== lastSavedTextRef.current) {
              void run(latest, pending);
            } else {
              const showPendingSaving = pending.showSaving !== false;
              if (textRef.current === latest) setSaveState(showPendingSaving ? 'saved' : 'idle');
              if (pending.refreshFiles !== false && onFileSaved) {
                void Promise.resolve(onFileSaved()).catch(() => undefined);
              }
            }
          }
        }
      };
      void run(value, options);
    },
    [file.name, onFileSaved, onTextSaved, projectId, viewerOnly],
  );

  const flushPendingMarkdownSave = useCallback(() => {
    if (viewerOnly) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const latest = textRef.current;
    if (lastSavedTextRef.current !== null && latest !== lastSavedTextRef.current) {
      saveMarkdownText(latest, { refreshFiles: false, showSaving: false });
    }
  }, [saveMarkdownText, viewerOnly]);

  useEffect(() => {
    return () => {
      flushPendingMarkdownSave();
    };
  }, [flushPendingMarkdownSave]);

  useEffect(() => {
    if (text === null) return undefined;
    textRef.current = text;
    if (viewerOnly) return undefined;
    if (text === lastSavedTextRef.current) return undefined;
    setSaveState((current) => current === 'saved' ? 'idle' : current);
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      saveMarkdownText(textRef.current, { refreshFiles: false, showSaving: false });
    }, 700);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [saveMarkdownText, text, viewerOnly]);

  useEffect(() => {
    const root = document.documentElement;
    const bump = () => setHighlightThemeRevision((revision) => revision + 1);
    const observer = new MutationObserver(bump);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', bump);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', bump);
    };
  }, []);

  async function copy() {
    if (text == null) return;
    const didCopy = await copyTextToClipboard(text);
    if (didCopy) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  const insertTextAtSelection = useCallback((insert: string) => {
    setText((current) => {
      if (viewerOnly) return current;
      if (current === null) return current;
      const editor = editorRef.current;
      if (!editor) return `${current}${insert}`;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const next = `${current.slice(0, start)}${insert}${current.slice(end)}`;
      window.requestAnimationFrame(() => {
        const nextCursor = start + insert.length;
        editor.focus();
        editor.setSelectionRange(nextCursor, nextCursor);
      });
      return next;
    });
  }, [viewerOnly]);

  const insertImageFiles = useCallback(
    async (files: File[]): Promise<boolean> => {
      if (viewerOnly) return false;
      const images = files.filter((item) => isMarkdownImageFile(item));
      if (images.length === 0) return false;
      const targetDir = markdownDirectory(file.name);
      const result = await uploadProjectFiles(projectId, images, targetDir, workspaceContext);
      if (result.uploaded.length > 0) {
        await onFileSaved?.();
        const snippet = result.uploaded
          .map((item) => {
            const alt = markdownImageAlt(item.name);
            const path = markdownRelativeProjectPath(file.name, item.path);
            return `![${alt}](${path})`;
          })
          .join('\n');
        insertTextAtSelection(`\n${snippet}\n`);
      }
      return true;
    },
    [file.name, insertTextAtSelection, onFileSaved, projectId, viewerOnly],
  );

  function handleEditorPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    if (viewerOnly) return;
    const files = Array.from(event.clipboardData.files ?? []);
    if (!files.some(isMarkdownImageFile)) return;
    event.preventDefault();
    void insertImageFiles(files);
  }

  function handleEditorDrop(event: ReactDragEvent<HTMLTextAreaElement>) {
    if (viewerOnly) return;
    const files = Array.from(event.dataTransfer.files ?? []);
    if (!files.some(isMarkdownImageFile)) return;
    event.preventDefault();
    void insertImageFiles(files);
  }

  // The markdown doc auto-saves on a debounce, so the toolbar shows a passive
  // status (when it last auto-saved) instead of a manual Save button that is
  // disabled almost all the time. Typing stays quiet: the indicator keeps the
  // last auto-saved time and only refreshes once the debounced save lands, so
  // there is no per-keystroke "Saving…" flicker. `saving` is reserved for an
  // explicit, foreground write (the error-retry path).
  const autoSaveStatus: 'error' | 'saving' | 'saved' | 'idle' =
    saveState === 'error'
      ? 'error'
      : saveState === 'saving'
        ? 'saving'
        : savedAt != null
          ? 'saved'
          : 'idle';
  const autoSaveTime =
    savedAt != null
      ? new Date(savedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      : null;
  const autoSaveLabel =
    autoSaveStatus === 'error'
      ? t('fileViewer.markdownSaveFailed')
      : autoSaveStatus === 'saving'
        ? t('fileViewer.markdownSaving')
        : autoSaveStatus === 'saved' && autoSaveTime
          ? t('fileViewer.markdownAutoSaved', { time: autoSaveTime })
          : t('fileViewer.markdownAutoSaveHint');
  const showEditor = mode === 'edit' || mode === 'split';
  const showPreview = mode === 'split';
  const showDocument = mode === 'document';

  const renderedMarkdownHtml = useMemo(() => {
    if (text === null) return null;
    return sanitizeMarkdownWordHtml(renderMarkdownToSafeHtml(text, { allowDangerousHtml: true }));
  }, [text]);

  const baseHtml = useMemo(() => {
    if (renderedMarkdownHtml === null) return null;
    return rewriteMarkdownImageSources(
      decorateMarkdownCodeBlocks(renderedMarkdownHtml),
      projectId,
      file.name,
      workspaceContext,
    );
  }, [file.name, projectId, renderedMarkdownHtml, workspaceContext]);
  const html = highlightedHtml?.source === baseHtml && highlightedHtml.themeRevision === highlightThemeRevision
    ? highlightedHtml.html
    : baseHtml;
  const markdownBlockLines = useMemo(() => extractMarkdownBlockLines(text ?? ''), [text]);

  // The cached editor block offsets become stale whenever the source text
  // changes (line positions move) — drop them so the next sync remeasures.
  useEffect(() => {
    editorBlockOffsetsRef.current = null;
  }, [text]);

  useEffect(() => {
    if (!baseHtml) {
      setHighlightedHtml(null);
      return undefined;
    }
    let cancelled = false;
    highlightMarkdownCodeBlocks(baseHtml).then((nextHtml) => {
      if (cancelled) return;
      setHighlightedHtml(nextHtml === baseHtml ? null : { source: baseHtml, html: nextHtml, themeRevision: highlightThemeRevision });
    }).catch(() => {
      if (!cancelled) setHighlightedHtml(null);
    });
    return () => {
      cancelled = true;
    };
  }, [baseHtml, highlightThemeRevision]);

  const clearProgrammaticScrollSoon = useCallback(() => {
    if (programmaticScrollClearFrameRef.current) {
      window.cancelAnimationFrame(programmaticScrollClearFrameRef.current);
    }
    programmaticScrollClearFrameRef.current = window.requestAnimationFrame(() => {
      programmaticScrollClearFrameRef.current = window.requestAnimationFrame(() => {
        programmaticScrollRef.current = null;
        programmaticScrollClearFrameRef.current = null;
      });
    });
  }, []);

  const getEditorBlockOffsets = useCallback((): number[] | null => {
    const editor = editorRef.current;
    if (!editor || markdownBlockLines.length === 0) return null;
    const width = editor.clientWidth;
    const cached = editorBlockOffsetsRef.current;
    if (cached && cached.width === width && cached.offsets.length === markdownBlockLines.length) {
      return cached.offsets;
    }
    const offsets = measureEditorBlockOffsets(editor, markdownBlockLines, textRef.current);
    if (!offsets) return null;
    editorBlockOffsetsRef.current = { width, offsets };
    return offsets;
  }, [markdownBlockLines]);

  // Align the panes by matching each top-level markdown block's source line to
  // its rendered element, then interpolating scroll position between those
  // anchors. Falls back to proportional (ratio) sync when block anchors are
  // unavailable (e.g. raw-HTML blocks change the rendered child count).
  const computeMarkdownSyncTarget = useCallback(
    (sourcePane: MarkdownScrollPane, source: HTMLElement, target: HTMLElement): number => {
      const previewPane = markdownPreviewPaneRef.current;
      if (markdownBlockLines.length > 0 && previewPane) {
        const editorOffsets = getEditorBlockOffsets();
        const previewOffsets = editorOffsets
          ? measurePreviewBlockOffsets(previewPane, markdownBlockLines.length)
          : null;
        if (editorOffsets && previewOffsets) {
          const isEditorSource = sourcePane === 'editor';
          const sourceOffsets = isEditorSource ? editorOffsets : previewOffsets;
          const targetOffsets = isEditorSource ? previewOffsets : editorOffsets;
          const sourceAnchors = buildScrollAnchors(sourceOffsets, source.scrollHeight);
          const targetAnchors = buildScrollAnchors(targetOffsets, target.scrollHeight);
          const mapped = mapScrollPosition(source.scrollTop, sourceAnchors, targetAnchors);
          return Math.max(0, Math.min(markdownScrollRange(target), mapped));
        }
      }
      return markdownScrollTopForRatio(target, markdownScrollRatio(source));
    },
    [getEditorBlockOffsets, markdownBlockLines],
  );

  const applyMarkdownScrollSync = useCallback(
    (sourcePane: MarkdownScrollPane, targetPane: MarkdownScrollPane) => {
      const source = sourcePane === 'editor' ? editorRef.current : markdownPreviewPaneRef.current;
      const target = targetPane === 'editor' ? editorRef.current : markdownPreviewPaneRef.current;
      if (mode !== 'split' || !source || !target) return;
      const targetTop = computeMarkdownSyncTarget(sourcePane, source, target);
      if (Math.abs(target.scrollTop - targetTop) < 1) return;
      programmaticScrollRef.current = { pane: targetPane, top: targetTop };
      target.scrollTop = targetTop;
      clearProgrammaticScrollSoon();
    },
    [clearProgrammaticScrollSoon, computeMarkdownSyncTarget, mode],
  );

  const scheduleMarkdownScrollSync = useCallback(
    (sourcePane: MarkdownScrollPane, targetPane: MarkdownScrollPane) => {
      if (mode !== 'split') {
        pendingScrollSyncRef.current = null;
        return;
      }
      pendingScrollSyncRef.current = { sourcePane, targetPane };
      if (scrollSyncFrameRef.current !== null) return;
      scrollSyncFrameRef.current = window.requestAnimationFrame(() => {
        scrollSyncFrameRef.current = null;
        const pending = pendingScrollSyncRef.current;
        pendingScrollSyncRef.current = null;
        if (!pending) return;
        applyMarkdownScrollSync(pending.sourcePane, pending.targetPane);
      });
    },
    [applyMarkdownScrollSync, mode],
  );

  const shouldIgnoreMarkdownScroll = useCallback((pane: MarkdownScrollPane, element: HTMLElement): boolean => {
    const programmatic = programmaticScrollRef.current;
    if (programmatic?.pane !== pane) return false;
    if (Math.abs(element.scrollTop - programmatic.top) > 1 && activeMarkdownScrollPaneRef.current === pane) {
      return false;
    }
    programmaticScrollRef.current = null;
    return true;
  }, []);

  const handleMarkdownEditorScroll = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || shouldIgnoreMarkdownScroll('editor', editor)) return;
    activeMarkdownScrollPaneRef.current = 'editor';
    scheduleMarkdownScrollSync('editor', 'preview');
  }, [scheduleMarkdownScrollSync, shouldIgnoreMarkdownScroll]);

  const handleMarkdownPreviewScroll = useCallback(() => {
    const previewPane = markdownPreviewPaneRef.current;
    if (!previewPane || shouldIgnoreMarkdownScroll('preview', previewPane)) return;
    if (activeMarkdownScrollPaneRef.current !== 'preview') return;
    scheduleMarkdownScrollSync('preview', 'editor');
  }, [scheduleMarkdownScrollSync, shouldIgnoreMarkdownScroll]);

  const activateMarkdownScrollPane = useCallback((pane: MarkdownScrollPane) => {
    activeMarkdownScrollPaneRef.current = pane;
  }, []);

  useEffect(() => {
    const article = markdownArticleRef.current;
    if (!article) return;
    ensureMarkdownCodeBlockControls(article, t);
    if (copiedMarkdownBlockRef.current?.isConnected) {
      setMarkdownCodeBlockCopiedState(copiedMarkdownBlockRef.current, true, t);
    }
  }, [html, mode, t]);

  useEffect(() => {
    if (mode !== 'split') {
      if (scrollSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollSyncFrameRef.current);
        scrollSyncFrameRef.current = null;
      }
      if (programmaticScrollClearFrameRef.current !== null) {
        window.cancelAnimationFrame(programmaticScrollClearFrameRef.current);
        programmaticScrollClearFrameRef.current = null;
      }
      pendingScrollSyncRef.current = null;
      programmaticScrollRef.current = null;
      activeMarkdownScrollPaneRef.current = 'editor';
      previousModeRef.current = mode;
      return;
    }
    const sourcePane = activeMarkdownScrollPaneRef.current ?? (previousModeRef.current === 'document' ? 'preview' : 'editor');
    const targetPane = sourcePane === 'preview' ? 'editor' : 'preview';
    scheduleMarkdownScrollSync(sourcePane, targetPane);
    previousModeRef.current = mode;
  }, [html, mode, scheduleMarkdownScrollSync]);

  async function handleMarkdownBodyClick(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(`button[${MARKDOWN_COPY_BLOCK_ATTR}]`);
    if (!button) return;
    const block = button.closest('.markdown-code-block');
    if (!(block instanceof HTMLElement)) return;
    const pre = block.querySelector('pre');
    if (!pre) return;
    const didCopy = await copyTextToClipboard((pre.textContent ?? '').replace(/\n$/, ''));
    if (!didCopy) return;
    if (copiedMarkdownBlockRef.current && copiedMarkdownBlockRef.current !== block) {
      setMarkdownCodeBlockCopiedState(copiedMarkdownBlockRef.current, false, t);
    }
    copiedMarkdownBlockRef.current = block;
    setMarkdownCodeBlockCopiedState(block, true, t);
    if (copyBlockTimerRef.current) {
      window.clearTimeout(copyBlockTimerRef.current);
    }
    copyBlockTimerRef.current = window.setTimeout(() => {
      if (copiedMarkdownBlockRef.current) {
        setMarkdownCodeBlockCopiedState(copiedMarkdownBlockRef.current, false, t);
      }
      copiedMarkdownBlockRef.current = null;
      copyBlockTimerRef.current = null;
    }, 1800);
  }

  return (
    <div className="viewer text-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          {isStreaming ? <span className="viewer-meta">{t('fileViewer.markdownStreamingMeta')}</span> : null}
          {isError ? <span className="viewer-meta">{t('fileViewer.markdownErrorMeta')}</span> : null}
          <div className="viewer-tabs markdown-mode-tabs" role="tablist" aria-label={t('fileViewer.markdownViewMode')}>
            {(['edit', 'split', 'document'] as const).map((item) => (
              <Button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                className={`viewer-tab ${mode === item ? 'active' : ''}`}
                disabled={viewerOnly && item !== 'document'}
                title={viewerOnly && item !== 'document' ? viewerOnlyDisabledTitle : undefined}
                onClick={() => setMode(item)}
              >
                {item === 'edit'
                  ? t('fileViewer.source')
                  : item === 'split'
                    ? t('fileViewer.split')
                    : t('fileViewer.documentMeta')}
              </Button>
            ))}
          </div>
        </div>
        <div className="viewer-toolbar-actions">
          {viewerOnly ? (
            <span className="viewer-meta markdown-autosave markdown-autosave-idle">
              {viewerOnlyDisabledTitle}
            </span>
          ) : autoSaveStatus === 'error' ? (
            <Button
              type="button"
              className="viewer-action markdown-autosave markdown-autosave-error"
              onClick={() => {
                if (text !== null) saveMarkdownText(text);
              }}
              title={t('fileViewer.save')}
            >
              <Icon name="alert-triangle" size={13} />
              <span>{autoSaveLabel}</span>
            </Button>
          ) : (
            <span
              className={`viewer-meta markdown-autosave markdown-autosave-${autoSaveStatus}`}
            >
              {autoSaveStatus === 'saving' ? (
                <Icon name="spinner" size={13} className="icon-spin" />
              ) : autoSaveStatus === 'saved' ? (
                <Icon name="check" size={13} />
              ) : null}
              <span>{autoSaveLabel}</span>
            </span>
          )}
          <Button
            type="button"
            className="viewer-action"
            onClick={() => void copy()}
            title={t('fileViewer.copyTitle')}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            <span>{copied ? t('fileViewer.copied') : t('fileViewer.copy')}</span>
          </Button>
          {text !== null ? (
            <div className="share-menu chrome-share-menu" ref={downloadMenuRef}>
              <Button
                type="button"
                className="viewer-action"
                aria-haspopup="menu"
                aria-expanded={downloadMenuOpen}
                disabled={viewerOnly || documentExporting !== null}
                title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                onClick={() => setDownloadMenuOpen((v) => !v)}
              >
                <Icon
                  name={documentExporting ? 'spinner' : 'download'}
                  size={13}
                  className={documentExporting ? 'icon-spin' : undefined}
                />
                <span>{t('fileViewer.download')}</span>
              </Button>
              {downloadMenuOpen ? (
                <div className="share-menu-popover markdown-download-menu" role="menu">
                  <Button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    aria-label="Markdown (.md)"
                    disabled={viewerOnly}
                    title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                    onClick={() => {
                      if (viewerOnly) return;
                      setDownloadMenuOpen(false);
                      exportAsMd(text, exportTitle);
                    }}
                  >
                    <span className="share-menu-icon"><Icon name="file" size={15}  /></span>
                    <span className="markdown-download-label">Markdown</span>
                    <span className="markdown-download-extension">.md</span>
                  </Button>
                  <Button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    aria-label="TXT (.txt)"
                    disabled={viewerOnly || documentExporting !== null}
                    title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                    onClick={() => void downloadTextDocument('txt')}
                  >
                    <span className="share-menu-icon"><Icon name="file-text" size={15}  /></span>
                    <span className="markdown-download-label">TXT</span>
                    <span className="markdown-download-extension">.txt</span>
                  </Button>
                  <Button
                    type="button"
                    className="share-menu-item"
                    role="menuitem"
                    aria-label="Word (.docx)"
                    disabled={viewerOnly || documentExporting !== null}
                    title={viewerOnly ? viewerOnlyDisabledTitle : undefined}
                    onClick={() => void downloadTextDocument('docx')}
                  >
                    <span className="share-menu-icon"><Icon name="file-text" size={15}  /></span>
                    <span className="markdown-download-label">Word</span>
                    <span className="markdown-download-extension">.docx</span>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className={`viewer-body markdown-workbench markdown-workbench-${mode}`}>
        {text === null || html === null || renderedMarkdownHtml === null ? (
          <div className="viewer-empty" role={loadError ? 'alert' : undefined}>{loadError || t('fileViewer.loading')}</div>
        ) : (
          <>
            {showEditor ? (
              <section className="markdown-editor-pane" aria-label={t('fileViewer.markdownEditor')}>
                <Textarea
                  ref={editorRef}
                  className="markdown-editor"
                  value={text}
                  aria-label={t('fileViewer.markdownEditor')}
                  placeholder={t('fileViewer.markdownEditorPlaceholder')}
                  spellCheck
                  autoFocus
                  onFocus={() => activateMarkdownScrollPane('editor')}
                  onChange={(event) => {
                    activateMarkdownScrollPane('editor');
                    setText(event.currentTarget.value);
                  }}
                  onScroll={handleMarkdownEditorScroll}
                  onPaste={handleEditorPaste}
                  onDrop={handleEditorDrop}
                />
              </section>
            ) : null}
            {showPreview ? (
              <div className="markdown-preview-pane-wrap">
                <section
                  ref={markdownPreviewPaneRef}
                  className="markdown-preview-pane"
                  aria-label={t('fileViewer.markdownPreview')}
                  onPointerDown={() => activateMarkdownScrollPane('preview')}
                  onWheel={() => activateMarkdownScrollPane('preview')}
                  onTouchStart={() => activateMarkdownScrollPane('preview')}
                  onKeyDown={() => activateMarkdownScrollPane('preview')}
                  onFocus={() => activateMarkdownScrollPane('preview')}
                  onScroll={handleMarkdownPreviewScroll}
                >
                  {isStreaming ? <div className="markdown-status">{t('fileViewer.markdownStreamingStatus')}</div> : null}
                  {isError ? <div className="markdown-status markdown-status-error">{t('fileViewer.markdownErrorStatus')}</div> : null}
                  {/* Safe by contract: renderMarkdownToSafeHtml escapes raw HTML and rejects unsafe link protocols. */}
                  <article
                    ref={markdownArticleRef}
                    className="markdown-rendered"
                    onClick={(event) => void handleMarkdownBodyClick(event)}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                </section>
              </div>
            ) : null}
            {showDocument ? (
              <MarkdownWordDocument
                key={`${markdownFileKey}:${file.mtime}`}
                markdown={text}
                editable={!viewerOnly}
                onChange={setText}
                resolveImageSource={(source) => markdownImageSourceUrl(
                  projectId,
                  file.name,
                  source,
                  workspaceContext,
                ) ?? source}
                {...(!viewerOnly && onStageTextSelection
                  ? { onTextAction: (action: MarkdownTextSelectionAction, selection: MarkdownTextSelectionContext, instruction?: string) => onStageTextSelection(file, action, selection, instruction) }
                  : {})}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function isMarkdownImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
}

function markdownImageAlt(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'image';
}

function CodeWithLines({ text }: { text: string }) {
  const lines = text.split('\n');
  // Trailing newline produces a phantom empty line — keep gutter aligned.
  const gutter = lines.map((_, i) => `${i + 1}`).join('\n');
  return (
    <pre className="code-viewer">
      <code className="gutter" aria-hidden>
        {gutter}
      </code>
      <code className="lines">{text}</code>
    </pre>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function documentMetaLabel(file: ProjectFile, t: TranslateFn): string {
  if (file.kind === 'pdf') return t('fileViewer.pdfMeta');
  if (file.kind === 'document') return t('fileViewer.documentMeta');
  if (file.kind === 'presentation') return t('fileViewer.presentationMeta');
  if (file.kind === 'spreadsheet') return t('fileViewer.spreadsheetMeta');
  return t('fileViewer.binaryMeta', { size: humanSize(file.size) });
}
