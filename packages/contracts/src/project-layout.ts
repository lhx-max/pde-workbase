/** Project-relative defaults only. User-selected paths and imported application
 * source trees remain authoritative; these are NOT daemon data-root settings. */
export const PROJECT_LAYOUT = Object.freeze({
  uploads: 'inputs/uploads',
  collected: 'inputs/collected',
  attachments: 'inputs/attachments',
  text: 'sources/text',
  sketches: 'sources/sketches',
  storyboards: 'sources/storyboards',
  images: 'outputs/images',
  videos: 'outputs/videos',
  pages: 'outputs/pages',
  presentations: 'outputs/presentations',
  internal: '.bezierdesign',
  canvasState: '.bezierdesign/canvas-state.json',
  candidates: '.bezierdesign/candidates',
  // Preserve the private leaf names understood by team snapshot transports.
  versions: '.bezierdesign/.file-versions',
  liveArtifacts: '.bezierdesign/.live-artifacts',
});

/** Shared instruction for filesystem-capable generation, not a second path policy. */
export const PROJECT_LAYOUT_INSTRUCTIONS = `## Project file layout
For new independent files in a Loom managed project, use inputs/ for collected/uploaded references, sources/ for editable sources, outputs/ for deliverables, and .bezierdesign/ only for host-managed state. Default text sources go in ${PROJECT_LAYOUT.text}/; pages in ${PROJECT_LAYOUT.pages}/; decks in ${PROJECT_LAYOUT.presentations}/; images in ${PROJECT_LAYOUT.images}/; videos in ${PROJECT_LAYOUT.videos}/. JSON belongs beside the content it describes, not automatically in the project root.
Preserve explicit output paths supplied by the host or user and edit existing files in place. Do not move old files or reorganize an imported application repository. Keep an app/composition and its dependencies together inside its chosen project directory, preserving its own entrypoint conventions. When nesting a new HTML file, resolve asset links relative to that file. Never claim a file was written without filesystem execution.`;

export function projectLayoutPath(directory: string, relative: string): string {
  const parts = relative.replaceAll('\\', '/').split('/');
  if (!relative || parts.some(part => !part || part === '.' || part === '..' || part.includes('\0')) || /^[a-z]:/i.test(relative)) {
    throw new Error('invalid project-relative output path');
  }
  return `${directory}/${parts.join('/')}`;
}
export const canvasTextPath = (id: string) => projectLayoutPath(PROJECT_LAYOUT.text, `${id}.md`);
export const isCanvasTextPath = (value: string) => value.startsWith(`${PROJECT_LAYOUT.text}/`) || value.startsWith('画布文本/');
export const isCollectedPath = (value: string) => value.startsWith(`${PROJECT_LAYOUT.collected}/`) || value.startsWith('collected/');
export const isGeneratedImagePath = (value: string, id: string) => [PROJECT_LAYOUT.images, 'generated-images'].some(root => value.startsWith(`${root}/${id}-`));
export function workflowProjectPath(id: string, relative = ''): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) throw new Error('invalid workflow id');
  const base = relative.startsWith('deliverables/') ? `outputs/workflows/${id}`
    : relative.startsWith('inputs/') || relative.startsWith('assets/') || relative.startsWith('原始/') ? `inputs/workflows/${id}`
      : `.bezierdesign/workflows/${id}`;
  const suffix = relative.replace(/^(deliverables|inputs|assets)\//, '').replace(/^原始\//, 'intake/');
  return projectLayoutPath(base, suffix || 'case.json');
}
