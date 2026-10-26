'use client';

import { bindWorkflowLocale, LEGACY_AGENT_TITLE, LEGACY_CLARIFY_TITLE, wu } from './locales/workflow-ui';

import React from 'react';
import { useWorkflowApi } from './workflow-api';
import { workflowSourceOrder } from './workflow-source-order';
import { workflowNodeDataSnapshot } from './workflow-node-data';
import { WorkflowInputSummary, type WorkflowInputSummarySource } from './WorkflowInputSummary';
import { createPortal } from 'react-dom';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  useNodesInitialized,
  useInternalNode,
  useNodeId,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { WORKFLOW_ARTIFACT_OPTIONS, normalizeWorkflowExecutionConfirmation, type WorkflowArtifactTarget } from '@bezier/contracts';
import type { KnowledgeProviderId, SkillSummary, WorkflowResultSurface } from '@bezier/contracts';
import { Button, CanvasViewToolbar, Input, Select, Textarea } from '@bezier/components';
import type { CanvasBackgroundPattern, CanvasBackgroundTone } from '@bezier/components';
import { Icon } from './Icon';
import { WORKFLOW_NODE_ICONS } from './workflow-node-icons';
import intentStyles from './WorkflowEditorIntent.module.css';
import addMenuStyles from './WorkflowEditorAddMenu.module.css';

function artifactKindLabel(kind: string) {
  const labels: Record<string, string> = {
    text: wu().artifactText,
    page: wu().artifactPage,
    presentation: wu().artifactPresentation,
    image: wu().artifactImage,
    video: wu().artifactVideo,
  };
  return labels[kind] ?? kind;
}

function artifactComponentLabel(kind: string) {
  const labels: Record<string, string> = {
    text: wu().artifactComponentText,
    page: wu().artifactComponentPage,
    presentation: wu().artifactComponentPresentation,
    image: wu().artifactComponentImage,
    video: wu().artifactComponentVideo,
  };
  return labels[kind] ?? kind;
}
import inquiryStyles from './WorkflowEditorInquiry.module.css';
import stepStyles from './WorkflowEditorStep.module.css';
import { workflowNodePosition } from './workflow-node-position';
import {
  enabledKnowledgeIds,
  setKnowledgeEnabled,
  setStepSkipped,
  skippedStepIds,
  toStepActor,
  type SelectableStep,
} from './selection-state';
import {
  loadWorkflowEditorPresetFlows,
  migrateLegacyOutputContractToPrompt,
  stageSnapshotOf,
  type PlanFlowContract,
  type WorkflowAgentNodeConfig,
  type WorkflowBranchNodeConfig,
  type WorkflowBranchRouteConfig,
  type WorkflowClarificationNodeConfig,
  type WorkflowClarificationQuestionConfig,
  type WorkflowClarificationQuestionType,
  type WorkflowDeliveryNodeConfig,
  type WorkflowEditorConfig,
  type WorkflowEditorNodeKind,
  type WorkflowReviewNodeConfig,
  type WorkflowStartNodeConfig,
} from '@bezier/workbench-core';

const EMPTY_PRESET_FLOW_IDS: readonly string[] = Object.freeze([]);

const DEFAULT_POSITIONS = [
  { x: 90, y: 260 },
  { x: 350, y: 260 },
  { x: 680, y: 180 },
  { x: 1050, y: 300 },
  { x: 1380, y: 180 },
] as const;

function workflowNodeWidth(kind: WorkflowEditorNodeKind): number {
  if (kind === 'clarify') return 420;
  if (kind === 'agent' || kind === 'delivery') return 460;
  return 360;
}

function spreadOverlappingNodes(nodes: Array<Node<EditorNodeData>>): Array<Node<EditorNodeData>> {
  const positions = new Map<string, { x: number; y: number }>();
  let nextX = Number.NEGATIVE_INFINITY;
  for (const node of [...nodes].sort((a, b) => a.position.x - b.position.x)) {
    const x = Math.max(node.position.x, nextX);
    positions.set(node.id, { x, y: node.position.y });
    nextX = x + workflowNodeWidth(node.data.kind) + 50;
  }
  return nodes.map(node => ({ ...node, position: positions.get(node.id) || node.position }));
}

type EditorNodeData = {
  kind: WorkflowEditorNodeKind;
  eyebrow: string;
  title: string;
  summary: string;
  flowId?: string;
  resultSurfaces?: WorkflowResultSurface[];
  agentConfig?: WorkflowAgentNodeConfig;
  startConfig?: WorkflowStartNodeConfig;
  clarificationConfig?: WorkflowClarificationNodeConfig;
  reviewConfig?: WorkflowReviewNodeConfig;
  branchConfig?: WorkflowBranchNodeConfig;
  deliveryConfig?: WorkflowDeliveryNodeConfig;
  skillOptions?: SkillSummary[];
  knowledgeWikis?: Array<{ id: string; title: string; provider: KnowledgeProviderId }>;
  onTitleChange?: (title: string) => void;
  onPromptOpen?: () => void;
  onAgentConfigChange?: (patch: Partial<WorkflowAgentNodeConfig>) => void;
  /** A direct delivery successor owns the output, so an intermediate review cannot coexist. */
  deliveryConnected?: boolean;
  artifactTargets?: WorkflowArtifactTarget[];
  videoOptions?: { ratios: readonly string[]; durations: readonly number[] };
  onClarificationConfigChange?: (config: WorkflowClarificationNodeConfig) => void;
  onDeliveryConfigChange?: (config: WorkflowDeliveryNodeConfig) => void;
  onReviewConfigChange?: (config: WorkflowReviewNodeConfig) => void;
  renderArtifactSelect?: (props: {
    label: string; value: string; options: readonly { value: string; label: string }[];
    onValueChange: (value: string) => void;
  }) => React.ReactNode;
  renderClarificationPreview?: (config: WorkflowClarificationNodeConfig) => React.ReactNode;
  renderGenerationOptions?: (config: WorkflowDeliveryNodeConfig, onChange: (config: WorkflowDeliveryNodeConfig) => void) => React.ReactNode;
  renderReviewPreview?: (config: WorkflowReviewNodeConfig, onChange: (config: WorkflowReviewNodeConfig) => void) => React.ReactNode;
  renderSkillPicker?: (props: {
    skills: SkillSummary[];
    selectedSkillIds: string[];
    onPickSkill: (skill: SkillSummary) => void;
  }) => React.ReactNode;
  onBranchConfigChange?: (patch: Partial<WorkflowBranchNodeConfig>) => void;
  onBranchAddRoute?: () => void;
  onBranchRemoveRoute?: (routeId: string) => void;
  onBranchAddNext?: (routeId: string, kind: WorkflowEditorNodeKind) => void;
  onAddNext?: (kind: WorkflowEditorNodeKind) => void;
  onDelete?: () => void;
  cardNumber?: number;
  inputReferences?: string[];
  inputCandidates?: WorkflowInputSummarySource[];
  onInputReferencesChange?: (ids: string[]) => void;
  inputSources?: WorkflowInputSummarySource[];
  onLocateInput?: (nodeId: string) => void;
  onAddToConversation?: () => void;
  conversationFocused?: boolean;
  conversationDisabled?: boolean;
  tone: 'input' | 'agent' | 'delivery';
};

function normalizedClarificationConfig(config?: Partial<WorkflowClarificationNodeConfig>): WorkflowClarificationNodeConfig {
  const questions = Array.isArray(config?.questions)
    ? config.questions.map((question, index) => normalizedClarificationQuestion(question, index))
    : defaultClarificationQuestions();
  const allowedTypes = Array.isArray(config?.autoConfig?.allowedTypes)
    ? [...new Set(config.autoConfig.allowedTypes.filter(type => type === 'text' || type === 'single' || type === 'multiple'))]
    : ['text', 'single', 'multiple'] as WorkflowClarificationQuestionType[];
  const maxQuestions = Math.max(1, Math.min(5, Math.round(config?.autoConfig?.maxQuestions ?? 3)));
  return {
    // Preserve saved/manual questions in older snapshots that did not store a mode.
    mode: config?.mode ?? (config?.questions?.length ? 'configured' : 'auto'),
    questions: questions.length > 0 ? questions : defaultClarificationQuestions(),
    autoConfig: {
      instruction: config?.autoConfig?.instruction?.trim() || wu().mbdd961b2,
      maxQuestions,
      allowedTypes: allowedTypes.length > 0 ? allowedTypes : ['text'],
    },
    ...(config?.title?.trim() ? { title: config.title.trim() } : {}),
    ...(config?.description?.trim() ? { description: config.description.trim() } : {}),
    ...(config?.submitLabel?.trim() ? { submitLabel: config.submitLabel.trim() } : {}),
    ...(config?.attachmentsEnabled !== undefined
      ? { attachmentsEnabled: config.attachmentsEnabled }
      : {}),
  };
}

function defaultClarificationQuestions(): WorkflowClarificationQuestionConfig[] {
  return [
    {
      id: 'facts',
      titleMode: 'manual',
      title: wu().mcb730ad0,
      titleDirection: '',
      type: 'text',
      optionDirection: '',
      required: false,
      allowOther: false,
    },
  ];
}

function normalizedClarificationQuestion(
  question: Partial<WorkflowClarificationQuestionConfig>,
  index: number,
): WorkflowClarificationQuestionConfig {
  const type = question.type === 'single' || question.type === 'multiple' ? question.type : 'text';
  const titleMode = question.titleMode === 'ai' ? 'ai' : 'manual';
  return {
    id: question.id?.trim() || `question-${index + 1}`,
    titleMode,
    title: question.title?.trim() || (titleMode === 'manual' ? wu().question(index + 1) : ''),
    titleDirection: question.titleDirection?.trim() || '',
    type,
    optionDirection: type === 'text' ? '' : question.optionDirection?.trim() || '',
    required: question.required === true,
    allowOther: question.allowOther === true,
  };
}

function clarificationTypeLabels() {
  return { text: wu().mcd6a3728, single: wu().m3e886a9c, multiple: wu().m83c68005 };
}

function clarificationQuestionModes(config: WorkflowClarificationNodeConfig): string {
  const aiCount = config.questions.filter(question => question.titleMode === 'ai').length;
  const manualCount = config.questions.length - aiCount;
  return [manualCount ? wu().handwrittenCount(manualCount) : '', aiCount ? `AI ${aiCount}` : ''].filter(Boolean).join(' · ');
}

function normalizedStartConfig(
  config: WorkflowStartNodeConfig | undefined,
  fallbackName: string,
  workflowId?: string,
): WorkflowStartNodeConfig {
  const fallback = {
    workflowName: config?.workflowName || fallbackName,
    description: config?.description || '',
    triggerScenarios: [...(config?.triggerScenarios || [])],
    includeProjectContext: config?.includeProjectContext ?? true,
  };
  const metadata = config?.workflowMarkdown
    ? metadataFromWorkflowMarkdown(config.workflowMarkdown, fallback)
    : fallback;
  const sourceMarkdown = config?.workflowMarkdown || workflowMarkdownFromMetadata(metadata, workflowId);
  const workflowMarkdown = workflowId
    ? replaceWorkflowFrontmatterScalar(sourceMarkdown, 'id', workflowId)
    : sourceMarkdown;
  return {
    ...metadata,
    includeProjectContext: fallback.includeProjectContext,
    workflowMarkdown: completeWorkflowMarkdown(workflowMarkdown, metadata.workflowName),
  };
}

function workflowMarkdownBody(name: string): string {
  return [
    `# ${name}`,
    '',
    wu().m9d771fda,
    '',
    wu().mcb53848e,
    wu().m51960947,
    '',
    wu().m3a14fa90,
    '',
    wu().m610eb606,
    wu().m7ef19a49,
  ].join('\n');
}

function completeWorkflowMarkdown(markdown: string, workflowName: string): string {
  const frontmatterOnly = /^---\s*\n[\s\S]*?\n---\s*$/u.test(markdown);
  return frontmatterOnly ? `${markdown.trimEnd()}\n\n${workflowMarkdownBody(workflowName)}` : markdown;
}

function workflowMarkdownFromMetadata(
  metadata: Pick<WorkflowStartNodeConfig, 'workflowName' | 'description'>,
  workflowId: string = 'workflow',
): string {
  return [
    '---',
    `id: ${workflowId}`,
    `name: ${metadata.workflowName}`,
    `description: ${metadata.description}`,
    wu().mc1458cef,
    'tags: []',
    'icon: sparkles',
    '',
    'author: ',
    'org: ',
    'license: internal',
    'versioning:',
    '  current: 0.1.0',
    '  status: draft',
    '---',
    '',
    workflowMarkdownBody(metadata.workflowName),
  ].join('\n');
}

function workflowCardMetadata(markdown: string): { id: string; version: string; status: string } {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---(?:\s|$)/u);
  if (!match) return { id: wu().m55a04b58, version: wu().m55a04b58, status: wu().m0f436818 };
  const lines = (match[1] ?? '').split('\n');
  const scalar = (key: string) => {
    const matcher = new RegExp(`^\\s*${key}:\\s*`, 'u');
    const line = lines.find(item => matcher.test(item));
    return line === undefined ? '' : line.replace(matcher, '').trim();
  };
  const status = scalar('status');
  return {
    id: scalar('id') || wu().m55a04b58,
    version: scalar('current') || wu().m55a04b58,
    status: status === 'published' ? wu().m176a2eb4 : status === 'archived' ? wu().m5cfbea2b : wu().m0f436818,
  };
}

function replaceWorkflowFrontmatterScalar(markdown: string, key: string, value: string): string {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/u);
  if (!match) return markdown;
  const lines = (match[1] ?? '').split('\n');
  const matcher = new RegExp(`^${key}:\\s*`, 'u');
  const index = lines.findIndex(line => matcher.test(line));
  const nextLine = `${key}: ${value.replace(/\s+/gu, ' ').trim()}`;
  if (index >= 0) lines[index] = nextLine;
  else lines.push(nextLine);
  return markdown.replace(match[0], `---\n${lines.join('\n')}\n---`);
}

function metadataFromWorkflowMarkdown(markdown: string, fallback: WorkflowStartNodeConfig): Pick<WorkflowStartNodeConfig, 'workflowName' | 'description' | 'triggerScenarios'> {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---(?:\s|$)/u);
  if (!match) return { workflowName: fallback.workflowName, description: fallback.description, triggerScenarios: fallback.triggerScenarios };
  const lines = (match[1] ?? '').split('\n');
  const scalar = (key: string) => {
    const line = lines.find(item => item.match(new RegExp(`^${key}:\\s*`, 'u')));
    return line === undefined ? undefined : line.replace(new RegExp(`^${key}:\\s*`, 'u'), '').trim();
  };
  const scenariosAt = lines.findIndex(line => /^scenarios:\s*(?:\[\])?$/u.test(line));
  const scenarios: string[] = [];
  if (scenariosAt >= 0) {
    for (const line of lines.slice(scenariosAt + 1)) {
      if (!/^\s+-\s+/u.test(line)) break;
      const scenario = line.replace(/^\s+-\s+/u, '').trim();
      if (scenario) scenarios.push(scenario);
    }
  }
  return {
    workflowName: scalar('name') || fallback.workflowName,
    description: scalar('description') ?? fallback.description,
    triggerScenarios: scenariosAt >= 0 ? scenarios : fallback.triggerScenarios,
  };
}

function normalizedReviewConfig(config?: Partial<WorkflowReviewNodeConfig>): WorkflowReviewNodeConfig {
  const fallback = {
    enabled: config?.enabled ?? true,
    selection: config?.selection || 'single',
    selectionRequired: config?.selectionRequired ?? true,
    feedbackEnabled: config?.feedbackEnabled ?? true,
    feedbackRequired: config?.feedbackRequired ?? false,
    allowRegenerate: config?.allowRegenerate ?? true,
    continueLabel: config?.continueLabel?.trim() || wu().m82eb65e2,
  };
  return {
    ...fallback,
    ...(config?.title?.trim() ? { title: config.title.trim() } : {}),
    artifactKind: config?.artifactKind
      ? (['text', 'page', 'image', 'video'].includes(config.artifactKind) ? config.artifactKind : 'text')
      : 'text',
    materializeOnConfirm: config?.materializeOnConfirm ?? true,
    chat: { ...fallback, ...config?.chat },
    canvas: { ...fallback, ...config?.canvas },
  };
}

