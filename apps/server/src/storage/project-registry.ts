import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Project, ProjectMetadata, ProjectTabsState, ProjectBrowserWorkspaceTab } from '@bezier/contracts';
import { isSafeId } from '../projects.js';
import { assertProjectPathHasNoSymlinks } from '../project-layout.js';

// Project DTO and tab normalization retained from upstream db.ts; independent JSON storage.
function normalizeBrowserWorkspaceTab(value: unknown): ProjectBrowserWorkspaceTab | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id.trim()) return null;
  if (typeof record.label !== 'string' || !record.label.trim()) return null;
  const tab: ProjectBrowserWorkspaceTab = { id: record.id, label: record.label };
  if (record.insertAfter === null) tab.insertAfter = null;
  else if (typeof record.insertAfter === 'string') tab.insertAfter = record.insertAfter;
  if (typeof record.title === 'string' && record.title.trim()) tab.title = record.title;
  if (typeof record.url === 'string' && record.url.trim()) tab.url = record.url;
  if (typeof record.iconUrl === 'string' && record.iconUrl.trim()) tab.iconUrl = record.iconUrl;
  return tab;
}

export interface CreateProjectInput { id?: string; name: string; metadata?: ProjectMetadata }
interface RegistryState { version: 1; projects: Project[]; tabs: Record<string, ProjectTabsState> }

/** One registry per resolved runtime root; never infers storage from cwd or environment. */
export function createProjectRegistry(dataRoot: string) {
  if (!path.isAbsolute(dataRoot)) throw new Error('dataRoot must be explicitly resolved');
  dataRoot = path.resolve(dataRoot);
  mkdirSync(dataRoot, { recursive: true });
  assertProjectPathHasNoSymlinks(dataRoot, 'projects');
  const projectsRoot = path.join(dataRoot, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  const relative = 'project-registry.json';
  const file = path.join(dataRoot, relative);
  const load = (): RegistryState => {
    assertProjectPathHasNoSymlinks(dataRoot, relative);
    try {
      const state = JSON.parse(readFileSync(file, 'utf8')) as RegistryState;
      if (state.version !== 1 || !Array.isArray(state.projects) || !state.tabs || typeof state.tabs !== 'object') throw new Error('invalid project registry');
      for (const p of state.projects) if (!isSafeId(p.id) || p.metadata?.baseDir) throw new Error('invalid managed project');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, projects: [], tabs: {} };
      throw error;
    }
  };
  const save = (state: RegistryState) => {
    assertProjectPathHasNoSymlinks(dataRoot, relative);
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
    renameSync(temporary, file);
  };
  const get = (id: string): Project | null => {
    if (!isSafeId(id)) return null;
    return load().projects.find(p => p.id === id) ?? null;
  };
  const requireProject = (id: string): Project => {
    const project = get(id);
    if (!project) throw Object.assign(new Error('project not found'), { code: 'ENOENT' });
    return project;
  };
  return {
    dataRoot, projectsRoot, get,
    list: (): Project[] => load().projects.sort((a, b) => b.updatedAt - a.updatedAt),
    create(input: CreateProjectInput): Project {
      if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('name required');
      const id = input.id ?? randomUUID();
      if (!isSafeId(id) || id.startsWith('.')) throw new Error('invalid project id');
      if (input.metadata?.baseDir) throw new Error('Imported project roots require a configured host adapter');
      const state = load();
      if (state.projects.some(p => p.id === id)) throw Object.assign(new Error('project already exists'), { code: 'EEXIST' });
      assertProjectPathHasNoSymlinks(projectsRoot, id);
      mkdirSync(path.join(projectsRoot, id), { recursive: true });
      const now = Date.now();
      const project: Project = { id, name: input.name.trim(), skillId: null, designSystemId: null, createdAt: now, updatedAt: now, ...(input.metadata ? { metadata: structuredClone(input.metadata) } : {}) };
      state.projects.push(project);
      save(state);
      return project;
    },
    resolveProjectRoot(id: string): string {
      requireProject(id);
      assertProjectPathHasNoSymlinks(dataRoot, `projects/${id}`);
      return path.join(projectsRoot, id);
    },
    update(id: string, input: { name?: string }): Project {
      const project = requireProject(id);
      const state = load();
      const index = state.projects.findIndex(p => p.id === project.id);
      if (typeof input.name === 'string' && input.name.trim()) project.name = input.name.trim();
      project.updatedAt = Date.now();
      state.projects[index] = project;
      save(state);
      return project;
    },
    delete(id: string): void {
      requireProject(id);
      const state = load();
      state.projects = state.projects.filter(p => p.id !== id);
      delete state.tabs[id];
      save(state);
      rmSync(path.join(projectsRoot, id), { recursive: true, force: true });
    },
    getTabs(id: string): ProjectTabsState {
      requireProject(id);
      const tabs = load().tabs;
      return Object.hasOwn(tabs, id) ? tabs[id]! : { tabs: [], active: null, hasSavedState: false };
    },
    setTabs(id: string, input: ProjectTabsState): ProjectTabsState {
      requireProject(id);
      if (!Array.isArray(input.tabs) || !input.tabs.every(t => typeof t === 'string')) throw new Error('tabs must be string[]');
      if (input.browserTabs !== undefined && !Array.isArray(input.browserTabs)) throw new Error('browserTabs must be an array');
      const browserTabs = (input.browserTabs ?? []).map(normalizeBrowserWorkspaceTab).filter((tab): tab is ProjectBrowserWorkspaceTab => Boolean(tab));
      const tabs: ProjectTabsState = { tabs: input.tabs.slice(), active: typeof input.active === 'string' ? input.active : null, ...(browserTabs.length ? { browserTabs } : {}), hasSavedState: true, updatedAt: Date.now() };
      const state = load();
      Object.defineProperty(state.tabs, id, { value: tabs, enumerable: true, writable: true, configurable: true });
      save(state);
      return tabs;
    },
  };
}
export type ProjectRegistry = ReturnType<typeof createProjectRegistry>;
