import { nativeImageModelId, type ArtifactGenerationConfig } from './artifact-generation.js';
/** Native production targets supported by workflow delivery. */
export type WorkflowArtifactKind = 'text' | 'page' | 'presentation' | 'image' | 'video';

export const WORKFLOW_ARTIFACT_OPTIONS: ReadonlyArray<{ kind: WorkflowArtifactKind; label: string }> = [
  { kind: 'text', label: '文本' },
  { kind: 'page', label: '网页' },
  { kind: 'presentation', label: 'PPT' },
  { kind: 'image', label: '图片' },
  { kind: 'video', label: '视频' },
];

export type WorkflowArtifactTarget = ArtifactGenerationConfig & {
  nodeId: string;
  kind: WorkflowArtifactKind;
  title: string;
  artifactName?: string;
  requirements?: string;
};

export const WORKFLOW_ARTIFACT_COMPONENTS: Record<WorkflowArtifactKind, string> = {
  text: '文本组件', page: '网页组件', presentation: 'PPT 组件', image: '图片组件', video: '视频组件',
};

/** Shared execution contract: delivery consumes real output, never a generation draft. */
export function workflowArtifactInstructions(targets: readonly WorkflowArtifactTarget[]): string {
  if (!targets.length) return '';
  return [
    '【下游产物交付要求】',
    ...targets.map(target => `${target.nodeId} / ${target.title}：${WORKFLOW_ARTIFACT_COMPONENTS[target.kind]}（${target.kind}）${target.artifactName ? `；产物名称：${target.artifactName}` : '；根据内容命名'}${target.requirements ? `；交付要求：${target.requirements}` : ''}${target.image ? `；图片参数 ${JSON.stringify({ ...target.image, ...(target.image.model ? { model: nativeImageModelId(target.image.model) } : {}) })}` : ''}${target.presentation ? `；PPT 参数 ${JSON.stringify(target.presentation)}` : ''}${target.video ? `；视频参数 ${JSON.stringify(target.video)}` : ''}${target.page ? `；网页参数 ${JSON.stringify(target.page)}` : ''}${target.text ? `；文本参数 ${JSON.stringify(target.text)}` : ''}`),
    '你负责完成生成，产物节点只校验和写入画布，不会再次调用模型。不得只返回计划、提示词、占位文件或任务 ID。',
    '文本：返回实际 Markdown 正文；同时交付多种产物时，文本也保存为 Markdown 项目文件并提供独立回执。网页：生成完整可预览 HTML 项目文件。PPT：生成 HTML 演示文稿项目文件，保留分页结构；不能用普通文本冒充 PPT。',
    '图片/视频：调用当前项目可用的原生媒体生成能力（bezier media generate，模型从 /api/media/models 查询），等待成功并取得真实项目文件。通过稳定 client-request-id 恢复同一次请求，失败时不要盲目重复付费生成。先核对所选模型支持的比例和时长，不支持用户参数时明确报错，不静默改值。没有可用模型或权限时明确失败，不伪造产物。',
    '严格使用指定模型、数量、尺寸、篇幅与模板。图片 references 是参考图片，先下载到项目内再作为生成输入；模板提示与参考路径须读取使用。视频 mode、首尾帧、运镜和分辨率须带入生成，图生视频缺少输入时询问用户。网页 designSystemId 指定设计系统时，先读取该系统的 DESIGN.md 与 tokens；配置不可用时报告具体原因。',
    '生成文件应在当前项目内；不要另行创建画布卡，宿主会统一交付。多个产物按 nodeId 区分，多张图片每张返回一项。',
    '文件交付回执：在最终回复中包含 <workflow-artifacts>{"artifacts":[{"nodeId":"下游产物节点 ID","kind":"对应类型","path":"项目相对文件路径","title":"根据内容生成的产物名称"}]}</workflow-artifacts>。有用户确认时，将回执放入对应候选的 content 中；保留用户要求的其他输出格式。',
  ].join('\n');
}

/** Simple execution checkpoints never own production artifacts. */
export const WORKFLOW_EXECUTION_CONFIRMATION = {
  enabled: true, selection: 'none', selectionRequired: false,
  feedbackEnabled: true, feedbackRequired: false, allowRegenerate: true,
  continueLabel: '确认并继续', artifactKind: 'text', materializeOnConfirm: false,
  mode: 'continue',
} as const;

/** Preserve confirmation interactions while keeping artifact delivery separate. */
export function normalizeWorkflowExecutionConfirmation(config: {
  title?: string;
  selection?: 'none' | 'single' | 'multiple';
  selectionRequired?: boolean;
  feedbackEnabled?: boolean;
  feedbackRequired?: boolean;
  allowRegenerate?: boolean;
  continueLabel?: string;
} = {}) {
  const selection = config.selection ?? WORKFLOW_EXECUTION_CONFIRMATION.selection;
  const feedbackEnabled = config.feedbackEnabled ?? true;
  const interaction = {
    enabled: true,
    selection,
    selectionRequired: selection !== 'none' && (config.selectionRequired ?? true),
    feedbackEnabled,
    feedbackRequired: feedbackEnabled && (config.feedbackRequired ?? false),
    allowRegenerate: config.allowRegenerate ?? true,
    continueLabel: config.continueLabel ?? '确认并继续',
  };
  return { ...WORKFLOW_EXECUTION_CONFIRMATION, ...interaction, title: config.title,
    chat: { ...interaction }, canvas: { ...interaction } };
}