function normalizedDeliveryConfig(config?: WorkflowDeliveryNodeConfig): WorkflowDeliveryNodeConfig {
  const legacyKind = config?.artifactKind as string | undefined;
  const artifactKind: WorkflowDeliveryNodeConfig['artifactKind'] = legacyKind === 'canvas'
    ? 'page'
    : legacyKind === 'document' || legacyKind === 'file' || !legacyKind
      ? 'text'
      : legacyKind === 'page' || legacyKind === 'image' || legacyKind === 'video' || legacyKind === 'presentation'
        ? legacyKind
        : 'text';
  return {
    artifactKind,
    artifactName: config?.artifactName ?? '',
    requirements: config?.requirements ?? '',
    ...(artifactKind === 'presentation' ? { presentation: { ...config?.presentation } } : {}),
    ...(artifactKind === 'page' ? { page: { ...config?.page } } : {}),
    ...(artifactKind === 'text' ? { text: { ...config?.text } } : {}),
    ...(artifactKind === 'video' ? { video: { ...config?.video } } : {}),
    ...(artifactKind === 'image' ? {
      image: {
        ...config?.image,
        ratio: config?.image?.ratio ?? '1:1',
        count: Math.max(1, Math.min(4, Math.trunc(config?.image?.count ?? 1))),
        resolution: config?.image?.resolution ?? '2K',
      },
    } : {}),
  };
}

const DEFAULT_BRANCH_ROUTES: WorkflowBranchRouteConfig[] = [
  { id: 'route-ready', label: wu().m09f1425a, condition: wu().me7bf701a },
  { id: 'route-missing', label: wu().m09823766, condition: wu().mf4cd1430 },
];

function normalizedBranchConfig(config?: WorkflowBranchNodeConfig): WorkflowBranchNodeConfig {
  const seen = new Set<string>();
  const routes = (config?.routes?.length ? config.routes : DEFAULT_BRANCH_ROUTES)
    .map((route, index) => ({
      id: route.id?.trim() || `route-${index + 1}`,
      label: route.label?.trim() || route.condition?.trim() || wu().branch(index + 1),
      condition: route.condition ?? '',
    }))
    .filter(route => !seen.has(route.id) && seen.add(route.id));
  const defaultRouteId = routes.some(route => route.id === config?.defaultRouteId)
    ? config?.defaultRouteId
    : routes[0]?.id;
  return {
    instruction: config?.instruction?.trim() || wu().mdc76a1f6,
    routes,
    ...(defaultRouteId ? { defaultRouteId } : {}),
  };
}

function normalizedAgentConfig(config?: WorkflowAgentNodeConfig): WorkflowAgentNodeConfig {
  const systemPrompt = migrateLegacyOutputContractToPrompt(config);
  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    skillIds: [...(config?.skillIds || [])],
    knowledgeIds: [...(config?.knowledgeIds || [])],
    ...(config?.outputContract ? { outputContract: {
      format: config.outputContract.format === 'markdown' ? 'markdown' : 'json',
    } } : {}),
    ...(config?.confirmation ? { confirmation: normalizeWorkflowExecutionConfirmation(config.confirmation) } : {}),
  };
}

type KnowledgeTreeFileOption = { path: string; size: number; title?: string };
type WorkflowKnowledgeProvider = KnowledgeProviderId;
type KnowledgeWikiOption = { id: string; title: string; provider: WorkflowKnowledgeProvider };

function parseKnowledgeReference(reference: string): { provider: WorkflowKnowledgeProvider; wikiId: string; path: string } | null {
  const match = /^knowledge:(local):([^:]+):(.+)$/.exec(reference);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  try {
    return { provider: match[1] as WorkflowKnowledgeProvider, wikiId: decodeURIComponent(match[2]), path: decodeURIComponent(match[3]) };
  } catch {
    return null;
  }
}

function knowledgeReference(provider: WorkflowKnowledgeProvider, wikiId: string, path: string): string {
  return `knowledge:${provider}:${encodeURIComponent(wikiId)}:${encodeURIComponent(path)}`;
}

function KnowledgePicker({
  knowledgeIds,
  wikis,
  onChange,
}: {
  knowledgeIds: string[];
  wikis: KnowledgeWikiOption[];
  onChange: (knowledgeIds: string[]) => void;
}) {
  const fetch = useWorkflowApi();
  const firstSelected = knowledgeIds.map(parseKnowledgeReference).find(Boolean);
  const [wikiId, setWikiId] = React.useState<string>(firstSelected?.wikiId || '');
  const [prefix, setPrefix] = React.useState('');
  const [directories, setDirectories] = React.useState<string[]>([]);
  const [files, setFiles] = React.useState<KnowledgeTreeFileOption[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (wikis.length === 0) return;
    if (!wikis.some(wiki => wiki.id === wikiId)) setWikiId(firstSelected?.wikiId || wikis[0]!.id);
  }, [firstSelected?.wikiId, wikiId, wikis]);

  React.useEffect(() => {
    if (!wikiId) return;
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams();
    if (prefix) params.set('prefix', prefix);
    void fetch(`/api/knowledge-base/wikis/${encodeURIComponent(wikiId)}/tree${params.size ? `?${params}` : ''}`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error(wu().m63c10516);
      return response.json() as Promise<{ directories?: string[]; files?: KnowledgeTreeFileOption[] }>;
    }).then(tree => {
      setDirectories(tree.directories || []);
      setFiles(tree.files || []);
    }).catch(reason => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setDirectories([]);
      setFiles([]);
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [prefix, wikiId]);

  const selected = new Set(knowledgeIds);
  const parentSegments = prefix.replace(/\/$/, '').split('/').filter(Boolean);
  parentSegments.pop();
  const parentPrefix = parentSegments.length > 0 ? `${parentSegments.join('/')}/` : '';
  const currentWiki = wikis.find(wiki => wiki.id === wikiId);

  return (
    <div className="workflow-knowledge-picker">
      {wikis.length > 0 ? <>
        <StepSelect aria-label={wu().m5c8503bf} value={wikiId || ''} onChange={event => { setWikiId(event.target.value); setPrefix(''); }}>          {wikis.map(wiki => <option key={wiki.id} value={wiki.id}>{wiki.title}</option>)}
        </StepSelect>
        <div className="workflow-knowledge-browser">
          <div className="workflow-knowledge-path">
            <button type="button" disabled={!prefix} aria-label={wu().m2b0dc614} onClick={() => setPrefix(parentPrefix)}>←</button>
            <span title={`${currentWiki?.title || ''}/${prefix}`}>{prefix || wu().m18755acb}</span>
            {loading ? <small>{wu().mf950213a}</small> : null}          </div>
          <div className="workflow-knowledge-tree">
            {directories.map(directory => {
              const label = directory.slice(prefix.length).replace(/\/$/, '') || directory;
              return <Button variant="ghost" className="workflow-knowledge-directory" key={directory} type="button" onClick={() => setPrefix(directory)}><Icon name="folder" size={15}/>{label}<Icon name="chevron-right" size={12}/></Button>;
            })}
            {files.map(file => {
              const reference = knowledgeReference(currentWiki?.provider || 'local', wikiId, file.path);
              const checked = selected.has(reference);
              const label = file.title || file.path.slice(prefix.length) || file.path;
              return <label className="workflow-knowledge-file" key={file.path} title={file.path}>
                <input type="checkbox" checked={checked} onChange={() => onChange(checked ? knowledgeIds.filter(id => id !== reference) : [...knowledgeIds, reference])} />
                <span>{label}</span>
              </label>;
            })}
            {!loading && directories.length === 0 && files.length === 0 ? <p>{wu().m690abd77}</p> : null}
          </div>
        </div>
      </> : <p>{wu().md85fda89}</p>}
    </div>
  );
}

/** Popovers that are part of the workflow canvas share its viewport transform. */
function CanvasNodePopover({ visible, offset = 14, className, style, children, ...props }: React.HTMLAttributes<HTMLDivElement> & {
  visible: boolean;
  offset?: number;
}) {
  const nodeId = useNodeId();
  const node = useInternalNode(nodeId || '');
  if (!visible || !node) return null;
  return <ViewportPortal><div
    {...props}
    className={className}
    style={{
      position: 'absolute',
      left: node.internals.positionAbsolute.x + (node.measured.width ?? node.width ?? 0) + offset,
      top: node.internals.positionAbsolute.y,
      zIndex: node.internals.z + 1,
      pointerEvents: 'auto',
      ...style,
    }}
  >{children}</div></ViewportPortal>;
}

