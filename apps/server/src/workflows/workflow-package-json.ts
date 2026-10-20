import path from 'node:path';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { parseFrontmatter, type FrontmatterObject, type FrontmatterValue } from './frontmatter.js';

export interface WorkflowPackageJson {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  icon: string;
  author: string;
  org: string;
  license: string;
  versioning: {
    current: string;
    status: 'draft' | 'published' | 'archived';
    publishedAt?: string;
  };
  discovery: {
    scenarios: string[];
    body: string;
  };
  graph: {
    startNodeId: string;
    updatedAt?: string;
    nodes: WorkflowPackageGraphNode[];
    edges: WorkflowPackageGraphEdge[];
  };
  compatibility?: {
    entry?: string;
    entryFile?: string;
  };
}

export interface WorkflowPackageGraphNode {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface WorkflowPackageGraphEdge {
  id: string;
  source: string;
  target: string;
  [key: string]: unknown;
}

export function workflowPackageJsonFile(workflowsDir: string, workflowId: string): string {
  return path.join(workflowsDir, workflowId, 'workflow.json');
}

export async function readWorkflowPackageJson(
  workflowsDir: string,
  workflowId: string,
): Promise<WorkflowPackageJson | null> {
  try {
    const raw = await readFile(workflowPackageJsonFile(workflowsDir, workflowId), 'utf8');
    return normalizeWorkflowPackageJson(JSON.parse(raw) as unknown, workflowId);
  } catch {
    return null;
  }
}

export async function listWorkflowPackageJson(workflowsDir: string): Promise<WorkflowPackageJson[]> {
  let entries: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }> = [];
  try {
    entries = await readdir(workflowsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const workflows = await Promise.all(entries
    .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
    .map(entry => readWorkflowPackageJson(workflowsDir, entry.name)));
  return workflows.filter((workflow): workflow is WorkflowPackageJson => workflow !== null);
}

export async function writeWorkflowPackageJson(
  workflowsDir: string,
  workflow: WorkflowPackageJson,
): Promise<void> {
  const file = workflowPackageJsonFile(workflowsDir, workflow.id);
  const temporary = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

export interface WorkflowGraphConfigSnapshot {
  canvasPresentation?: 'run-group';
  id: string;
  version: 1 | 2;
  title: string;
  updatedAt: string;
  nodes?: Array<{
    id: string;
    kind: string;
    title: string;
    description: string;
    flowId?: string;
    position?: { x: number; y: number };
    resultSurfaces?: unknown;
    startConfig?: Record<string, unknown>;
    clarificationConfig?: Record<string, unknown>;
    agentConfig?: Record<string, unknown>;
    reviewConfig?: Record<string, unknown>;
    branchConfig?: Record<string, unknown>;
    deliveryConfig?: Record<string, unknown>;
  }>;
  edges?: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
}

/** Store the editable graph in workflow.json instead of leaving it trapped in SQLite. */
export function updateWorkflowPackageGraph(
  workflow: WorkflowPackageJson,
  config: WorkflowGraphConfigSnapshot,
): WorkflowPackageJson {
  if (workflow.id !== config.id) throw new Error('workflow.json 与画布工作流 ID 不一致');
  const nodes = config.nodes ?? [];
  const start = nodes.find(node => node.kind === 'start');
  if (!start) throw new Error('工作流必须有一个开始节点');
  // A direct delivery node is the final output surface. Persisting an Agent
  // confirmation alongside it would restore a stale intermediate result card
  // after refresh, even though runtime correctly hands output to delivery.
  const deliveryIds = new Set(nodes.filter(node => node.kind === 'delivery').map(node => node.id));
  const agentsWithDirectDelivery = new Set(
    (config.edges ?? []).filter(edge => deliveryIds.has(edge.target)).map(edge => edge.source),
  );
  return normalizeWorkflowPackageJson({
    ...workflow,
    graph: {
      startNodeId: start.id,
      updatedAt: config.updatedAt,
      nodes: nodes.map(node => {
        const configValue = nodeConfigValue(node);
        const normalizedConfigValue = node.kind === 'agent'
          && agentsWithDirectDelivery.has(node.id)
          && configValue
          ? (() => {
              const { confirmation: _confirmation, ...withoutConfirmation } = configValue;
              return withoutConfirmation;
            })()
          : configValue;
        return {
          id: node.id,
          type: node.kind,
          title: node.title,
          description: node.description,
          ...(node.flowId ? { flowId: node.flowId } : {}),
          ...(node.position ? { position: node.position } : {}),
          ...(node.resultSurfaces ? { resultSurfaces: node.resultSurfaces } : {}),
          ...(normalizedConfigValue ? { config: normalizedConfigValue } : {}),
        };
      }),
      edges: (config.edges ?? []).map(edge => ({ ...edge })),
    },
  }, workflow.id);
}

export function createWorkflowPackageJson(
  config: WorkflowGraphConfigSnapshot,
): WorkflowPackageJson {
  const start = config.nodes?.find(node => node.kind === 'start');
  if (!start) throw new Error('工作流必须有一个开始节点');
  const startConfig = start.startConfig ?? {};
  const workflowName = stringUnknown(startConfig.workflowName) || config.title || '新工作流';
  const baseline: WorkflowPackageJson = {
    schemaVersion: 1,
    id: config.id,
    name: workflowName,
    description: stringUnknown(startConfig.description),
    category: '未分类',
    tags: [],
    icon: 'sparkles',
    author: '',
    org: '',
    license: 'internal',
    versioning: { current: '0.1.0', status: 'draft' },
    discovery: {
      scenarios: stringArrayUnknown(startConfig.triggerScenarios),
      body: defaultDiscoveryBody(workflowName),
    },
    graph: { startNodeId: start.id, nodes: [], edges: [] },
  };
  const markdown = stringUnknown(startConfig.workflowMarkdown);
  return updateWorkflowPackageGraph(
    markdown ? updateWorkflowPackageFromMarkdown(baseline, markdown) : baseline,
    config,
  );
}

/** Rehydrate the canvas editor/runtime from the durable workflow.json graph. */
export function workflowGraphConfigFromPackage(
  workflow: WorkflowPackageJson,
): WorkflowGraphConfigSnapshot {
  const nodes = workflow.graph.nodes.map(node => {
    const kind = node.type;
    const config = plainObject(node.config);
    const position = pointValue(node.position);
    const base = {
      id: node.id,
      kind,
      title: typeof node.title === 'string' ? node.title : kind === 'start' ? '开始' : node.id,
      description: typeof node.description === 'string' ? node.description : '',
      ...(typeof node.flowId === 'string' && node.flowId.trim() ? { flowId: node.flowId.trim() } : {}),
      ...(position ? { position } : {}),
      ...(Array.isArray(node.resultSurfaces) ? { resultSurfaces: node.resultSurfaces } : {}),
    };
    if (kind === 'start') return {
      ...base,
      startConfig: {
        ...config,
        workflowName: workflow.name,
        description: workflow.description,
        triggerScenarios: workflow.discovery.scenarios,
        workflowMarkdown: renderWorkflowEditorMarkdown(workflow),
      },
    };
    const key = nodeConfigKey(kind);
    return key && config ? { ...base, [key]: config } : base;
  });
  return {
    id: workflow.id,
    version: 2,
    canvasPresentation: 'run-group',
    title: workflow.name,
    updatedAt: workflow.graph.updatedAt || workflow.versioning.publishedAt || workflow.versioning.current,
    nodes,
    edges: workflow.graph.edges.map(edge => ({ ...edge })),
  };
}

function nodeConfigValue(node: NonNullable<WorkflowGraphConfigSnapshot['nodes']>[number]): Record<string, unknown> | undefined {
  if (node.kind === 'start') {
    const { workflowMarkdown: _markdown, workflowName: _name, description: _description, triggerScenarios: _scenarios, ...config } = node.startConfig ?? {};
    return config;
  }
  if (node.kind === 'clarify') return node.clarificationConfig;
  if (node.kind === 'agent') return node.agentConfig;
  if (node.kind === 'review') return node.reviewConfig;
  if (node.kind === 'branch') return node.branchConfig;
  if (node.kind === 'delivery') return node.deliveryConfig;
  return undefined;
}

function nodeConfigKey(kind: string): 'clarificationConfig' | 'agentConfig' | 'reviewConfig' | 'branchConfig' | 'deliveryConfig' | null {
  if (kind === 'clarify') return 'clarificationConfig';
  if (kind === 'agent') return 'agentConfig';
  if (kind === 'review') return 'reviewConfig';
  if (kind === 'branch') return 'branchConfig';
  if (kind === 'delivery') return 'deliveryConfig';
  return null;
}

function plainObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function pointValue(value: unknown): { x: number; y: number } | undefined {
  const point = plainObject(value);
  return point && typeof point.x === 'number' && typeof point.y === 'number'
    ? { x: point.x, y: point.y }
    : undefined;
}

function stringUnknown(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArrayUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : [];
}

/** Markdown shown by the start card. It intentionally contains no stage-file routing. */
export function renderWorkflowEditorMarkdown(workflow: WorkflowPackageJson): string {
  return renderWorkflowMarkdown(workflow, false);
}

/**
 * Temporary adapter for the existing package registry. The legacy entry
 * fields disappear once the four stage Markdown files are migrated to graph
 * nodes, but until then the old runtime must remain launchable.
 */
export function renderWorkflowCompatibilityMarkdown(workflow: WorkflowPackageJson): string {
  return renderWorkflowMarkdown(workflow, true);
}

export function updateWorkflowPackageFromMarkdown(
  current: WorkflowPackageJson,
  markdown: string,
): WorkflowPackageJson {
  const { data, body } = parseFrontmatter(markdown);
  const id = stringValue(data.id);
  if (id && id !== current.id) throw new Error(`WORKFLOW.md 中的 id 必须保持为 ${current.id}`);
  const versioning = objectValue(data.versioning);
  const status = workflowStatus(stringValue(versioning?.status), current.versioning.status);
  const publishedAt = stringValue(versioning?.published_at) || current.versioning.publishedAt;
  return {
    ...current,
    name: stringValue(data.name) || current.name,
    description: stringValue(data.description),
    category: stringValue(data.category) || current.category,
    tags: stringList(data.tags),
    icon: stringValue(data.icon) || current.icon,
    author: stringValue(data.author),
    org: stringValue(data.org),
    license: stringValue(data.license) || current.license,
    versioning: {
      current: stringValue(versioning?.current) || current.versioning.current,
      status,
      ...(publishedAt ? { publishedAt } : {}),
    },
    discovery: {
      scenarios: stringList(data.scenarios),
      body: body.trim() || defaultDiscoveryBody(stringValue(data.name) || current.name),
    },
  };
}

function renderWorkflowMarkdown(workflow: WorkflowPackageJson, includeCompatibility: boolean): string {
  const lines = [
    '---',
    `id: ${workflow.id}`,
    `name: ${yamlString(workflow.name)}`,
    `description: ${yamlString(workflow.description)}`,
    `category: ${yamlString(workflow.category)}`,
    `tags: [${workflow.tags.map(yamlString).join(', ')}]`,
    `icon: ${workflow.icon}`,
    '',
    'scenarios:',
    ...workflow.discovery.scenarios.map(item => `  - ${yamlString(item)}`),
  ];
  if (includeCompatibility && workflow.compatibility?.entry) {
    lines.push('', `entry: ${workflow.compatibility.entry}`);
    if (workflow.compatibility.entryFile) lines.push(`entry_file: ${workflow.compatibility.entryFile}`);
  }
  lines.push(
    '',
    `author: ${workflow.author}`,
    `org: ${workflow.org}`,
    `license: ${workflow.license}`,
    'versioning:',
    `  current: ${workflow.versioning.current}`,
    `  status: ${workflow.versioning.status}`,
  );
  if (workflow.versioning.publishedAt) lines.push(`  published_at: ${workflow.versioning.publishedAt}`);
  lines.push('---', '', workflow.discovery.body.trim(), '');
  return lines.join('\n');
}

function normalizeWorkflowPackageJson(value: unknown, expectedId: string): WorkflowPackageJson {
  if (!isObject(value)) throw new Error('workflow.json 必须是对象');
  const id = stringValue(value.id);
  if (!id || id !== expectedId) throw new Error('workflow.json id 与目录不一致');
  const versioning = objectValue(value.versioning);
  const discovery = objectValue(value.discovery);
  const graph = objectValue(value.graph);
  const compatibility = objectValue(value.compatibility);
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const canonicalGraph = {
    nodes: normalizeGraphNodes(nodes),
    edges: normalizeGraphEdges(edges),
  };
  const startNodeId = stringValue(graph?.startNodeId) || 'start';
  if (!nodes.some(node => isObject(node) && stringValue(node.id) === startNodeId && node.type === 'start')) {
    throw new Error('workflow.json 缺少开始节点');
  }
  return {
    schemaVersion: 1,
    id,
    name: stringValue(value.name) || id,
    description: stringValue(value.description),
    category: stringValue(value.category) || '未分类',
    tags: stringList(value.tags),
    icon: stringValue(value.icon) || 'sparkles',
    author: stringValue(value.author),
    org: stringValue(value.org),
    license: stringValue(value.license) || 'internal',
    versioning: {
      current: stringValue(versioning?.current) || '0.1.0',
      status: workflowStatus(stringValue(versioning?.status), 'draft'),
      ...(stringValue(versioning?.publishedAt) ? { publishedAt: stringValue(versioning?.publishedAt) } : {}),
    },
    discovery: {
      scenarios: stringList(discovery?.scenarios),
      body: stringValue(discovery?.body) || defaultDiscoveryBody(stringValue(value.name) || id),
    },
    graph: {
      startNodeId,
      ...(stringValue(graph?.updatedAt) ? { updatedAt: stringValue(graph?.updatedAt) } : {}),
      nodes: canonicalGraph.nodes,
      edges: canonicalGraph.edges,
    },
    ...(compatibility ? { compatibility: {
      ...(stringValue(compatibility.entry) ? { entry: stringValue(compatibility.entry) } : {}),
      ...(stringValue(compatibility.entryFile) ? { entryFile: stringValue(compatibility.entryFile) } : {}),
    } } : {}),
  };
}

function normalizeGraphNodes(nodes: unknown[]): WorkflowPackageGraphNode[] {
  return nodes.flatMap(node => {
    if (!isObject(node)) return [];
    const id = stringValue(node.id);
    const type = stringValue(node.type);
    return id && type ? [{ ...node, id, type }] : [];
  });
}

function normalizeGraphEdges(edges: unknown[]): WorkflowPackageGraphEdge[] {
  return edges.flatMap(edge => {
    if (!isObject(edge)) return [];
    const id = stringValue(edge.id);
    const source = stringValue(edge.source);
    const target = stringValue(edge.target);
    return id && source && target ? [{ ...edge, id, source, target }] : [];
  });
}

function startIncludesProjectContext(nodes: unknown[], startNodeId: string): boolean {
  const start = nodes.find(node => isObject(node) && stringValue(node.id) === startNodeId);
  const config = start && isObject(start) ? objectValue(start.config) : undefined;
  return config?.includeProjectContext !== false;
}

function defaultDiscoveryBody(name: string): string {
  return [
    `# ${name}`,
    '',
    '## 场景匹配',
    '',
    '- 根据 description 与触发场景判断用户任务是否属于本流程。',
    '- 任务不明确时不要猜测启动，由画布连接的询问节点补齐信息。',
    '',
    '## 启动约定',
    '',
    '- 命中后只启动工作流，后续顺序由画布节点和连线决定。',
  ].join('\n');
}

function isObject(value: unknown): value is Record<string, FrontmatterValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function objectValue(value: FrontmatterValue | undefined): FrontmatterObject | undefined {
  return isObject(value) ? value : undefined;
}

function stringValue(value: FrontmatterValue | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: FrontmatterValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : [];
}

function workflowStatus(value: string, fallback: WorkflowPackageJson['versioning']['status']): WorkflowPackageJson['versioning']['status'] {
  return value === 'published' || value === 'archived' || value === 'draft' ? value : fallback;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