function AgentNodeConfigCard({ data }: { data: EditorNodeData }) {
  const fetch = useWorkflowApi();
  const [confirmationExpanded, setConfirmationExpanded] = React.useState(true);
  const [reviewPreviewOpen, setReviewPreviewOpen] = React.useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = React.useState(false);
  const [knowledgeDetailMode, setKnowledgeDetailMode] = React.useState<'preview' | 'source'>('preview');
  const [knowledgeDetail, setKnowledgeDetail] = React.useState<{
    reference: string;
    title: string;
    path: string;
    wikiTitle: string;
    content: string;
    loading: boolean;
    error: string;
  } | null>(null);
  const knowledgeDetailRequestRef = React.useRef(0);
  const [renaming, setRenaming] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(data.title);
  const config = normalizedAgentConfig(data.agentConfig);
  const selectedSkills = (data.skillOptions || []).filter(skill => config.skillIds.includes(skill.id));
  const selectedKnowledge = config.knowledgeIds
    .map(reference => ({ reference, parsed: parseKnowledgeReference(reference) }))
    .filter((item): item is { reference: string; parsed: { provider: WorkflowKnowledgeProvider; wikiId: string; path: string } } => Boolean(item.parsed));
  const unavailableKnowledge = config.knowledgeIds.filter(reference => !parseKnowledgeReference(reference));
  const patch = data.onAgentConfigChange;
  const reviewConfig = config.confirmation;
  const patchConfirmation = (value: Partial<WorkflowReviewNodeConfig>) => {
    patch?.({ confirmation: normalizeWorkflowExecutionConfirmation({ ...reviewConfig, ...value }) });
  };
  const finishRename = () => {
    const title = titleDraft.trim() || wu().m28febba2;
    setTitleDraft(title);
    setRenaming(false);
    if (title !== data.title) data.onTitleChange?.(title);
  };
  const openKnowledgeDetail = async ({
    reference,
    provider,
    wikiId,
    wikiTitle,
    path,
    title,
  }: {
    reference: string;
    provider: WorkflowKnowledgeProvider;
    wikiId: string;
    wikiTitle: string;
    path: string;
    title: string;
  }) => {
    const requestId = knowledgeDetailRequestRef.current + 1;
    knowledgeDetailRequestRef.current = requestId;
    setKnowledgeOpen(false);
    setKnowledgeDetailMode('preview');
    setKnowledgeDetail({ reference, title, path, wikiTitle, content: '', loading: true, error: '' });
    try {
      const response = await fetch(
        `/api/knowledge-base/wikis/${encodeURIComponent(wikiId)}/file?${new URLSearchParams({ path, provider })}`,
        { cache: 'no-store' },
      );
      const payload = await response.json().catch(() => null) as {
        path?: string;
        content?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok || typeof payload?.content !== 'string') {
        throw new Error(payload?.error?.message || wu().m1a50a212);
      }
      if (knowledgeDetailRequestRef.current !== requestId) return;
      setKnowledgeDetail(current => current?.reference === reference
        ? { ...current, path: payload.path || path, content: payload.content || '', loading: false, error: '' }
        : current);
    } catch (error) {
      if (knowledgeDetailRequestRef.current !== requestId) return;
      setKnowledgeDetail(current => current?.reference === reference
        ? { ...current, loading: false, error: error instanceof Error ? error.message : wu().m1a50a212 }
        : current);
    }
  };

  React.useEffect(() => {
    if (!knowledgeDetail) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setKnowledgeDetail(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [knowledgeDetail]);

  const knowledgeDetailHtml = React.useMemo(() => {
    if (!knowledgeDetail?.content) return '';
    const previewSource = knowledgeDetail.content
      .replace(/^##\s+type:[^\n]*(?:\n|$)/u, '')
      .trimStart();
    return micromark(previewSource, {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
  }, [knowledgeDetail?.content]);

  return (
    <div className="workflow-agent-card-config">
      <header className="workflow-agent-card-header">
        <div className="workflow-agent-card-title">
          <Icon name={WORKFLOW_NODE_ICONS.agent} size={17} strokeWidth={1.7}/><span className={stepStyles.cardNumber}>{data.cardNumber}</span>
          {renaming ? <Input
            className={`${stepStyles.titleInput} nodrag nowheel`}
            aria-label={wu().mfdbdcbcd}
            autoFocus
            maxLength={80}
            value={titleDraft}
            onFocus={event => event.currentTarget.select()}
            onPointerDown={event => event.stopPropagation()}
            onChange={event => setTitleDraft(event.target.value)}
            onBlur={finishRename}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setTitleDraft(data.title);
                setRenaming(false);
              }
            }}
          /> : <Button variant="ghost"
            className={`${stepStyles.titleButton} nodrag`}
            type="button"
            aria-label={wu().md6f8f46d}
            title={data.title || wu().m28febba2}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              setTitleDraft(data.title || wu().m28febba2);
              setRenaming(true);
            }}
          ><span>{data.title || wu().m28febba2}</span></Button>}
          <small>{wu().md5d92678}</small>
        </div>
        <Button variant="ghost" size="icon"
          className={`${stepStyles.removeButton} nodrag`}
          type="button"
          aria-label={wu().deleteNamed(data.title)}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); data.onDelete?.(); }}
        ><Icon name="close" size={14} strokeWidth={1.6}/></Button>
      </header>

      <div className="workflow-agent-prompt-field workflow-agent-prompt-entry nodrag nowheel" onPointerDown={event => event.stopPropagation()}>
        <div className="workflow-agent-prompt-heading">
          <span>{wu().executionNotes}</span>
          <Button variant="ghost" type="button" onClick={event => {
            event.stopPropagation();
            data.onPromptOpen?.();
          }}>{wu().mf7acefd2}</Button>
        </div>
      </div>

      {Boolean(data.artifactTargets?.length) && <section className={stepStyles.outputContract} aria-label={wu().downstreamRequirements}>
        <header><span>{wu().deliverable}</span><small>{wu().syncAlongEdge}</small></header>
        {data.artifactTargets!.map(target => <div className={stepStyles.outputTarget} key={target.nodeId}>
          <Icon name={`artifact-${target.kind}`} size={18}/>
          <div><strong>{target.artifactName || artifactKindLabel(target.kind)}</strong><span>{artifactComponentLabel(target.kind)} {wu().writeToCanvasWhenDone}</span>
          {target.image && <small>{target.image.ratio} · {target.image.count} {wu().sheetsMark} {target.image.resolution}</small>}
          {target.presentation && <small>{target.presentation.pages ? wu().pagesCount(target.presentation.pages) : wu().pagesAuto}</small>}
          {target.video && <small>{target.video.ratio || wu().ratioAuto} · {target.video.duration ? wu().secondsCount(target.video.duration) : wu().durationAuto}</small>}
          {target.requirements && <small>{target.requirements}</small>}</div>
        </div>)}
      </section>}

      <section className="workflow-agent-resource-section nodrag nowheel" onPointerDown={event => event.stopPropagation()}>
        <header><span>Skills</span><small>{selectedSkills.length} {wu().m743aaf95}</small></header>
        {data.renderSkillPicker ? <div className="workflow-agent-skill-picker">
          {data.renderSkillPicker({
            skills: data.skillOptions || [],
            selectedSkillIds: config.skillIds,
            onPickSkill: skill => {
              if (!config.skillIds.includes(skill.id)) patch?.({ skillIds: [...config.skillIds, skill.id] });
            },
          })}
        </div> : <StepSelect
            aria-label={wu().mb8878c31}            value=""
            onChange={event => {
              const id = event.target.value;
              if (id && !config.skillIds.includes(id)) patch?.({ skillIds: [...config.skillIds, id] });
            }}
          >
            <option value="">{wu().m653a0858}</option>
            {(data.skillOptions || []).map(skill => (
              <option key={skill.id} value={skill.id} disabled={config.skillIds.includes(skill.id)}>{skill.displayName?.['zh-CN'] || skill.name}</option>
            ))}
          </StepSelect>}
        {selectedSkills.length > 0 ? (
          <div className="workflow-agent-skill-chips">
            {selectedSkills.map(skill => (
              <Button variant="ghost" key={skill.id} type="button" aria-label={wu().removeSkillNamed(skill.displayName?.['zh-CN'] || skill.name)} onClick={() => patch?.({ skillIds: config.skillIds.filter(id => id !== skill.id) })}>
                <span>{skill.displayName?.['zh-CN'] || skill.name}</span><Icon name="close" size={12}/>
              </Button>
            ))}
          </div>
        ) : <p>{wu().ma9f40d4c}</p>}
      </section>
      <section className="workflow-agent-resource-section is-knowledge nodrag nowheel" onPointerDown={event => event.stopPropagation()}>
        <header><span>{wu().mafd92514}</span><small>{config.knowledgeIds.length} {wu().m743aaf95}</small></header>
        <button          className="workflow-agent-add-knowledge"
          type="button"
          aria-expanded={knowledgeOpen}
          onClick={() => {
                  setKnowledgeOpen(open => !open);
          }}
        >
          <span aria-hidden>＋</span>{wu().m7e95a8a3}</button>        {unavailableKnowledge.map(reference => <div key={reference} role="status">
          <span>{wu().m29b5d098}{reference}</span>
          <Button type="button" onClick={() => patch?.({ knowledgeIds: config.knowledgeIds.filter(id => id !== reference) })}>{wu().mfacee0c8}</Button>
        </div>)}
        {selectedKnowledge.length > 0 ? <div className="workflow-agent-knowledge-chips">
          {selectedKnowledge.map(({ reference, parsed }) => {
            const wiki = (data.knowledgeWikis || []).find(item => item.id === parsed.wikiId && item.provider === parsed.provider);
            const title = parsed.path.split('/').filter(Boolean).pop() || parsed.path;
            const wikiTitle = wiki?.title || String(parsed.wikiId);
            return <div className="workflow-agent-knowledge-chip" key={reference} title={`${wikiTitle}/${parsed.path}`}>
              <Button variant="ghost"
                className="workflow-agent-knowledge-chip-open"
                type="button"
                aria-label={wu().viewKnowledge(title)}
                onClick={() => void openKnowledgeDetail({
                  reference,
                  provider: parsed.provider,
                  wikiId: parsed.wikiId,
                  wikiTitle,
                  path: parsed.path,
                  title,
                })}
              ><span>{title}</span></Button>
              <Button variant="ghost"
                className="workflow-agent-knowledge-chip-remove"
                type="button"
                aria-label={wu().removeKnowledge(title)}
                title={wu().removeNamed(title)}
                onClick={() => {
                  if (knowledgeDetail?.reference === reference) setKnowledgeDetail(null);
                  patch?.({ knowledgeIds: config.knowledgeIds.filter(id => id !== reference) });
                }}
              ><Icon name="close" size={14}/></Button>
            </div>;
          })}
        </div> : null}
      </section>

      {<section className="workflow-agent-confirmation nodrag nowheel" onPointerDown={event => event.stopPropagation()}>
        <div className={stepStyles.confirmationHeading}>
          <label className="workflow-agent-confirmation-toggle">
            <span className="workflow-agent-confirmation-copy"><strong>{wu().confirmWhenDone}</strong><small>{wu().pauseToConfirm}</small></span>
            <input aria-label={wu().confirmWhenDone} type="checkbox" checked={Boolean(reviewConfig)} onChange={event => {
              patch?.({ confirmation: event.target.checked ? normalizeWorkflowExecutionConfirmation({ title: wu().flowConfirm(data.title || wu().m28febba2) }) : undefined });
              setReviewPreviewOpen(false);
            }}/>
            <span className="workflow-agent-switch" aria-hidden><i/></span>
          </label>
          {reviewConfig && <div className={stepStyles.confirmationActions}>
            <Button variant="ghost" type="button" aria-expanded={confirmationExpanded} onClick={() => setConfirmationExpanded(value => !value)}>{confirmationExpanded ? wu().m5d581564 : wu().settingsLabel}</Button>
            <Button variant="ghost" type="button" aria-expanded={reviewPreviewOpen} onClick={() => { setKnowledgeOpen(false); setReviewPreviewOpen(value => !value); }}>{reviewPreviewOpen ? wu().mf629e49d : wu().mde61aa8e}</Button>
          </div>}
        </div>
        {reviewConfig && <div className={`${stepStyles.confirmationDisclosure} ${confirmationExpanded ? stepStyles.confirmationExpanded : ''}`} aria-hidden={!confirmationExpanded}>
          <div><fieldset disabled={!confirmationExpanded} className={stepStyles.confirmationFields}>
            <label><span>{wu().confirmTitle}</span><Input aria-label={wu().confirmTitle} value={reviewConfig.title || ''} onChange={event => patchConfirmation({ title: event.target.value })}/></label>
            <label><span>{wu().m89022d8d}</span><Input aria-label={wu().m89022d8d} value={reviewConfig.continueLabel} onChange={event => patchConfirmation({ continueLabel: event.target.value })}/></label>
            <div className={stepStyles.confirmationSelection}><span>{wu().mc59773a6}</span>{data.renderArtifactSelect?.({ label: wu().confirmChoice, value: reviewConfig.selection, options: [{ value: 'none', label: wu().m0c5847b3 }, { value: 'single', label: wu().m3e886a9c }, { value: 'multiple', label: wu().m83c68005 }], onValueChange: value => patchConfirmation({ selection: value as WorkflowReviewNodeConfig['selection'], selectionRequired: value !== 'none' }) }) ?? <StepSelect aria-label={wu().confirmChoice} value={reviewConfig.selection} onChange={event => patchConfirmation({ selection: event.target.value as WorkflowReviewNodeConfig['selection'], selectionRequired: event.target.value !== 'none' })}><option value="none">{wu().m0c5847b3}</option><option value="single">{wu().m3e886a9c}</option><option value="multiple">{wu().m83c68005}</option></StepSelect>}</div>
            <div className={stepStyles.confirmationOptions}>
              {reviewConfig.selection !== 'none' && <label><input type="checkbox" checked={reviewConfig.selectionRequired} onChange={event => patchConfirmation({ selectionRequired: event.target.checked })}/>{wu().mf9619717}</label>}
              <label><input type="checkbox" checked={reviewConfig.feedbackEnabled} onChange={event => patchConfirmation({ feedbackEnabled: event.target.checked })}/>{wu().m8e34ae3a}</label>
              {reviewConfig.feedbackEnabled && <label><input type="checkbox" checked={reviewConfig.feedbackRequired} onChange={event => patchConfirmation({ feedbackRequired: event.target.checked })}/>{wu().m6abc46b0}</label>}
              <label><input type="checkbox" checked={reviewConfig.allowRegenerate} onChange={event => patchConfirmation({ allowRegenerate: event.target.checked })}/>{wu().mb7a684f9}</label>
            </div>
          </fieldset></div>
        </div>}
      </section>}
      {reviewConfig && data.renderReviewPreview && <CanvasNodePopover visible={reviewPreviewOpen} offset={14} className={`workflow-agent-review-preview nodrag nopan nowheel ${stepStyles.reviewPopover}`} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setReviewPreviewOpen(false); } }}>
        <Button variant="ghost" type="button" className={stepStyles.previewClose} aria-label={wu().closeConfirmPreview} onClick={() => setReviewPreviewOpen(false)}><Icon name="close" size={14}/></Button>
        {data.renderReviewPreview(reviewConfig, value => patchConfirmation(value))}
      </CanvasNodePopover>}
      <CanvasNodePopover
        className={`workflow-agent-knowledge-popover nodrag nopan nowheel ${stepStyles.knowledgePopover}`}
        visible={knowledgeOpen}
        offset={14}
      >
        <div onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setKnowledgeOpen(false); } }}>
          <header className="workflow-agent-knowledge-popover-header">
            <div><strong>{wu().m7e95a8a3}</strong><small>{wu().m5485e212}</small></div>
            <button type="button" aria-label={wu().mb5f721d4} onClick={() => setKnowledgeOpen(false)}>×</button>          </header>
          <KnowledgePicker
            knowledgeIds={config.knowledgeIds}
            wikis={data.knowledgeWikis || []}
            onChange={knowledgeIds => patch?.({ knowledgeIds })}
          />
        </div>
      </CanvasNodePopover>
      {knowledgeDetail && typeof document !== 'undefined' ? createPortal(
        <div className="bezier-workbench workflow-editor-portal-root">
          <div className="workflow-knowledge-detail-mask" onMouseDown={() => setKnowledgeDetail(null)}>
          <section
            className={`workflow-knowledge-detail-dialog ${stepStyles.knowledgeDetail}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-knowledge-detail-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <header>
              <div>
                <small>{wu().m430af54e}</small>
                <h3 id="workflow-knowledge-detail-title">{knowledgeDetail.title}</h3>
                <p>{knowledgeDetail.wikiTitle} / {knowledgeDetail.path}</p>
              </div>
              <div className="workflow-knowledge-detail-actions">
                <div role="group" aria-label={wu().m2578a663}>
                  <button
                    type="button"
                    className={knowledgeDetailMode === 'preview' ? 'is-active' : ''}
                    aria-pressed={knowledgeDetailMode === 'preview'}
                    onClick={() => setKnowledgeDetailMode('preview')}
                  >{wu().mde61aa8e}</button>
                  <button
                    type="button"
                    className={knowledgeDetailMode === 'source' ? 'is-active' : ''}
                    aria-pressed={knowledgeDetailMode === 'source'}
                    onClick={() => setKnowledgeDetailMode('source')}
                  >{wu().ma55afe4b}</button>
                </div>
                <button className="workflow-knowledge-detail-close" type="button" aria-label={wu().m60e47eeb} onClick={() => setKnowledgeDetail(null)}>×</button>
              </div>
            </header>
            <div className="workflow-knowledge-detail-content">
              {knowledgeDetail.loading ? <div className="workflow-knowledge-detail-loading" aria-label={wu().m18a8701c}>
                <i /><i /><i /><i />
              </div> : knowledgeDetail.error ? <div className="workflow-knowledge-detail-error" role="alert">
                <strong>{wu().m4c0521ff}</strong>
                <span>{knowledgeDetail.error}</span>
              </div> : knowledgeDetailMode === 'preview' ? <article
                className="workflow-knowledge-detail-markdown"
                dangerouslySetInnerHTML={{ __html: knowledgeDetailHtml }}
              /> : <pre className="workflow-knowledge-detail-source">{knowledgeDetail.content}</pre>}
            </div>
            <footer>{wu().m6d375721}</footer>
          </section>
          </div>
        </div>,
        document.body,
      ) : null}    </div>
  );
}

function StepSelect(props: React.ComponentProps<typeof Select>) {
  return <span className={stepStyles.selectField}>
    <Select {...props}/>
    <Icon name="chevron-down" size={12} strokeWidth={1.7}/>
  </span>;
}

function ClarificationNodeConfigCard({ data }: { data: EditorNodeData }) {
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const config = normalizedClarificationConfig(data.clarificationConfig);
  const patchConfig = (patch: Partial<WorkflowClarificationNodeConfig>) => {
    data.onClarificationConfigChange?.(normalizedClarificationConfig({ ...config, ...patch }));
  };
  const updateQuestion = (questionId: string, patch: Partial<WorkflowClarificationQuestionConfig>) => {
    patchConfig({ questions: config.questions.map((question, index) => question.id === questionId
      ? normalizedClarificationQuestion({ ...question, ...patch }, index)
      : question) });
  };

  return (
    <div className={inquiryStyles.card}>
      <header className={inquiryStyles.header}>
        <div><strong>{wu().md333b982}</strong><small>{config.mode === 'auto' ? wu().autoMaxQuestions(config.autoConfig?.maxQuestions ?? 3) : wu().questionCount(config.questions.length)}</small></div>
        {data.renderClarificationPreview ? <button
          className={`${inquiryStyles.preview} nodrag`}          type="button"
          aria-expanded={previewOpen}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => setPreviewOpen(open => !open)}
        >{previewOpen ? wu().mf629e49d : wu().mde61aa8e}</button> : null}      </header>
      <div className={`${inquiryStyles.modeSwitch} nodrag`} aria-label={wu().mea838635} onPointerDown={event => event.stopPropagation()}>
        <button type="button" aria-pressed={config.mode !== 'auto'} onClick={() => patchConfig({ mode: 'configured' })}>{wu().m5ce00bd9}</button>
        <button type="button" aria-pressed={config.mode === 'auto'} onClick={() => patchConfig({ mode: 'auto' })}>{wu().mc8682c26}</button>      </div>
      {config.mode === 'auto' ? <section className={`${inquiryStyles.autoConfig} nodrag nowheel`} onPointerDown={event => event.stopPropagation()}>
        <label>
          <span>{wu().m1c424424}</span>
          <textarea
            aria-label={wu().m053512a4}            value={config.autoConfig?.instruction ?? ''}
            onChange={event => patchConfig({ autoConfig: { ...config.autoConfig!, instruction: event.target.value } })}
          />
        </label>
        <div className={inquiryStyles.autoRow}>
          <label>
            <span>{wu().m539e89f1}</span>
            <select
              aria-label={wu().mcb4e1501}              value={config.autoConfig?.maxQuestions ?? 3}
              onChange={event => patchConfig({ autoConfig: { ...config.autoConfig!, maxQuestions: Number(event.target.value) } })}
            >
              {[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} {wu().ma3367042}</option>)}
            </select>          </label>
          <fieldset>
            <legend>{wu().mfeebb098}</legend>
            {(Object.entries(clarificationTypeLabels()) as Array<[WorkflowClarificationQuestionType, string]>).map(([type, label]) => {
              const selected = config.autoConfig?.allowedTypes.includes(type) ?? false;
              return <Button variant="ghost"
                key={type}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  const current = config.autoConfig?.allowedTypes ?? [];
                  const next = selected ? current.filter(item => item !== type) : [...current, type];
                  patchConfig({ autoConfig: { ...config.autoConfig!, allowedTypes: next.length > 0 ? next : [type] } });
                }}
              >{label}</Button>;
            })}
          </fieldset>
        </div>
        <p>{wu().mf55872c3}</p>
      </section> : <section className={`${inquiryStyles.questionColumn} nodrag nowheel`} onPointerDown={event => event.stopPropagation()}>
        <div className={inquiryStyles.questions}>          {config.questions.map((question, index) => (
            <article className={inquiryStyles.question} key={question.id}>
              <header>
                <strong>{index + 1}</strong>
                <div className="workflow-inquiry-mini-segment" aria-label={wu().questionMode(index + 1)}>
                  <button type="button" aria-pressed={question.titleMode === 'ai'} onClick={() => updateQuestion(question.id, { titleMode: 'ai' })}>AI</button>
                  <button type="button" aria-pressed={question.titleMode === 'manual'} onClick={() => updateQuestion(question.id, { titleMode: 'manual' })}>{wu().m19002f60}</button>
                </div>
                <div className="workflow-inquiry-mini-segment is-three" aria-label={wu().questionAnswer(index + 1)}>
                  {(Object.entries(clarificationTypeLabels()) as Array<[WorkflowClarificationQuestionConfig['type'], string]>).map(([type, label]) => (
                    <button key={type} type="button" aria-pressed={question.type === type} onClick={() => updateQuestion(question.id, { type })}>{label}</button>                  ))}
                </div>
                <button className={inquiryStyles.remove} type="button" aria-label={wu().deleteQuestion(index + 1)} disabled={config.questions.length <= 1} onClick={() => patchConfig({ questions: config.questions.filter(item => item.id !== question.id) })}>×</button>              </header>
              <input
                aria-label={question.titleMode === 'ai' ? wu().questionDirection(index + 1) : wu().questionTitle(index + 1)}                value={question.titleMode === 'ai' ? question.titleDirection : question.title}
                placeholder={question.titleMode === 'ai' ? wu().m33446f4a : wu().mf578d8be}
                onChange={event => updateQuestion(question.id, question.titleMode === 'ai' ? { titleDirection: event.target.value } : { title: event.target.value })}
              />
              {question.type !== 'text' ? <input
                aria-label={wu().questionOptions(index + 1)}                value={question.optionDirection}
                placeholder={wu().m8eaf28a6}
                onChange={event => updateQuestion(question.id, { optionDirection: event.target.value })}
              /> : null}
              <footer>
                <label><input type="checkbox" checked={question.required} onChange={event => updateQuestion(question.id, { required: event.target.checked })} />{wu().m32945d3e}</label>
                <label><input type="checkbox" checked={question.allowOther} onChange={event => updateQuestion(question.id, { allowOther: event.target.checked })} />{wu().m6921b4fe}</label>
              </footer>
            </article>
          ))}
        </div>
        <Button variant="ghost" className={inquiryStyles.addQuestion} type="button" onClick={() => {
          const id = `question-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;
          patchConfig({ questions: [...config.questions, normalizedClarificationQuestion({ id, titleMode: 'ai', titleDirection: '', type: 'single', allowOther: true }, config.questions.length)] });
        }}>{wu().m150362a7}</Button>      </section>}
      {previewOpen && data.renderClarificationPreview ? (
        <CanvasNodePopover
          visible
          offset={12}
          className={`workflow-inquiry-node-preview nodrag nowheel ${inquiryStyles.previewPopover}`}
          onPointerDown={event => event.stopPropagation()}
        >
          {data.renderClarificationPreview(config)}
        </CanvasNodePopover>
      ) : null}
    </div>
  );
}

function workflowNodeCardContent(data: EditorNodeData): {
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel: string;
  secondaryValue: string;
  footerLeft: string;
  footerRight: string;
} {
  if (data.kind === 'clarify') {
    const config = normalizedClarificationConfig(data.clarificationConfig);
    if (config.mode === 'auto') return {
      primaryLabel: wu().m9d48527d,
      primaryValue: wu().mc8682c26,
      secondaryLabel: wu().m19c6ca74,
      secondaryValue: wu().maxQuestions(config.autoConfig?.maxQuestions ?? 3),
      footerLeft: wu().m9bbb185b,
      footerRight: (config.autoConfig?.allowedTypes ?? []).map(type => clarificationTypeLabels()[type]).join(' / '),    };
    const types = [...new Set(config.questions.map(question => clarificationTypeLabels()[question.type]))];
    const customCount = config.questions.filter(question => question.allowOther).length;
    return {
      primaryLabel: wu().m2fb49eec,
      primaryValue: wu().questionSummary(config.questions.length, clarificationQuestionModes(config)),
      secondaryLabel: wu().md318072f,
      secondaryValue: types.join(' / '),
      footerLeft: wu().m5ce00bd9,
      footerRight: customCount ? wu().allowOtherCount(customCount) : wu().m74faf221,
    };
  }
  if (data.kind === 'agent') {
    const config = normalizedAgentConfig(data.agentConfig);
    return {
      primaryLabel: wu().m9e3eff74,
      primaryValue: wu().m60989c03,
      secondaryLabel: wu().m2f0bb123,
      secondaryValue: config.systemPrompt ? wu().mdc7cd22f : wu().m63595e95,
      footerLeft: `${config.skillIds.length} Skills`,
      footerRight: wu().knowledgeCount(config.knowledgeIds.length),
    };
  }
  if (data.kind === 'review') {
    const config = normalizedReviewConfig(data.reviewConfig);
    const artifact = config.artifactKind === 'page' ? wu().m06dfb846 : config.artifactKind === 'image' ? wu().mbe8da62e : config.artifactKind === 'video' ? wu().mfa4e33b6 : wu().mf1926e9b;    return {
      primaryLabel: wu().mbae0dd8c,
      primaryValue: artifact,
      secondaryLabel: wu().mda803830,
      secondaryValue: wu().m7926c1ac,
      footerLeft: wu().m7ec3b7c7,
      footerRight: config.materializeOnConfirm ? wu().m93a9928a : wu().m927bc503,
    };
  }
  if (data.kind === 'delivery') {
    const config = normalizedDeliveryConfig(data.deliveryConfig);
    const artifact = config.artifactKind === 'page' ? wu().m06dfb846 : config.artifactKind === 'image' ? wu().mbe8da62e : config.artifactKind === 'video' ? wu().mfa4e33b6 : wu().mf1926e9b;    return {
      primaryLabel: wu().mbae0dd8c,
      primaryValue: artifact,
      secondaryLabel: wu().m73735a05,
      secondaryValue: wu().mc8b14453,
      footerLeft: wu().maf88b050,
      footerRight: wu().mc26087c4,    };
  }
  const config = normalizedBranchConfig(data.branchConfig);
  const fallback = config.routes.find(route => route.id === config.defaultRouteId);
  return {
    primaryLabel: wu().md1164be0,
    primaryValue: config.instruction,
    secondaryLabel: wu().m78de008e,
    secondaryValue: wu().routeCount(config.routes.length),
    footerLeft: wu().mcf393e57,
    footerRight: wu().fallbackRoute(fallback?.label || wu().unset),
  };
}

function WorkflowEditorNode({ data, selected }: NodeProps<Node<EditorNodeData>>) {
  const [branchMenuRouteId, setBranchMenuRouteId] = React.useState('');
  const [nextMenuOpen, setNextMenuOpen] = React.useState(false);
  const [editingStartTitle, setEditingStartTitle] = React.useState(false);
  const [startTitleDraft, setStartTitleDraft] = React.useState('');
  const startTitleInputRef = React.useRef<HTMLInputElement>(null);
  const start = data.kind === 'start'
    ? normalizedStartConfig(data.startConfig, data.title || wu().mfdba55f2)
    : null;
  const startMetadata = start ? workflowCardMetadata(start.workflowMarkdown || '') : null;
  const card = start ? null : workflowNodeCardContent(data);
  React.useEffect(() => {
    if (editingStartTitle) startTitleInputRef.current?.select();
  }, [editingStartTitle]);

  function finishStartTitleEdit(commit: boolean): void {
    if (!editingStartTitle) return;
    setEditingStartTitle(false);
    const nextTitle = startTitleDraft.trim();
    if (commit && nextTitle && nextTitle !== start?.workflowName) data.onTitleChange?.(nextTitle);
  }

  return (
    <article className={`workflow-editor-node is-${data.tone} is-kind-${data.kind}${data.kind === 'clarify' ? ` ${inquiryStyles.node}` : ''}${data.kind === 'start' || data.kind === 'agent' || data.kind === 'branch' || data.kind === 'delivery' ? ` ${stepStyles.node}` : ''}${selected ? ' is-selected' : ''}${data.conversationFocused ? ` ${intentStyles.focused}` : ''}`}>
      {data.kind !== 'start' && <Handle type="target" position={Position.Left} />}
      {data.kind !== 'start' && data.kind !== 'agent' && data.kind !== 'delivery' && <button
        className="workflow-node-remove nodrag"
        type="button"
        aria-label={wu().deleteNamed(data.title)}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); data.onDelete?.(); }}
      ><Icon name="close" size={14} strokeWidth={1.6} /></button>}
      {start ? (
        <div className="workflow-start-card-inner">
          <span className="workflow-start-card-kind"><Icon name="arrow-right" size={13} strokeWidth={1.7} />{wu().m79cc871c}</span>          {editingStartTitle ? (
            <Input
              ref={startTitleInputRef}
              className={`workflow-start-card-title-input ${stepStyles.titleInput} nodrag nowheel`}
              aria-label={wu().workflowTitleLabel}              value={startTitleDraft}
              maxLength={120}
              onPointerDown={event => event.stopPropagation()}
              onChange={event => setStartTitleDraft(event.target.value)}
              onBlur={() => finishStartTitleEdit(true)}
              onKeyDown={event => {
                event.stopPropagation();
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') finishStartTitleEdit(false);
              }}
            />
          ) : (
            <Button variant="ghost"
              className={`${stepStyles.titleButton} nodrag`}
              type="button"
              aria-label={wu().editWorkflowTitle(start.workflowName)}
              title={wu().clickEditTitle}
              onPointerDown={event => event.stopPropagation()}
              onClick={event => {
                event.stopPropagation();
                setStartTitleDraft(start.workflowName);
                setEditingStartTitle(true);
              }}
            ><span title={start.workflowName}>{start.workflowName}</span></Button>
          )}
          <p className="workflow-start-card-description">
            {start.description.trim() || wu().clickAddScenario}
          </p>          <div className="workflow-start-card-metadata">
            <span title={startMetadata?.id}>ID {startMetadata?.id}</span>
            <span>v{startMetadata?.version} · {startMetadata?.status}</span>          </div>
        </div>
      ) : data.kind === 'clarify' ? (
        <ClarificationNodeConfigCard data={data} />
      ) : data.kind === 'agent' ? (
        <AgentNodeConfigCard data={data} />
      ) : data.kind === 'delivery' ? (
        <DeliveryNodeConfigCard data={data} />
      ) : data.kind === 'review' ? (
        <ResultNodeConfigCard data={data} />
      ) : (
        <div className="workflow-stage-card-inner">
          <strong className="workflow-stage-card-title">{data.kind === 'branch' && <Icon name={WORKFLOW_NODE_ICONS.branch} size={17} strokeWidth={1.7}/>}<span className={stepStyles.cardNumber}>{data.cardNumber}</span><span>{data.title}</span>{data.kind === 'branch' && <small>{normalizedBranchConfig(data.branchConfig).routes.length} {wu().branchCountLabel}</small>}</strong>
          {data.kind === 'branch' ? (
            <>
              <div className="workflow-agent-prompt-field workflow-agent-prompt-entry nodrag nowheel" onPointerDown={event => event.stopPropagation()}>
                <div className="workflow-agent-prompt-heading">
                  <span>System Prompt</span>
                  <button type="button" onClick={event => {
                    event.stopPropagation();
                    data.onPromptOpen?.();
                  }}>{wu().mf7acefd2}</button>
                </div>
              </div>
              <div className="workflow-branch-card-routes">
                {normalizedBranchConfig(data.branchConfig).routes.map((route, index, routes) => (
                  <div className="workflow-branch-card-route" key={route.id}>
                    <span className={stepStyles.routeLabel}>{wu().conditionLabel} {index + 1}</span>
                    <Textarea
                      className="nodrag nowheel"
                      aria-label={wu().condition(index + 1)}
                      value={route.condition}
                      rows={2}
                      placeholder={wu().me1dcbd36}
                      onPointerDown={event => event.stopPropagation()}
                      onChange={event => data.onBranchConfigChange?.({
                        routes: routes.map(item => item.id === route.id
                          ? { ...item, label: event.target.value, condition: event.target.value }
                          : item),
                      })}
                    />
                    <Button variant="ghost"
                      className="workflow-branch-route-remove nodrag"
                      type="button"
                      aria-label={wu().deleteCondition(index + 1)}
                      disabled={routes.length <= 2}
                      onPointerDown={event => event.stopPropagation()}
                      onClick={event => { event.stopPropagation(); data.onBranchRemoveRoute?.(route.id); }}
                    ><Icon name="close" size={13}/></Button>
                    <Handle
                      id={route.id}
                      type="source"
                      position={Position.Right}
                      aria-label={wu().addAfterCondition(index + 1)}
                      title={wu().m46793144}
                      onClick={event => {
                        event.stopPropagation();
                        setBranchMenuRouteId(current => current === route.id ? '' : route.id);
                      }}
                    />
                    {branchMenuRouteId === route.id ? (
                      <div className="workflow-branch-next-menu nodrag nowheel" role="menu" aria-label={wu().conditionNext(index + 1)} onPointerDown={event => event.stopPropagation()}>
                        {NODE_CATALOG.filter(item => item.kind !== 'start').map(item => (
                          <button key={item.kind} type="button" role="menuitem" onClick={event => {                            event.stopPropagation();
                            data.onBranchAddNext?.(route.id, item.kind);
                            setBranchMenuRouteId('');
                          }}>
                            <Icon name={WORKFLOW_NODE_ICONS[item.kind]} size={16}/>
                            <b>{item.label}</b>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                <button className="workflow-branch-add-inline nodrag" type="button" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); data.onBranchAddRoute?.(); }}>{wu().m975b4957}</button>              </div>
            </>
          ) : (
            <>
              <div className="workflow-stage-card-metadata">
                <span><small>{card?.primaryLabel}</small><strong>{card?.primaryValue}</strong></span>
                <span><small>{card?.secondaryLabel}</small><strong>{card?.secondaryValue}</strong></span>
              </div>
              <footer className="workflow-stage-card-footer"><span>{card?.footerLeft}</span><span>{card?.footerRight}</span></footer>
            </>
          )}
        </div>
      )}
      {data.kind !== 'branch' ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            aria-label={wu().addNextFrom(data.title)}
            title={wu().m46793144}
            onClick={event => {
              event.stopPropagation();
              setNextMenuOpen(open => !open);
            }}
          />
          {nextMenuOpen ? (
            <div
              className="workflow-node-next-menu nodrag nowheel"
              role="menu"
              aria-label={wu().nextOf(data.title)}
              onPointerDown={event => event.stopPropagation()}
              onKeyDown={event => {
                if (event.key === 'Escape') setNextMenuOpen(false);
              }}
            >
              {NODE_MENU_CATALOG.filter(item => item.kind !== 'start').map(item => (
                <button key={item.kind} type="button" role="menuitem" onClick={event => {
                  event.stopPropagation();
                  data.onAddNext?.(item.kind);
                  setNextMenuOpen(false);
                }}>
                  <Icon name={WORKFLOW_NODE_ICONS[item.kind]} size={16}/>
                  <b>{item.label}</b>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {data.kind !== 'start' && <WorkflowInputSummary sources={data.inputSources ?? []} candidates={data.inputCandidates ?? []} references={data.inputReferences ?? []} onChange={data.onInputReferencesChange} onLocate={data.onLocateInput} />}
      {data.onAddToConversation && <div className={`${intentStyles.cardAction} nodrag nopan nowheel`} onPointerDown={event => event.stopPropagation()}>
        <Button variant="ghost" type="button" disabled={data.conversationDisabled}
          aria-label={wu().addToConversation(start?.workflowName || data.title)}
          aria-pressed={data.conversationFocused}
          onClick={event => { event.stopPropagation(); data.onAddToConversation?.(); }}>
          <Icon name="plus" size={14} />{data.conversationFocused ? wu().addedToConversation : wu().addToConversationLabel}
        </Button>
      </div>}
    </article>
  );
}

function DeliveryNodeConfigCard({ data }: { data: EditorNodeData }) {
  const config = normalizedDeliveryConfig(data.deliveryConfig);
  const update = (next: WorkflowDeliveryNodeConfig) => data.onDeliveryConfigChange?.(normalizedDeliveryConfig(next));
  const field = (label: string, value: string, options: readonly { value: string; label: string }[], onValueChange: (value: string) => void) =>
    data.renderArtifactSelect?.({ label, value, options, onValueChange }) ?? <StepSelect aria-label={label} value={value} onChange={event => onValueChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</StepSelect>;
  return <div className={`workflow-stage-card-inner ${stepStyles.deliveryCard}`}>
    <header className={stepStyles.deliveryHeader}><strong className="workflow-stage-card-title"><Icon name={WORKFLOW_NODE_ICONS.delivery} size={17}/><span className={stepStyles.cardNumber}>{data.cardNumber}</span><span>{data.title}</span></strong>
      <Button variant="ghost" className={`${stepStyles.removeButton} nodrag`} type="button" aria-label={wu().deleteNamed(data.title)} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); data.onDelete?.(); }}><Icon name="close" size={14}/></Button>
    </header>
    <div className={`${stepStyles.deliveryFields} nodrag nowheel`} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <div className={stepStyles.deliveryField}><span>{wu().typeLabel}</span>{field(wu().typeLabel, config.artifactKind, WORKFLOW_ARTIFACT_OPTIONS.map(item => ({ value: item.kind, label: artifactKindLabel(item.kind) })), value => update({ ...config, artifactKind: value as WorkflowDeliveryNodeConfig['artifactKind'] }))}</div>
      <label className={stepStyles.deliveryField}><span>{wu().nameLabel}</span><Input aria-label={wu().deliverableName} value={config.artifactName || ''} placeholder={wu().autoName} onChange={event => update({ ...config, artifactName: event.target.value })}/></label>
      {data.renderGenerationOptions ? <div className={stepStyles.deliveryRequirements}>{data.renderGenerationOptions(config, update)}</div> : <>
      {config.artifactKind === 'presentation' && <label className={stepStyles.deliveryField}><span>{wu().pageCountLabel}</span><Input aria-label={wu().pptPages} type="number" min={1} max={100} value={config.presentation?.pages ?? ''} placeholder={wu().autoLabel} onChange={event => update({ ...config, presentation: { pages: event.target.value ? Math.max(1, Math.min(100, Number(event.target.value))) : undefined } })}/></label>}
      {config.artifactKind === 'video' && <>
        <div className={stepStyles.deliveryField}><span>{wu().mf07fc510}</span>{field(wu().videoRatio, config.video?.ratio || '', [{ value: '', label: wu().autoLabel }, ...(data.videoOptions?.ratios || []).map(value => ({ value, label: value }))], value => update({ ...config, video: { ...config.video, ratio: value || undefined } }))}</div>
        <div className={stepStyles.deliveryField}><span>{wu().durationLabel}</span>{field(wu().videoDuration, String(config.video?.duration || ''), [{ value: '', label: wu().autoLabel }, ...(data.videoOptions?.durations || []).map(value => ({ value: String(value), label: wu().secondsCount(value) }))], value => update({ ...config, video: { ...config.video, duration: value ? Number(value) : undefined } }))}</div>
      </>}
      {config.artifactKind === 'image' && config.image && <>
        <div className={stepStyles.deliveryField}><span>{wu().mf07fc510}</span>{field(wu().mf07fc510, config.image.ratio, ['1:1', '3:4', '4:3', '9:16', '16:9'].map(value => ({ value, label: value })), value => update({ ...config, image: { ...config.image!, ratio: value as NonNullable<WorkflowDeliveryNodeConfig['image']>['ratio'] } }))}</div>
        <div className={stepStyles.deliveryField}><span>{wu().quantityLabel}</span>{field(wu().mcb7916aa, String(config.image.count), [1, 2, 3, 4].map(value => ({ value: String(value), label: wu().sheetsCount(value) })), value => update({ ...config, image: { ...config.image!, count: Number(value) } }))}</div>
        <div className={stepStyles.deliveryField}><span>{wu().mcde9b52b}</span>{field(wu().mcde9b52b, config.image.resolution, ['2K', '4K'].map(value => ({ value, label: value })), value => update({ ...config, image: { ...config.image!, resolution: value as '2K' | '4K' } }))}</div>
      </>}
      </>}
      <label className={stepStyles.deliveryRequirements}><span>{wu().deliveryRequirements}</span><Textarea aria-label={wu().deliveryRequirements} rows={3} value={config.requirements || ''} placeholder={wu().deliveryPlaceholder} onChange={event => update({ ...config, requirements: event.target.value })}/></label>
    </div>
    <p className={stepStyles.deliveryHint}>{artifactComponentLabel(config.artifactKind)} {wu().receiveDeliverable}</p>
  </div>;
}

function ResultNodeConfigCard({ data }: { data: EditorNodeData }) {
  const config = normalizedReviewConfig(data.reviewConfig);
  return (
    <div className="workflow-result-node-config">
      <header><strong>{data.title || wu().m0a2c91ce}</strong><small>{config.materializeOnConfirm ? wu().md37176bf : wu().m38a54ba8}</small></header>
      <label className="nodrag nowheel" onPointerDown={event => event.stopPropagation()}>
        <span>{wu().mbae0dd8c}</span>
        <select
          aria-label={wu().mbae0dd8c}
          value={config.artifactKind}
          onChange={event => data.onReviewConfigChange?.(normalizedReviewConfig({
            ...config,
            artifactKind: event.target.value as WorkflowReviewNodeConfig['artifactKind'],
          }))}
        >
          <option value="text">{wu().mf1926e9b}</option>
          <option value="page">{wu().m06dfb846}</option>
          <option value="image">{wu().mbe8da62e}</option>
          <option value="video" disabled>{wu().mbc0415f0}</option>
        </select>
      </label>
    </div>
  );
}

// React Flow moves the outer node wrapper; these forms consume only data/selection.
const NODE_TYPES = { workflowStage: React.memo(WorkflowEditorNode,
  (previous, next) => previous.data === next.data && previous.selected === next.selected) };

function WorkflowCanvasToolbar(props: Omit<React.ComponentProps<typeof CanvasViewToolbar>, 'zoom'>) {
  const zoom = useStore(state => state.transform[2]);
  return <CanvasViewToolbar {...props} zoom={zoom} />;
}

type WorkflowEditorEdgeData = {
  onSelect?: (edgeId: string) => void;
  onDelete?: (edgeId: string) => void;
};

function WorkflowEditorEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
  data,
}: EdgeProps<Edge<WorkflowEditorEdgeData>>) {
  const zoom = useStore(state => selected ? state.transform[2] : 1);
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <g onClick={() => data?.onSelect?.(id)}>
        <BaseEdge
          path={path}
          markerEnd={markerEnd}
          interactionWidth={22}
          className={`workflow-editor-edge-path${selected ? ' is-selected' : ''}`}
          style={style}
        />
      </g>
      {selected ? (
        <EdgeLabelRenderer>
          <div
            className="workflow-editor-edge-action nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(${1 / zoom})` }}
          >
            <button
              type="button"
              aria-label={wu().mcb19372d}
              title={wu().m0a7114b5}
              onPointerDown={event => event.stopPropagation()}
              onClick={event => {
                event.stopPropagation();
                data?.onDelete?.(id);
              }}
            >
              <Icon name="trash" size={13} strokeWidth={1.55} />
            </button>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const EDGE_TYPES = { workflowEdge: WorkflowEditorEdge };

type NodeCatalogEntry = {
  kind: WorkflowEditorNodeKind;
  label: string;
  description: string;
  eyebrow: string;
  tone: EditorNodeData['tone'];
  flowId?: string;
};

const DEFAULT_NODE_CATALOG_ENTRY: NodeCatalogEntry = {
  kind: 'agent', label: wu().m28febba2, description: wu().m87c607d7, eyebrow: 'EXECUTE', tone: 'agent',
};

const NODE_CATALOG: ReadonlyArray<NodeCatalogEntry> = [
  { kind: 'start', label: wu().m79cc871c, description: wu().m6531be7e, eyebrow: 'START', tone: 'input' },
  { kind: 'clarify', label: wu().md333b982, description: wu().me4af7afc, eyebrow: 'INPUT', tone: 'input' },
  DEFAULT_NODE_CATALOG_ENTRY,
  { kind: 'branch', label: wu().mb4e4100a, description: wu().md0aa2a0c, eyebrow: 'BRANCH', tone: 'input' },
  { kind: 'review', label: wu().mb56d9ac6, description: wu().md185405f, eyebrow: 'REVIEW', tone: 'input' },
  { kind: 'delivery', label: wu().m0a2c91ce, description: wu().m6e9cd3db, eyebrow: 'RESULT', tone: 'delivery' },];
const NODE_MENU_CATALOG = (['start', 'branch', 'clarify', 'agent', 'delivery'] as const)
  .map(kind => NODE_CATALOG.find(item => item.kind === kind)!);


function canonicalNodeKind(kind: WorkflowEditorNodeKind): Exclude<WorkflowEditorNodeKind, 'decision' | 'canvas-card'> {
  if (kind === 'decision') return 'review';
  if (kind === 'canvas-card') return 'delivery';
  return kind;
}

function graphSafeNodeId(value: string, fallbackIndex = 0): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(normalized) ? normalized : `node-${normalized || fallbackIndex + 1}`;
}

function normalizeGraphNodeIds(
  nodes: NonNullable<WorkflowEditorConfig['nodes']>,
  edges: NonNullable<WorkflowEditorConfig['edges']>,
): { nodes: NonNullable<WorkflowEditorConfig['nodes']>; edges: NonNullable<WorkflowEditorConfig['edges']> } {
  const used = new Set<string>();
  const idMap = new Map<string, string>();
  const normalizedNodes = nodes.map((node, index) => {
    const base = graphSafeNodeId(node.id, index);
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    idMap.set(node.id, id);
    return id === node.id ? node : { ...node, id };
  });
  return {
    nodes: normalizedNodes,
    edges: edges.flatMap(edge => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      return source && target ? [{ ...edge, source, target }] : [];
    }),
  };
}

function mergeLegacyArtifactNodes(config: WorkflowEditorConfig): {
  nodes: NonNullable<WorkflowEditorConfig['nodes']>;
  edges: NonNullable<WorkflowEditorConfig['edges']>;
} {
  const normalizedGraph = normalizeGraphNodeIds(
    (config.nodes ?? []).map((node, index) => ({ ...node, position: workflowNodePosition(node.position, index) })),
    (config.edges ?? []).map(edge => ({ ...edge })),
  );
  const nodes = normalizedGraph.nodes.map(node => canonicalNodeKind(node.kind) === 'agent' && node.agentConfig?.confirmation && !node.agentConfig.confirmation.title?.trim()
    ? {
        ...node,
        agentConfig: normalizedAgentConfig({
          ...node.agentConfig,
          confirmation: { ...node.agentConfig.confirmation, title: wu().resultConfirm(node.title || wu().run) },
        }),
      }
    : node);
  return { nodes, edges: normalizedGraph.edges };
}

function editorNodeFromSnapshot(
  snapshot: NonNullable<WorkflowEditorConfig['nodes']>[number],
  stageSnapshot?: WorkflowEditorConfig['stages'][number],
  workflowName: string = snapshot.title,
): Node<EditorNodeData> {
  const kind = canonicalNodeKind(snapshot.kind);
  const catalog = NODE_CATALOG.find(item => item.kind === kind) ?? DEFAULT_NODE_CATALOG_ENTRY;
  const title = kind === 'clarify' && LEGACY_CLARIFY_TITLE.test(snapshot.title)
    ? wu().md333b982
    : kind === 'agent' && LEGACY_AGENT_TITLE.test(snapshot.title)
      ? wu().m28febba2
      : snapshot.title;  return {
    id: snapshot.id,
    type: 'workflowStage',
    position: snapshot.position,
    data: {
      kind,
      eyebrow: catalog.eyebrow,
      title,
      summary: snapshot.description,
      cardNumber: snapshot.cardNumber,
      inputReferences: snapshot.inputReferences ?? [],
      flowId: snapshot.flowId,
      ...(snapshot.resultSurfaces ? { resultSurfaces: snapshot.resultSurfaces } : {}),
      ...(kind === 'agent'
        ? { agentConfig: normalizedAgentConfig(snapshot.agentConfig || stageSnapshot?.agentConfig || {
            skillIds: [],
            knowledgeIds: stageSnapshot?.enabledKnowledgeIds || [],
          }) }
        : {}),
      ...(kind === 'start' ? { startConfig: normalizedStartConfig(snapshot.startConfig, workflowName || wu().mfdba55f2) } : {}),
      ...(kind === 'clarify' ? { clarificationConfig: normalizedClarificationConfig(snapshot.clarificationConfig) } : {}),
      ...(kind === 'review' ? { reviewConfig: normalizedReviewConfig(snapshot.reviewConfig) } : {}),
      ...(kind === 'branch' ? { branchConfig: normalizedBranchConfig(snapshot.branchConfig) } : {}),
      ...(kind === 'delivery' ? { deliveryConfig: normalizedDeliveryConfig(snapshot.deliveryConfig) } : {}),
      tone: catalog.tone,
    },
  };
}

function selectableSteps(flow: PlanFlowContract): SelectableStep[] {
  return flow.steps.map(step => ({
    id: step.id,
    title: step.title,
    actor: toStepActor(step.actor),
    knowledgeIds: step.knowledge.map(item => item.id),
  }));
}

function WorkflowEditorContent({
  initialConfig,
  workflowId = 'workflow',
  workflowTitle = wu().mcc19798b,
  initialWorkflowMarkdown,
  loadFlow,
  presetFlowIds = EMPTY_PRESET_FLOW_IDS,
  primaryPresetFlowId = presetFlowIds[0],
  startBlank = false,
  newWorkflow = false,
  selectionStorageNamespace = 'default',
  backLabel = wu().mcf09a7e7,
  runLabel = wu().m4fb89aef,
  showRunAction = true,
  onBack,
  onSave,
  onRun,
  onDelete,
  onDirtyChange,
  onConfigChange,
  expandDescription,
  renderClarificationPreview,
  renderReviewPreview,
  renderGenerationOptions,
  renderSkillPicker,
  videoOptions,
  renderCanvasComposer,
  renderArtifactSelect,
  onAddToConversation,
  onConversationTargetChange,
  conversationNodeId,
  conversationDisabled,
  locale,
}: {
  initialConfig?: WorkflowEditorConfig;
  workflowId?: string;
  workflowTitle?: string;
  initialWorkflowMarkdown?: string;
  loadFlow?: (flowId: string) => Promise<PlanFlowContract>;
  presetFlowIds?: readonly string[];
  primaryPresetFlowId?: string;
  startBlank?: boolean;
  /** The blank creation route has no persisted graph yet. */
  newWorkflow?: boolean;
  /** Keeps browser-local workflow choices isolated between OEM products. */
  selectionStorageNamespace?: string;
  backLabel?: string;
  runLabel?: string;
  showRunAction?: boolean;
  onBack: () => void;
  onSave: (config: WorkflowEditorConfig) => void | Promise<void>;
  onRun: (config: WorkflowEditorConfig) => void;
  onDelete?: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  /** Emits the live graph, including unsaved canvas edits, for read-only copilots and previews. */
  onConfigChange?: (config: WorkflowEditorConfig) => void;
  /** Host owns model selection and transient credentials, outside the saved graph. */
  expandDescription?: (input: { workflowName: string; description: string }) => Promise<string>;
  renderClarificationPreview?: (config: WorkflowClarificationNodeConfig) => React.ReactNode;
  renderGenerationOptions?: (config: WorkflowDeliveryNodeConfig, onChange: (config: WorkflowDeliveryNodeConfig) => void) => React.ReactNode;
  renderReviewPreview?: (config: WorkflowReviewNodeConfig, onChange: (config: WorkflowReviewNodeConfig) => void) => React.ReactNode;
  renderSkillPicker?: EditorNodeData['renderSkillPicker'];
  renderArtifactSelect?: EditorNodeData['renderArtifactSelect'];
  videoOptions?: EditorNodeData['videoOptions'];
  /** Host supplies the conversation; the editor retains its complete add-card menu. */
  renderCanvasComposer?: (addCardControl: React.ReactNode) => React.ReactNode;
  onAddToConversation?: (nodeId: string) => void;
  onConversationTargetChange?: (nodeId: string | undefined) => void;
  conversationNodeId?: string;
  conversationDisabled?: boolean;
  locale?: string | null;
}) {
  bindWorkflowLocale(locale);
  const fetch = useWorkflowApi();
  const reactFlow = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const [flows, setFlows] = React.useState<Record<string, PlanFlowContract>>({});
  const [skillOptions, setSkillOptions] = React.useState<SkillSummary[]>([]);
  const [knowledgeWikis, setKnowledgeWikis] = React.useState<KnowledgeWikiOption[]>([]);
  const [nodes, setNodes] = React.useState<Array<Node<EditorNodeData>>>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const nextCardNumber = React.useRef(1);
  const nodeDataCache = React.useRef<ReadonlyArray<Pick<Node<EditorNodeData>, 'id' | 'data'>>>([]);
  const nodeData = workflowNodeDataSnapshot(nodeDataCache.current, nodes);
  nodeDataCache.current = nodeData;
  const sourceOrder = React.useMemo(() => workflowSourceOrder(nodeData, edges), [nodeData, edges]);
  const [selectedId, setSelectedId] = React.useState('');
  const [selectedEdgeId, setSelectedEdgeId] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const editRevisionRef = React.useRef(0);
  const [deleteArmed, setDeleteArmed] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [nodeMenuOpen, setNodeMenuOpen] = React.useState(false);
  const addCardMenuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!nodeMenuOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Element && !addCardMenuRef.current?.contains(event.target)) setNodeMenuOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNodeMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [nodeMenuOpen]);
  const [canvasBackground, setCanvasBackground] = React.useState<CanvasBackgroundPattern>('dots');
  const [canvasTone, setCanvasTone] = React.useState<CanvasBackgroundTone>('default');
  const [canvasEdgesVisible, setCanvasEdgesVisible] = React.useState(true);
  const previousLayoutRef = React.useRef<Map<string, { x: number; y: number }> | null>(null);
  const [expandingStartDescription, setExpandingStartDescription] = React.useState(false);
  const [startExpansionError, setStartExpansionError] = React.useState('');
  const [inspectorAnchor, setInspectorAnchor] = React.useState<{
    nodeId: string;
    side: 'left' | 'right';
    nodeWidth: number;
    panelWidth: number;
    topOffset: number;
  } | null>(null);
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const inspectorRef = React.useRef<HTMLElement>(null);
  const initialViewportFittedRef = React.useRef(false);

  function markDirty(): void {
    editRevisionRef.current += 1;
    setDirty(true);
  }

  function fitCanvas(): void {
    void reactFlow.fitView({ padding: 0.18, minZoom: 0.1, maxZoom: 0.88, duration: 220 });
  }

  function tidyCanvas(mode: 'connections' | 'kind'): void {
    if (nodes.length === 0) return;
    previousLayoutRef.current = new Map(nodes.map(node => [node.id, { ...node.position }]));
    const depth = new Map<string, number>();
    if (mode === 'connections') {
      const ids = new Set(nodes.map(node => node.id));
      const indegree = new Map(nodes.map(node => [node.id, 0]));
      for (const edge of edges) if (ids.has(edge.source) && ids.has(edge.target)) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
      const queue = nodes.filter(node => (indegree.get(node.id) ?? 0) === 0).map(node => node.id);
      for (const id of queue) depth.set(id, 0);
      for (let index = 0; index < queue.length; index += 1) {
        const source = queue[index]!;
        for (const edge of edges) {
          if (edge.source !== source || !ids.has(edge.target)) continue;
          depth.set(edge.target, Math.max(depth.get(edge.target) ?? 0, (depth.get(source) ?? 0) + 1));
          const remaining = (indegree.get(edge.target) ?? 0) - 1;
          indegree.set(edge.target, remaining);
          if (remaining === 0) queue.push(edge.target);
        }
      }
      const lastDepth = Math.max(0, ...depth.values());
      for (const node of nodes) if (!depth.has(node.id)) depth.set(node.id, node.data.kind === 'start' ? 0 : lastDepth + 1);
    } else {
      const kindOrder = NODE_CATALOG.map(item => item.kind);
      for (const node of nodes) depth.set(node.id, kindOrder.indexOf(node.data.kind));
    }
    const rows = new Map<number, number>();
    const next = [...nodes].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0) || a.position.y - b.position.y);
    const positions = new Map(next.map(node => {
      const column = depth.get(node.id) ?? 0;
      const row = rows.get(column) ?? 0;
      rows.set(column, row + 1);
      return [node.id, { x: 80 + column * 660, y: 120 + row * 400 }] as const;
    }));
    setNodes(current => current.map(node => ({ ...node, position: positions.get(node.id) ?? node.position })));
    markDirty();
    window.requestAnimationFrame(() => window.requestAnimationFrame(fitCanvas));
  }

  function revertCanvasLayout(): void {
    const previous = previousLayoutRef.current;
    if (!previous) return;
    setNodes(current => current.map(node => ({ ...node, position: previous.get(node.id) ?? node.position })));
    previousLayoutRef.current = null;
    markDirty();
    window.requestAnimationFrame(() => window.requestAnimationFrame(fitCanvas));
  }

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  React.useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);

  React.useEffect(() => {
    let active = true;
    void loadWorkflowEditorPresetFlows(startBlank, presetFlowIds, async flowId => {
      if (!loadFlow) throw new Error(wu().md8989b7c);
      return loadFlow(flowId);
    }).then(items => {
      if (!active) return;
      const nextFlows = Object.fromEntries(items.map(flow => [flow.id, flow]));
      setFlows(nextFlows);
      const inputFlow = primaryPresetFlowId ? nextFlows[primaryPresetFlowId] : undefined;
      const presetNodes: Array<Node<EditorNodeData>> = [
        {
          id: 'start',
          type: 'workflowStage',
          position: DEFAULT_POSITIONS[0],
          data: {
            kind: 'start',
            eyebrow: 'START',
            title: wu().m79cc871c,
            summary: wu().m6531be7e,
            startConfig: normalizedStartConfig(initialWorkflowMarkdown ? { workflowMarkdown: initialWorkflowMarkdown, workflowName: workflowTitle, description: '', triggerScenarios: [], includeProjectContext: true } : undefined, workflowTitle, workflowId),
            tone: 'input',
          },
        },
        {
          id: 'clarify',
          type: 'workflowStage',
          position: DEFAULT_POSITIONS[1],
          data: {
            kind: 'clarify',
            eyebrow: 'INPUT',
            title: wu().md333b982,
            summary: wu().ma6b5d7b7,
            clarificationConfig: normalizedClarificationConfig({
              title: inputFlow?.input?.title || wu().me5610ada,
              description: wu().mdd0d5086,
              submitLabel: inputFlow?.input?.submit.label || wu().m6793e8ac,
              attachmentsEnabled: Boolean(inputFlow?.input?.attachments.enabled),
            }),
            tone: 'input',
          },
        },
        ...items.flatMap((flow, index): Array<Node<EditorNodeData>> => {
          const isFinalResult = index === items.length - 1;
          const agentNode: Node<EditorNodeData> = {
            id: graphSafeNodeId(`agent-${flow.id}`),
            type: 'workflowStage',
            position: { x: 680 + index * 620, y: index % 2 === 0 ? 180 : 300 },
            data: {
              kind: 'agent',
              eyebrow: `EXECUTE ${index + 1}`,
              title: wu().m28febba2,
              summary: wu().execSteps(flow.steps.filter(step => step.actor !== 'Eval').length),
              flowId: flow.id,
              agentConfig: normalizedAgentConfig({
                skillIds: [],
                knowledgeIds: flow.steps
                  .filter(step => step.actor !== 'Eval')
                  .flatMap(step => step.knowledge)
                  .filter(item => item.defaultEnabled || item.required)
                  .map(item => item.id),
              }),
              tone: 'agent',
            },
          };
          if (isFinalResult) {
            return [agentNode, {
              id: graphSafeNodeId(`delivery-${flow.id}`),
              type: 'workflowStage',
              position: { x: 1010 + index * 620, y: 300 },
              data: {
                kind: 'delivery',
                eyebrow: 'RESULT',
                title: wu().m0a2c91ce,
                summary: wu().m1000fd65,                flowId: flow.id,
                resultSurfaces: ['chat', 'canvas'],
                deliveryConfig: normalizedDeliveryConfig({ artifactKind: 'text' }),
                tone: 'delivery',
              },
            }];
          }
          return [agentNode, {
            id: graphSafeNodeId(`review-${flow.id}`),
            type: 'workflowStage',
            position: { x: 1010 + index * 620, y: 300 },
            data: {
              kind: 'review',
              eyebrow: 'REVIEW',
              title: wu().flowConfirm(flow.title),
              summary: wu().md8f14b57,
              flowId: flow.id,
              resultSurfaces: ['chat', 'canvas'],
              reviewConfig: normalizedReviewConfig(),
              tone: 'input',
            },
          }];
        }),
      ];
      const migratedInitial = initialConfig?.nodes ? mergeLegacyArtifactNodes(initialConfig) : null;
      const nextNodes = migratedInitial
        ? migratedInitial.nodes.map(snapshot => editorNodeFromSnapshot(
            snapshot,
            snapshot.flowId ? stageSnapshotOf(initialConfig, snapshot.flowId) : undefined,
            initialConfig?.title || workflowTitle,
          ))
        : startBlank
          ? presetNodes.slice(0, 1)
          : presetNodes;
      const nextEdges = migratedInitial
        ? migratedInitial.edges.map(edge => ({ ...edge }))
        : nextNodes.slice(1).map((node, index) => ({
          id: `edge-${nextNodes[index]?.id || 'input'}-${node.id}`,
          source: nextNodes[index]?.id || 'input',
          target: node.id,
          animated: index === 0,
        }));
      const numbered = workflowSourceOrder(nextNodes, nextEdges);
      nextCardNumber.current = Math.max(initialConfig?.nextCardNumber ?? 1, ...[...numbered.values()].map(value => value + 1));
      setNodes(spreadOverlappingNodes(nextNodes.map(node => ({ ...node, data: { ...node.data, cardNumber: numbered.get(node.id) } }))));
      setEdges(nextEdges);
      setSelectedId('');
      setSelectedEdgeId('');
      // 项目里存过的取舍优先恢复到当前执行选择层。
      for (const flow of items) {
        const saved = stageSnapshotOf(initialConfig, flow.id);
        if (!saved) continue;
        const steps = selectableSteps(flow);
        for (const step of steps) {
          setStepSkipped(selectionStorageNamespace, flow.id, step.id, saved.skippedStepIds.includes(step.id), steps);
        }
        const knowledge = flow.steps.filter(step => step.actor !== 'Eval').flatMap(step => step.knowledge);
        for (const item of knowledge) {
          setKnowledgeEnabled(selectionStorageNamespace, flow.id, item.id, saved.enabledKnowledgeIds.includes(item.id), knowledge);
        }
      }
      setLoading(false);
    }).catch(reason => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : wu().ma41f6547);
      setLoading(false);
    });
    return () => { active = false; };
  }, [initialConfig, initialWorkflowMarkdown, loadFlow, presetFlowIds, primaryPresetFlowId, selectionStorageNamespace, startBlank, workflowId, workflowTitle]);

  React.useEffect(() => {
    let active = true;
    void Promise.all([
      fetch('/api/skills', { cache: 'no-store' }).then(response => response.ok ? response.json() : { skills: [] }),
      fetch('/api/knowledge-base/wikis', { cache: 'no-store' }).then(response => response.ok ? response.json() : { provider: 'local', wikis: [] }),
    ]).then(([skillPayload, knowledgePayload]) => {
      if (!active) return;
      setSkillOptions(Array.isArray(skillPayload.skills) ? skillPayload.skills : []);
      const provider: WorkflowKnowledgeProvider = 'local';
      setKnowledgeWikis(Array.isArray(knowledgePayload.wikis)
        ? knowledgePayload.wikis
          .filter((wiki: { id?: unknown; title?: unknown }) => typeof wiki.id === 'string' && typeof wiki.title === 'string')
          .map((wiki: { id: string; title: string }) => ({ id: wiki.id, title: wiki.title, provider }))
        : []);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    if (loading || !nodesInitialized || nodes.length === 0 || initialViewportFittedRef.current) return;
    initialViewportFittedRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      void reactFlow.fitView({ padding: 0.18, maxZoom: 0.88, duration: 180 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, nodes.length, nodesInitialized, reactFlow]);

  const selectedNode = nodes.find(node => node.id === selectedId);

  function buildConfig(): WorkflowEditorConfig {
    const startNode = nodes.find(node => node.data.kind === 'start');
    const startConfig = startNode?.data.startConfig
      ? normalizedStartConfig(startNode.data.startConfig, workflowTitle, workflowId)
      : undefined;
    const reviewOrDeliveryByFlow = new Map(
      nodes
        .filter(node => (node.data.kind === 'review' || node.data.kind === 'delivery') && node.data.flowId)
        .map(node => [node.data.flowId!, node]),
    );
    const agentByFlow = new Map(
      nodes
        .filter(node => node.data.kind === 'agent' && node.data.flowId)
        .map(node => [node.data.flowId!, node]),
    );
    const seenFlows = new Set<string>();
    return {
      id: workflowId,
      nextCardNumber: nextCardNumber.current,
      version: 2,
      title: startConfig?.workflowName || workflowTitle,
      updatedAt: new Date().toISOString(),
      nodes: nodes.map(node => ({
        id: node.id,
        kind: node.data.kind,
        title: node.data.title,
        description: node.data.summary,
        cardNumber: node.data.cardNumber,
        inputReferences: node.data.inputReferences ?? [],
        ...(node.data.flowId ? { flowId: node.data.flowId } : {}),
        ...(node.data.resultSurfaces ? { resultSurfaces: node.data.resultSurfaces } : {}),
        ...(node.data.kind === 'agent' && node.data.agentConfig
          ? { agentConfig: normalizedAgentConfig(node.data.agentConfig) }
          : {}),
        ...(node.data.kind === 'start' && node.data.startConfig
          ? { startConfig: normalizedStartConfig(node.data.startConfig, workflowTitle, workflowId) }
          : {}),
        ...(node.data.kind === 'clarify' && node.data.clarificationConfig
          ? { clarificationConfig: normalizedClarificationConfig(node.data.clarificationConfig) }
          : {}),
        ...(node.data.kind === 'review' && node.data.reviewConfig
          ? { reviewConfig: normalizedReviewConfig(node.data.reviewConfig) }
          : {}),
        ...(node.data.kind === 'branch' && node.data.branchConfig
          ? { branchConfig: normalizedBranchConfig(node.data.branchConfig) }
          : {}),
        ...(node.data.kind === 'delivery' && node.data.deliveryConfig
          ? { deliveryConfig: normalizedDeliveryConfig(node.data.deliveryConfig) }
          : {}),
        position: node.position,
      })),
      edges: edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
        ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      })),
      stages: nodes.flatMap(node => {
        const flowId = node.data.flowId;
        if (!flowId || seenFlows.has(flowId)) return [];
        seenFlows.add(flowId);
        const flow = flows[flowId];
        if (!flow) return [];
        const presentationNode = reviewOrDeliveryByFlow.get(flowId) || node;
        const agentNode = agentByFlow.get(flowId);
        const knowledge = flow.steps.filter(step => step.actor !== 'Eval').flatMap(step => step.knowledge);
        const agentConfig = agentNode?.data.agentConfig
          ? normalizedAgentConfig(agentNode.data.agentConfig)
          : undefined;
        return [{
          flowId,
          skippedStepIds: skippedStepIds(selectionStorageNamespace, flowId, selectableSteps(flow)),
          enabledKnowledgeIds: agentConfig?.knowledgeIds || enabledKnowledgeIds(selectionStorageNamespace, flowId, knowledge),
          position: presentationNode.position,
          ...(presentationNode.data.resultSurfaces ? { resultSurfaces: presentationNode.data.resultSurfaces } : {}),
          ...(agentConfig ? { agentConfig } : {}),
        }];
      }),
    };
  }

  React.useEffect(() => {
    // Drag frames belong to React Flow. Publish the final positions to the host
    // when the gesture ends, so the assistant does not rebuild on every pixel.
    if (loading || nodes.some(node => node.dragging)) return;
    onConfigChange?.(buildConfig());
  }, [edges, flows, loading, nodes, onConfigChange, workflowId, workflowTitle]);

  async function saveCurrentConfig(): Promise<void> {
    if (saving) return;
    const revision = editRevisionRef.current;
    setSaving(true);
    try {
      await onSave(buildConfig());
      if (editRevisionRef.current === revision) setDirty(false);
    } catch {
      // The host owns the visible error message. Keeping the editor dirty is
      // the important contract: a failed request must never look saved.
    } finally {
      setSaving(false);
    }
  }

  function addNode(kind: WorkflowEditorNodeKind, connectionSource?: { nodeId: string; routeId?: string }) {
    const normalizedKind = canonicalNodeKind(kind);
    const catalog = NODE_CATALOG.find(item => item.kind === normalizedKind);
    if (!catalog) return;
    if (normalizedKind === 'start' && nodes.some(node => node.data.kind === 'start')) return;

    const nodeId = `${kind}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;
    const rightmostX = nodes.reduce(
      (max, node) => Math.max(max, node.position.x + workflowNodeWidth(node.data.kind)),
      40,
    );
    const connectedSourceNode = connectionSource ? nodes.find(node => node.id === connectionSource.nodeId) : undefined;
    const branchRouteId = connectionSource?.routeId;
    const branchRouteIndex = connectedSourceNode?.data.kind === 'branch' && branchRouteId
      ? normalizedBranchConfig(connectedSourceNode.data.branchConfig).routes.findIndex(route => route.id === branchRouteId)
      : -1;
    const nextNode: Node<EditorNodeData> = {
      id: nodeId,
      type: 'workflowStage',
      position: {
        x: connectedSourceNode ? connectedSourceNode.position.x + workflowNodeWidth(connectedSourceNode.data.kind) + 80 : nodes.length === 0 ? 120 : rightmostX + 50,
        y: connectedSourceNode ? connectedSourceNode.position.y + Math.max(0, branchRouteIndex) * 170 : 190 + (nodes.length % 3) * 115,
      },
      data: {
        cardNumber: nextCardNumber.current++,
        kind: normalizedKind,
        eyebrow: catalog.eyebrow,
        title: catalog.label,
        summary: catalog.description,
        ...(!startBlank && catalog.flowId ? { flowId: catalog.flowId } : {}),
        ...(normalizedKind === 'review'
            ? { resultSurfaces: ['chat', 'canvas'] as WorkflowResultSurface[] }
            : {}),
        ...(normalizedKind === 'agent' ? { agentConfig: normalizedAgentConfig({
          skillIds: [],
          knowledgeIds: [],
          outputContract: { format: 'json' },
        }) } : {}),
        ...(normalizedKind === 'start' ? { startConfig: normalizedStartConfig(undefined, workflowTitle, workflowId) } : {}),
        ...(normalizedKind === 'clarify' ? { clarificationConfig: normalizedClarificationConfig() } : {}),
        ...(normalizedKind === 'review' ? { reviewConfig: normalizedReviewConfig({ artifactKind: 'text' }) } : {}),
        ...(normalizedKind === 'branch' ? { branchConfig: normalizedBranchConfig() } : {}),
        ...(normalizedKind === 'delivery' ? { deliveryConfig: normalizedDeliveryConfig() } : {}),
        tone: catalog.tone,
      },
    };
    const sourceNode = connectedSourceNode ?? selectedNode ?? nodes[nodes.length - 1];
    setNodes(current => [...current, nextNode]);
    if (connectedSourceNode?.data.kind === 'branch' && branchRouteId && connectionSource) {
      setEdges(current => addEdge({
        id: `edge-${connectionSource.nodeId}-${branchRouteId}-${nodeId}`,
        source: connectionSource.nodeId,
        sourceHandle: branchRouteId,
        target: nodeId,
      }, current.filter(edge => !(edge.source === connectionSource.nodeId && edge.sourceHandle === branchRouteId))));
    } else if (sourceNode
      && sourceNode.id !== nextNode.id
      && sourceNode.data.kind !== 'branch') {
      setEdges(current => addEdge({
        id: `edge-${sourceNode.id}-${nextNode.id}`,
        source: sourceNode.id,
        target: nextNode.id,
      }, current));
    }
    setSelectedId(normalizedKind === 'start' ? nodeId : '');
    markDirty();
  }

  function updateSelectedNode(patch: Partial<Pick<EditorNodeData,
    'title' | 'summary' | 'flowId' | 'resultSurfaces' | 'startConfig' | 'clarificationConfig' | 'reviewConfig' | 'branchConfig' | 'deliveryConfig'
  >>) {
    if (!selectedId) return;
    setNodes(current => current.map(node => node.id === selectedId
      ? { ...node, data: { ...node.data, ...patch } }
      : node));
    markDirty();
  }

  function updateBranchNodeConfig(nodeId: string, patch: Partial<WorkflowBranchNodeConfig>) {
    const currentNode = nodes.find(node => node.id === nodeId);
    if (!currentNode || currentNode.data.kind !== 'branch') return;
    const nextConfig = normalizedBranchConfig({
      ...normalizedBranchConfig(currentNode.data.branchConfig),
      ...patch,
    });
    setNodes(current => current.map(node => node.id === nodeId
      ? { ...node, data: { ...node.data, branchConfig: nextConfig } }
      : node));
    markDirty();
  }

  function removeBranchRoute(nodeId: string, routeId: string) {
    const currentNode = nodes.find(node => node.id === nodeId);
    if (!currentNode || currentNode.data.kind !== 'branch') return;
    const currentConfig = normalizedBranchConfig(currentNode.data.branchConfig);
    if (currentConfig.routes.length <= 2) return;
    const routes = currentConfig.routes.filter(route => route.id !== routeId);
    updateBranchNodeConfig(nodeId, {
      routes,
      defaultRouteId: currentConfig.defaultRouteId === routeId ? routes[0]?.id : currentConfig.defaultRouteId,
    });
    setEdges(current => current.filter(edge => !(edge.source === nodeId && edge.sourceHandle === routeId)));
  }

  function addBranchRoute(nodeId: string) {
    const currentNode = nodes.find(node => node.id === nodeId);
    if (!currentNode || currentNode.data.kind !== 'branch') return;
    const current = normalizedBranchConfig(currentNode.data.branchConfig);
    const id = `route-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;
    updateBranchNodeConfig(nodeId, {
      routes: [...current.routes, { id, label: '', condition: '' }],
    });
  }

  function updateAgentNodeConfig(nodeId: string, patch: Partial<WorkflowAgentNodeConfig>) {
    const currentNode = nodes.find(node => node.id === nodeId);
    if (!currentNode || currentNode.data.kind !== 'agent') return;
    const currentConfig = normalizedAgentConfig(currentNode.data.agentConfig);
    const nextConfig = normalizedAgentConfig({ ...currentConfig, ...patch });
    setNodes(current => current.map(node => node.id === nodeId
      ? { ...node, data: { ...node.data, agentConfig: nextConfig } }
      : node));

    markDirty();
  }

  function updateAgentNodeTitle(nodeId: string, title: string) {
    setNodes(current => current.map(item => {
      if (item.id !== nodeId) return item;
      const confirmation = item.data.agentConfig?.confirmation;
      const followsExecutionTitle = confirmation?.title === wu().resultConfirm(item.data.title || wu().run);
      return {
        ...item,
        data: {
          ...item.data,
          title,
          ...(confirmation && followsExecutionTitle ? {
            agentConfig: normalizedAgentConfig({
              ...item.data.agentConfig,
              skillIds: item.data.agentConfig?.skillIds ?? [],
              knowledgeIds: item.data.agentConfig?.knowledgeIds ?? [],
              confirmation: { ...confirmation, title: wu().resultConfirm(title) },
            }),
          } : {}),
        },
      };
    }));
    markDirty();
  }

  function updateStartNodeTitle(nodeId: string, title: string) {
    setNodes(current => current.map(item => {
      if (item.id !== nodeId) return item;
      const startConfig = normalizedStartConfig(item.data.startConfig, workflowTitle, workflowId);
      const markdown = replaceWorkflowFrontmatterScalar(startConfig.workflowMarkdown || '', 'name', title);
      const lines = markdown.split('\n');
      const headingIndex = lines.findIndex(line => line === `# ${startConfig.workflowName}`);
      if (headingIndex >= 0) lines[headingIndex] = `# ${title}`;
      return {
        ...item,
        data: {
          ...item.data,
          startConfig: { ...startConfig, workflowName: title, workflowMarkdown: lines.join('\n') },
        },
      };
    }));
    markDirty();
  }

  async function expandStartDescription(): Promise<void> {
    if (!selectedNode || selectedNode.data.kind !== 'start' || expandingStartDescription) return;
    const current = normalizedStartConfig(selectedNode.data.startConfig, workflowTitle, workflowId);
    if (!current.description.trim()) return;
    setExpandingStartDescription(true);
    setStartExpansionError('');
    try {
      if (!expandDescription) throw new Error(wu().m2cb95947);
      const description = (await expandDescription({ workflowName: current.workflowName, description: current.description })).trim();
      if (!description) throw new Error(wu().mf09702ba);
      updateSelectedNode({
        startConfig: {
          ...current,
          description,
          workflowMarkdown: replaceWorkflowFrontmatterScalar(current.workflowMarkdown || '', 'description', description),
        },
      });
    } catch (reason) {
      setStartExpansionError(reason instanceof Error ? reason.message : wu().me4c85b59);
    } finally {
      setExpandingStartDescription(false);
    }
  }

  function removeNode(nodeId: string) {
    if (!nodeId) return;
    setNodes(current => current.filter(node => node.id !== nodeId).map(node => ({ ...node, data: { ...node.data, inputReferences: node.data.inputReferences?.filter(id => id !== nodeId) } })));
    setEdges(current => current.filter(edge => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedId(current => current === nodeId ? '' : current);
    markDirty();
  }

  function removeEdge(edgeId: string) {
    if (!edgeId) return;
    setEdges(current => current.filter(edge => edge.id !== edgeId));
    setSelectedEdgeId(current => current === edgeId ? '' : current);
    markDirty();
  }

  async function deleteWorkflow() {
    if (!onDelete || deleting) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }

  function handleNodesChange(changes: NodeChange[]) {
    // Selection is owned by selectedId/onNodeClick, not the graph snapshot.
    const graphChanges = changes.filter(change => change.type !== 'select');
    if (graphChanges.length) setNodes(current => applyNodeChanges(graphChanges, current) as Array<Node<EditorNodeData>>);
    if (changes.some(change => change.type === 'position' && change.dragging === false)) markDirty();
  }

  function handleEdgesChange(changes: EdgeChange[]) {
    setEdges(current => applyEdgeChanges(changes, current));
    if (changes.some(change => change.type === 'remove')) markDirty();
  }

  function handleConnect(connection: Connection) {
    const source = nodes.find(node => node.id === connection.source);
    if (source?.data.kind === 'branch' && !connection.sourceHandle) return;
    setEdges(current => {
      const withoutExistingRoute = source?.data.kind === 'branch'
        ? current.filter(edge => !(edge.source === connection.source && edge.sourceHandle === connection.sourceHandle))
        : current;
      return addEdge({ ...connection, id: `edge-${connection.source}-${connection.sourceHandle || 'out'}-${connection.target}-${Date.now().toString(36)}` }, withoutExistingRoute);
    });
    markDirty();
  }

  React.useLayoutEffect(() => {
    if (!selectedId || !canvasRef.current || !inspectorRef.current) {
      setInspectorAnchor(null);
      return;
    }
    const canvas = canvasRef.current;
    const inspector = inspectorRef.current;
    const selectedElement = [...canvas.querySelectorAll<HTMLElement>('.react-flow__node')]
      .find(element => element.dataset.id === selectedId);
    if (!selectedElement) return;
    const canvasRect = canvas.getBoundingClientRect();
    const nodeRect = selectedElement.getBoundingClientRect();
    const zoom = reactFlow.getViewport().zoom;
    const panelWidth = inspector.offsetWidth || 372;
    const panelHeight = inspector.scrollHeight * zoom;
    const gap = 18;
    const margin = 16;
    const nodeLeft = nodeRect.left - canvasRect.left;
    const nodeRight = nodeRect.right - canvasRect.left;
    const roomRight = canvasRect.width - nodeRight - gap * zoom - margin;
    const roomLeft = nodeLeft - gap * zoom - margin;
    const side = roomRight >= panelWidth * zoom || roomRight >= roomLeft ? 'right' : 'left';
    const idealTop = nodeRect.top - canvasRect.top;
    const top = Math.min(
      Math.max(margin, idealTop),
      Math.max(margin, canvasRect.height - panelHeight - margin),
    );
    setInspectorAnchor({
      nodeId: selectedId,
      side,
      nodeWidth: selectedElement.offsetWidth,
      panelWidth,
      topOffset: (top - idealTop) / zoom,
    });
  }, [reactFlow, selectedId]);

  const inspectorPosition = selectedNode && inspectorAnchor?.nodeId === selectedNode.id
    ? {
      left: selectedNode.position.x + (inspectorAnchor.side === 'right'
        ? inspectorAnchor.nodeWidth + 18
        : -inspectorAnchor.panelWidth - 18),
      top: selectedNode.position.y + inspectorAnchor.topOffset,
      side: inspectorAnchor.side,
    }
    : null;

  const displayedWorkflowTitle = nodes.find(node => node.data.kind === 'start')?.data.startConfig?.workflowName || workflowTitle;

  function renderAddCardControl(): React.ReactNode {
    return (
      <div className="dock-workflow-anchor" ref={addCardMenuRef}>
        {nodeMenuOpen ? <div className={addMenuStyles.menu} role="menu" aria-label={wu().m4786657d}>
          <h4>{wu().mab89692a}</h4>
          {NODE_CATALOG.map(item => {            const disabled = item.kind === 'start' && hasStartNode;
            return <button key={item.kind} type="button" role="menuitem" className={addMenuStyles.item} title={disabled ? wu().startAlreadyOnCanvas : item.description} disabled={disabled} onClick={() => { nodeActions.current.addNode(item.kind); setNodeMenuOpen(false); }}>
              <span className={addMenuStyles.icon} aria-hidden><Icon name={WORKFLOW_NODE_ICONS[item.kind]} size={16} /></span>
              <span className={addMenuStyles.label}>{item.label}</span>
              {disabled && <span className={addMenuStyles.hint}>{wu().addedLabel}</span>}
            </button>;
          })}
        </div> : null}
        <button type="button" className={`dock-primary${nodeMenuOpen ? ' is-active' : ''}`} onClick={() => setNodeMenuOpen(open => !open)} aria-label={wu().m87cf1cff} aria-haspopup="menu" aria-expanded={nodeMenuOpen}><Icon name="plus" size={18} strokeWidth={1.8} /></button>
      </div>
    );
  }

  // Event callbacks use the latest graph without invalidating every card's data
  // for a position-only change.
  const nodeActions = React.useRef({ removeNode, updateBranchNodeConfig, addBranchRoute, removeBranchRoute, addNode, updateStartNodeTitle, updateAgentNodeTitle, updateAgentNodeConfig });
  React.useLayoutEffect(() => { nodeActions.current = { removeNode, updateBranchNodeConfig, addBranchRoute, removeBranchRoute, addNode, updateStartNodeTitle, updateAgentNodeTitle, updateAgentNodeConfig }; });
  const nodePresentation = React.useMemo(() => new Map(nodeData.map(node => {
    const sharedData = {
      videoOptions,
      renderArtifactSelect,
      ...node.data,
      onDelete: () => nodeActions.current.removeNode(node.id),
      inputSources: edges.filter(edge => edge.target === node.id).flatMap(edge => {
        const source = nodeData.find(item => item.id === edge.source);
        if (!source) return [];
        return [{ id: source.id, title: source.data.kind === 'start' ? source.data.startConfig?.workflowName || source.data.title : source.data.title, kind: source.data.kind, step: sourceOrder.get(source.id),
          route: source.data.branchConfig?.routes?.find(route => route.id === edge.sourceHandle)?.label }];
      }),
      inputCandidates: (() => {
        const ancestors = new Set<string>();
        const visit = (id: string) => { for (const edge of edges) if (edge.target === id && !ancestors.has(edge.source)) { ancestors.add(edge.source); visit(edge.source); } };
        visit(node.id); ancestors.delete(node.id);
        return nodeData.filter(item => ancestors.has(item.id) && item.data.kind !== 'start' && !edges.some(edge => edge.source === item.id && edge.target === node.id))
          .map(item => ({ id: item.id, title: item.data.title, kind: item.data.kind, step: sourceOrder.get(item.id) }));
      })(),
      onInputReferencesChange: (ids: string[]) => { setNodes(current => current.map(item => item.id === node.id ? { ...item, data: { ...item.data, inputReferences: ids } } : item)); markDirty(); },
      onLocateInput: (id: string) => { setSelectedId(''); void reactFlow.fitView({ nodes: [{ id }], maxZoom: 1, duration: 200, padding: 0.3 }); },
      onAddToConversation: onAddToConversation ? () => onAddToConversation(node.id) : undefined,
      conversationFocused: node.id === conversationNodeId,
      conversationDisabled,
      ...(node.data.kind === 'clarify' ? {
        onClarificationConfigChange: (config: WorkflowClarificationNodeConfig) => {
          setNodes(current => current.map(item => item.id === node.id
            ? { ...item, data: { ...item.data, clarificationConfig: config } }
            : item));
          markDirty();
        },
        renderClarificationPreview,
      } : {}),
      ...(node.data.kind === 'delivery' ? {
        renderGenerationOptions,
        onDeliveryConfigChange: (config: WorkflowDeliveryNodeConfig) => {
          setNodes(current => current.map(item => item.id === node.id ? { ...item, data: { ...item.data, deliveryConfig: config } } : item));
          markDirty();
        },
      } : {}),
      ...(node.data.kind === 'review' ? {
        onReviewConfigChange: (config: WorkflowReviewNodeConfig) => {
          setNodes(current => current.map(item => item.id === node.id
            ? { ...item, data: { ...item.data, reviewConfig: config } }
            : item));
          markDirty();
        },
      } : {}),
      ...(node.data.kind === 'branch' ? {
        onBranchConfigChange: (patch: Partial<WorkflowBranchNodeConfig>) => nodeActions.current.updateBranchNodeConfig(node.id, patch),
        onBranchAddRoute: () => nodeActions.current.addBranchRoute(node.id),
        onBranchRemoveRoute: (routeId: string) => nodeActions.current.removeBranchRoute(node.id, routeId),
        onBranchAddNext: (routeId: string, kind: WorkflowEditorNodeKind) => nodeActions.current.addNode(kind, { nodeId: node.id, routeId }),
        onPromptOpen: () => {
          setInspectorAnchor(null);
          setSelectedId(node.id);
        },
      } : {}),
      ...(node.data.kind !== 'branch' ? {
        onAddNext: (kind: WorkflowEditorNodeKind) => nodeActions.current.addNode(kind, { nodeId: node.id }),
      } : {}),
      ...(node.data.kind === 'start' ? {
        onPromptOpen: () => { setInspectorAnchor(null); setSelectedId(node.id); },
        onTitleChange: (title: string) => nodeActions.current.updateStartNodeTitle(node.id, title),
      } : {}),
    };
    // Gates pass content through; another execution step owns its own output.
    const artifactTargets: WorkflowArtifactTarget[] = [];
    const visited = new Set<string>([node.id]);
    const pending = node.data.kind === 'agent' ? edges.filter(edge => edge.source === node.id).map(edge => edge.target) : [];
    while (pending.length) {
      const id = pending.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const target = nodeData.find(candidate => candidate.id === id);
      if (!target) continue;
      if (target.data.kind === 'delivery') {
        const config = normalizedDeliveryConfig(target.data.deliveryConfig);
        artifactTargets.push({ nodeId: target.id, title: target.data.title, kind: config.artifactKind, artifactName: config.artifactName, requirements: config.requirements, presentation: config.presentation, video: config.video, image: config.image, page: config.page, text: config.text });
      } else if (target.data.kind === 'branch' || target.data.kind === 'clarify' || target.data.kind === 'review') {
        pending.push(...edges.filter(edge => edge.source === id).map(edge => edge.target));
      }
    }
    const deliveryConnected = artifactTargets.length > 0;
    return [node.id, {
      ...(node.data.kind === 'agent' ? { dragHandle: '.workflow-agent-card-header' } : {}),
      data: node.data.kind === 'agent' ? {
        ...sharedData,
        skillOptions,
        knowledgeWikis,
        onTitleChange: (title: string) => nodeActions.current.updateAgentNodeTitle(node.id, title),
        onAgentConfigChange: (patch: Partial<WorkflowAgentNodeConfig>) => nodeActions.current.updateAgentNodeConfig(node.id, patch),
        deliveryConnected,
        artifactTargets,
        onPromptOpen: () => {
          setInspectorAnchor(null);
          setSelectedId(node.id);
        },
        renderReviewPreview,
        renderSkillPicker,
      } : sharedData,
    }] as const;
  })), [nodeData, edges, sourceOrder, videoOptions, renderArtifactSelect, renderClarificationPreview,
    renderGenerationOptions, renderReviewPreview, renderSkillPicker, skillOptions, knowledgeWikis,
    onAddToConversation, conversationNodeId, conversationDisabled, reactFlow, locale]);
  const hasStartNode = nodeData.some(node => node.data.kind === 'start');
  const composer = React.useMemo(() => renderCanvasComposer?.(renderAddCardControl()),
    [renderCanvasComposer, nodeMenuOpen, hasStartNode]);

  return (
    <section className="workflow-editor" aria-label={wu().editorTitle(displayedWorkflowTitle)}>      <header className="workflow-editor-topbar">
        <div className="workflow-editor-title">
          <Button type="button" variant="ghost" size="icon" onClick={() => {
            if (dirty && !window.confirm(wu().mf87307d3)) return;            setDirty(false);
            onDirtyChange?.(false);
            onBack();
          }} aria-label={backLabel}><Icon name="arrow-right" size={17} className="workflow-editor-back-icon" /></Button>
          <div className="workflow-editor-title-pill" title={displayedWorkflowTitle}><Icon name="layers" size={16} strokeWidth={1.55} /><strong>{displayedWorkflowTitle}</strong></div>        </div>
        <div className="workflow-editor-actions">
          <span className={dirty || newWorkflow ? 'is-dirty' : ''}>{saving ? wu().m6644f061 : dirty ? wu().mb2680641 : newWorkflow ? wu().notSavedYet : wu().mcdfab96f}</span>
          {onDelete ? <Button variant="ghost" className={deleteArmed ? 'is-danger is-armed' : 'is-danger'} type="button" disabled={loading || Boolean(error) || deleting} onClick={() => { void deleteWorkflow(); }}>{deleting ? wu().m60793243 : deleteArmed ? wu().m3c06abe1 : wu().mfac0de7a}</Button> : null}
          <Button variant={showRunAction ? 'ghost' : 'primary'} type="button" disabled={loading || Boolean(error) || saving} onClick={() => { void saveCurrentConfig(); }}>{saving ? wu().m6644f061 : wu().mfadf24db}</Button>
          {showRunAction ? <Button variant="primary" type="button" disabled={loading || Boolean(error) || saving} onClick={() => onRun(buildConfig())}>{runLabel}</Button> : null}        </div>
      </header>

      <div className="workflow-editor-body">
        <div className="workflow-editor-canvas" ref={canvasRef} style={{ backgroundColor: canvasTone === 'warm-gray' ? '#eee9df' : canvasTone === 'cool-gray' ? '#e7eef5' : '#fafafa' }}>
          {loading && <div className="workflow-editor-state">{wu().md194045d}</div>}
          {error && <div className="workflow-editor-state is-error">{error}<button type="button" onClick={() => window.location.reload()}>{wu().m5982c44c}</button></div>}          {!loading && !error && (
            <ReactFlow
              nodes={nodes.map(node => ({ ...node, ...nodePresentation.get(node.id), selected: node.id === selectedId }))}
              edges={(canvasEdgesVisible ? edges : []).map(edge => ({
                ...edge,
                type: 'workflowEdge',
                selected: edge.id === selectedEdgeId,
                data: {
                  ...edge.data,
                  onSelect: (edgeId: string) => {
                    setSelectedId('');
                    setSelectedEdgeId(edgeId);
                  },
                  onDelete: removeEdge,
                },
              }))}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={handleConnect}
              onNodeClick={(_, node) => {
                if (!conversationDisabled) onConversationTargetChange?.(node.id);
                setSelectedEdgeId('');
                setInspectorAnchor(null);
                setSelectedId(node.data.kind === 'start' ? node.id : '');
              }}
              onEdgeClick={(_, edge) => {
                setSelectedId('');
                setSelectedEdgeId(edge.id);
              }}
              onPaneClick={() => {
                if (!conversationDisabled) onConversationTargetChange?.(undefined);
                setSelectedId('');
                setSelectedEdgeId('');
              }}
              deleteKeyCode={['Backspace', 'Delete']}
              minZoom={0.1}
              maxZoom={4}
              proOptions={{ hideAttribution: true }}
            >
              {canvasBackground !== 'none' && <Background variant={canvasBackground === 'grid' ? BackgroundVariant.Lines : BackgroundVariant.Dots} color="#d8d7d2" gap={22} size={1} />}
            </ReactFlow>
          )}
          {!loading && !error && <WorkflowCanvasToolbar
            className="nowheel nopan"
            minZoom={0.1}
            maxZoom={4}
            onZoomOut={() => { void reactFlow.zoomOut({ duration: 120 }); }}
            onZoomIn={() => { void reactFlow.zoomIn({ duration: 120 }); }}
            onZoomTo={zoom => { void reactFlow.setViewport({ ...reactFlow.getViewport(), zoom }, { duration: 160 }); }}
            onFitView={fitCanvas}
            tidyActions={[
              { id: 'connections', icon: 'connections', label: wu().tidyByFlow, description: wu().tidyByFlowHint, onSelect: () => tidyCanvas('connections') },
              { id: 'kind', icon: 'category', label: wu().tidyByTask, description: wu().tidyByTaskHint, onSelect: () => tidyCanvas('kind') },
              { id: 'revert', icon: 'revert', label: wu().restoreLayout, description: wu().restoreLayoutHint, disabled: previousLayoutRef.current === null, onSelect: revertCanvasLayout },
            ]}
            background={canvasBackground}
            tone={canvasTone}
            onBackgroundChange={setCanvasBackground}
            onToneChange={setCanvasTone}
            connectionsVisible={canvasEdgesVisible}
            onConnectionsVisibleChange={setCanvasEdgesVisible}
          />}
          {!loading && !error && nodes.length === 0 ? (
            <div className="workflow-editor-empty">
              <span>{wu().m9ed2d00d}</span>
              <strong>{wu().m3a144910}</strong>
              <p>{wu().mea0fb860}</p>
            </div>
          ) : null}
          {!loading && !error ? (
            renderCanvasComposer ? <div className={intentStyles.composerSlot}>
              {composer}
            </div> : <footer className="capability-dock workflow-node-dock" role="toolbar" aria-label={wu().m87cf1cff}>
              {renderAddCardControl()}            </footer>
          ) : null}
          {!renderCanvasComposer && <div className="workflow-editor-caption">{wu().flowCaption}</div>}        </div>
        <ViewportPortal><aside
          ref={inspectorRef}
          className={`workflow-editor-inspector nowheel nopan${selectedNode?.data.kind === 'agent' || selectedNode?.data.kind === 'branch' ? ` ${stepStyles.promptPopover}` : ''}${selectedNode && selectedNode.data.kind !== 'clarify' ? ` is-open is-kind-${selectedNode.data.kind}` : ''}${inspectorPosition ? ' is-positioned' : ''}${inspectorPosition?.side === 'left' ? ' is-left' : ' is-right'}`}
          aria-hidden={!selectedNode || selectedNode.data.kind === 'clarify'}
          style={inspectorPosition ? { left: inspectorPosition.left, top: inspectorPosition.top } : undefined}
          onWheel={event => {
            if (selectedNode?.data.kind !== 'start' || event.target instanceof HTMLTextAreaElement) return;
            const editor = inspectorRef.current?.querySelector('textarea');
            if (editor) {
              editor.scrollTop += event.deltaY;
            }
          }}
        >
          {!selectedNode ? (
            <div className="workflow-inspector-empty">
              <span>{wu().m7eddbd92}</span>
              <strong>{wu().me23114b9}</strong>
              <p>{wu().ma24349d6}</p>
            </div>
          ) : (
            <>
              {selectedNode.data.kind !== 'start' && selectedNode.data.kind !== 'agent' && selectedNode.data.kind !== 'branch' ? (
                <header className="workflow-inspector-header">
                  <span className="workflow-inspector-eyebrow">{(() => {
                    const label = NODE_CATALOG.find(item => item.kind === selectedNode.data.kind)?.label || wu().m09d316b9;
                    return selectedNode.data.kind === 'clarify' ? wu().mcfbc8124 : wu().cardName(label);
                  })()}</span>
                  <button type="button" aria-label={wu().m5d8566c1} onClick={() => setSelectedId('')}><Icon name="close" size={16} /></button>                </header>
              ) : null}
              {selectedNode.data.kind !== 'start' && selectedNode.data.kind !== 'clarify' && selectedNode.data.kind !== 'agent' && selectedNode.data.kind !== 'branch' ? (
                <>
                  <label className="workflow-inspector-field">
                    <span>{wu().m116f464e}</span>
                    <input aria-label={wu().m116f464e} value={selectedNode.data.title} onChange={event => updateSelectedNode({ title: event.target.value })} />
                  </label>
                </>
              ) : null}

              {selectedNode.data.kind === 'start' ? (
                <>
                  <div className="workflow-inspector-field workflow-md-editor">
                    <div className="workflow-md-editor-head">
                      <span><Icon name="file" size={15} />WORKFLOW.md</span>
                      <div className="workflow-md-editor-actions">
                        <button
                          className="workflow-md-ai-button"
                          type="button"
                          aria-label={expandingStartDescription ? wu().mdbebc4a9 : wu().m98b924d7}
                          data-tooltip={expandingStartDescription ? wu().m8a113fe3 : wu().m98b924d7}
                          disabled={!normalizedStartConfig(selectedNode.data.startConfig, workflowTitle, workflowId).description.trim() || expandingStartDescription}
                          onClick={() => { void expandStartDescription(); }}
                        >{expandingStartDescription ? '…' : <Icon name="sparkle" size={16} />}</button>
                        <button className="workflow-md-close-button" type="button" aria-label={wu().m5d8566c1} onClick={() => setSelectedId('')}><Icon name="close" size={16} /></button>                      </div>
                    </div>
                    <textarea aria-label="WORKFLOW.md" spellCheck={false} value={normalizedStartConfig(selectedNode.data.startConfig, workflowTitle, workflowId).workflowMarkdown} onChange={event => {
                      const current = normalizedStartConfig(selectedNode.data.startConfig, workflowTitle, workflowId);
                      const metadata = metadataFromWorkflowMarkdown(event.target.value, current);
                      const lines = event.target.value.split('\n');
                      if (metadata.workflowName !== current.workflowName) {
                        const headingIndex = lines.findIndex(line => line === `# ${current.workflowName}`);
                        if (headingIndex >= 0) lines[headingIndex] = `# ${metadata.workflowName}`;
                      }
                      setStartExpansionError('');
                      updateSelectedNode({ startConfig: { ...current, ...metadata, workflowMarkdown: lines.join('\n') } });
                    }} />
                    {startExpansionError ? <small className="workflow-ai-expansion-error">{startExpansionError}</small> : null}
                  </div>
                </>
              ) : selectedNode.data.kind === 'agent' ? (
                <div className="workflow-inspector-field workflow-agent-prompt-editor">
                  <div className="workflow-md-editor-head">
                    <span><Icon name={WORKFLOW_NODE_ICONS.agent} size={16}/>{wu().executionPrompt}</span>
                    <div className="workflow-md-editor-actions">
                      <button className="workflow-md-close-button" type="button" aria-label={wu().m6b0db455} onClick={() => setSelectedId('')}><Icon name="close" size={16} /></button>                    </div>
                  </div>
                  <textarea
                    aria-label="System Prompt"
                    spellCheck={false}
                    value={normalizedAgentConfig(selectedNode.data.agentConfig).systemPrompt || ''}
                    placeholder={wu().m226476ac}
                    onChange={event => updateAgentNodeConfig(selectedNode.id, { systemPrompt: event.target.value })}
                  />
                </div>
              ) : selectedNode.data.kind === 'branch' ? (
                <div className="workflow-inspector-field workflow-agent-prompt-editor">
                  <div className="workflow-md-editor-head">
                    <span><Icon name={WORKFLOW_NODE_ICONS.branch} size={16}/>{wu().decisionPrompt}</span>
                    <div className="workflow-md-editor-actions">
                      <button className="workflow-md-close-button" type="button" aria-label={wu().m1c53d35f} onClick={() => setSelectedId('')}><Icon name="close" size={16} /></button>                    </div>
                  </div>
                  <textarea
                    aria-label={wu().m386b19d1}
                    spellCheck={false}
                    value={normalizedBranchConfig(selectedNode.data.branchConfig).instruction}
                    placeholder={wu().mf5eb451a}
                    onChange={event => updateBranchNodeConfig(selectedNode.id, { instruction: event.target.value })}
                  />
                </div>
              ) : selectedNode.data.kind === 'delivery' ? (
                <>
                  <div className="workflow-editor-hint">{wu().medbd01c8}</div>
                  <label className="workflow-inspector-field"><span>{wu().mbae0dd8c}</span><select value={normalizedDeliveryConfig(selectedNode.data.deliveryConfig).artifactKind} onChange={event => updateSelectedNode({ deliveryConfig: normalizedDeliveryConfig({ artifactKind: event.target.value as WorkflowDeliveryNodeConfig['artifactKind'] }) })}><option value="text">{wu().md80ef14f}</option><option value="page">{wu().m6359a08e}</option><option value="image">{wu().m39441c79}</option><option value="video" disabled>{wu().mac0f4825}</option></select></label>                  {normalizedDeliveryConfig(selectedNode.data.deliveryConfig).artifactKind === 'image' ? (() => {
                    const config = normalizedDeliveryConfig(selectedNode.data.deliveryConfig);
                    const image = config.image!;
                    return <div className="workflow-artifact-image-config">
                      <label className="workflow-inspector-field"><span>{wu().mf07fc510}</span><select value={image.ratio} onChange={event => updateSelectedNode({ deliveryConfig: { ...config, image: { ...image, ratio: event.target.value as NonNullable<WorkflowDeliveryNodeConfig['image']>['ratio'] } } })}>{['1:1', '3:4', '4:3', '9:16', '16:9'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
                      <label className="workflow-inspector-field"><span>{wu().mcb7916aa}</span><select value={image.count} onChange={event => updateSelectedNode({ deliveryConfig: { ...config, image: { ...image, count: Number(event.target.value) } } })}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value} {wu().m9273cc90}</option>)}</select></label>
                      <label className="workflow-inspector-field"><span>{wu().mcde9b52b}</span><select value={image.resolution} onChange={event => updateSelectedNode({ deliveryConfig: { ...config, image: { ...image, resolution: event.target.value as NonNullable<WorkflowDeliveryNodeConfig['image']>['resolution'] } } })}><option value="2K">2K</option><option value="4K">4K</option></select></label>
                    </div>;
                  })() : null}
                </>
              ) : (
                <div className="workflow-editor-hint">{wu().m4c7fc6c4}</div>
              )}

            </>
          )}
        </aside></ViewportPortal>
      </div>
    </section>
  );
}

export default function WorkflowEditor(props: React.ComponentProps<typeof WorkflowEditorContent>) {
  bindWorkflowLocale(props.locale);
  return (
    <div className="bezier-workbench workflow-editor-shell">
      <ReactFlowProvider><WorkflowEditorContent {...props} /></ReactFlowProvider>
    </div>
  );
}
