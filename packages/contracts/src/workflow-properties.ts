import { IMAGE_GENERATION_RATIOS, IMAGE_GENERATION_RESOLUTIONS, IMAGE_GENERATION_COUNTS, PRESENTATION_LENGTH_OPTIONS, TEXT_LENGTH_OPTIONS, VIDEO_GENERATION_RESOLUTIONS, type ArtifactGenerationConfig } from './artifact-generation.js';

/** One catalogue supplies the assistant's documentation and property validation. */
export interface WorkflowProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  values?: readonly (string | number)[];
  default?: unknown;
  min?: number;
  max?: number;
  integer?: boolean;
  properties?: Record<string, WorkflowProperty>;
  items?: WorkflowProperty;
  readonly?: boolean;
}
const text = (description: string): WorkflowProperty => ({ type: 'string', description });
const flag = (description: string, value: boolean): WorkflowProperty => ({ type: 'boolean', description, default: value });
const choice = (description: string, values: readonly (string | number)[], value?: unknown): WorkflowProperty => ({ type: typeof values[0] === 'number' ? 'number' : 'string', description, values, ...(value === undefined ? {} : { default: value }) });
const number = (description: string, min = 1, max?: number): WorkflowProperty => ({ type: 'number', description, integer: true, min, ...(max === undefined ? {} : { max }) });
const list = (description: string, items: WorkflowProperty): WorkflowProperty => ({ type: 'array', description, items });
const object = (description: string, properties: Record<string, WorkflowProperty>): WorkflowProperty => ({ type: 'object', description, properties });
const strings = (description: string) => list(description, text('文本'));
const template = {
  template: text('模板 ID，仅保留已有或使用用户提供的真实模板；smart 表示自动'),
  templateTitle: text('模板显示名称'), templateDescription: text('模板说明'),
  templateReferencePath: text('模板参考文件路径，不能编造'), templatePrompt: text('模板设计指令，随模板一起使用'),
};
export const ARTIFACT_PROPERTY_SCHEMAS = {
  image: object('图片生成设置；仅图片产物适用', {
    model: { ...text('继承生成模型；工作流不提供模型选择，不主动修改'), readonly: true },
    ratio: choice('图片比例', IMAGE_GENERATION_RATIOS, '1:1'), resolution: choice('图片清晰度', IMAGE_GENERATION_RESOLUTIONS, '2K'), count: choice('图片张数', IMAGE_GENERATION_COUNTS, 1),
    references: list('参考图；需要真实素材 URL，不能把描述当成地址', object('参考图', { id: text('资源 ID'), name: text('资源名称'), url: text('真实资源 URL'), prompt: text('参考图使用说明') })),
  }),
  presentation: object('PPT 设置；明确页数用 pages，篇幅档位用 length', { ...template,
    length: choice('PPT 篇幅：精简 5–7 页、适中 8–12 页、详细 13–18 页；选择档位时移除旧 pages', PRESENTATION_LENGTH_OPTIONS.map(x => x.value), 'standard'), pages: number('明确页数；设置后优先于篇幅档位'),
  }),
  page: object('网页设置', { ...template, designSystemId: text('真实设计体系 ID，不能编造'), designSystemTitle: text('设计体系名称') }),
  text: object('文本设置', { length: choice('文本篇幅：自动、短篇约300字、中篇约800字、长篇约1500字', TEXT_LENGTH_OPTIONS.map(x => x.value), 'auto'), templateId: text('真实文本模板 ID'), templateTitle: text('模板名称'), templatePrompt: text('模板内容组织和写作要求') }),
  video: object('视频设置；运行时仍需核对当前模型支持的能力', {
    model: { ...text('继承生成模型，不主动修改'), readonly: true }, mode: choice('生成方式：文生视频/图生视频/首尾帧', ['t2v', 'i2v', 'firstlast'], 't2v'), ratio: choice('视频比例', IMAGE_GENERATION_RATIOS, '16:9'), duration: number('视频时长（秒），必须符合当前媒体能力目录'), resolution: choice('分辨率，必须符合当前媒体能力目录', VIDEO_GENERATION_RESOLUTIONS, '720p'),
    cameraMove: object('运镜', { move: choice('运镜：左/右环绕、推近、拉远、升/降镜、左/右跟拍、左/右弧线、变焦推/拉、希区柯克', ['orbit_left','orbit_right','push_in','pull_out','crane_up','crane_down','track_left','track_right','arc_left','arc_right','zoom_in','zoom_out','dolly_zoom']), speed: choice('运镜速度', ['slow','medium','fast']), shot: choice('远景/中景/近景', ['wide','medium','close']) }),
    firstFrameUrl: text('真实首帧地址；i2v 和 firstlast 必需'), lastFrameUrl: text('真实尾帧地址；firstlast 必需'),
  }),
} satisfies Record<keyof ArtifactGenerationConfig, WorkflowProperty>;
const surface = {
  enabled: flag('是否展示确认界面', true), selection: choice('无需选择/单选/多选', ['none','single','multiple'], 'none'), selectionRequired: flag('必须选择后继续；无需选择时必须关闭', false),
  feedbackEnabled: flag('允许填写调整意见', true), feedbackRequired: flag('反馈必填；需先允许反馈', false), allowRegenerate: flag('允许重新生成', true), continueLabel: text('继续按钮文案，默认确认并继续'),
};
const confirmation = object('完成后确认；删除整个 confirmation 关闭确认，保留配置则开启。只控制暂停与交互，不交付产物。对话与画布使用同一套规则', {
  ...surface, title: text('确认标题'), mode: { ...choice('系统维护的确认模式', ['continue']), readonly: true },
  artifactKind: { ...choice('历史结果类型；新确认固定 text', ['text','page','image','video']), readonly: true }, materializeOnConfirm: { ...flag('历史字段；新确认为 false，产物由产物卡交付', false), readonly: true },
  chat: { ...object('对话投影，系统根据父级规则同步', surface), readonly: true }, canvas: { ...object('画布投影，系统根据父级规则同步', surface), readonly: true },
});
export const WORKFLOW_NODE_PROPERTIES: Record<string, Record<string, WorkflowProperty>> = {
  start: { startConfig: object('开始：整个工作流的名称、适用场景和输入策略', {
    workflowName: text('工作流名称，自动同步顶部名称及场景说明'), description: text('适用目的与最终交付'), triggerScenarios: strings('适用场景/用户可能提出的诉求'), includeProjectContext: flag('运行时是否加入当前项目上下文', true), workflowMarkdown: text('完整场景说明 WORKFLOW.md；包含元信息和正文。修改此字段时不同时修改其他元信息'),
  }) },
  clarify: { clarificationConfig: object('询问：补齐信息，不产生最终产物', {
    mode: choice('AI 填写/逐题配置', ['auto','configured'], 'auto'),
    autoConfig: object('AI 自动提问规则；仅 auto 模式生效', { instruction: text('询问边界，只问确实缺失的信息'), maxQuestions: { ...number('最多问题数，允许实际少问', 1, 5), default: 3 }, allowedTypes: list('允许的题型，至少一种', choice('纯输入/单选/多选', ['text','single','multiple'])) }),
    questions: list('手动问题列表；仅 configured 模式生效，按稳定 id 编辑单题，默认一题', object('问题', {
      id: text('稳定题目 ID'), titleMode: choice('手写标题/AI生成标题', ['manual','ai'], 'manual'), title: text('手写题目，manual 时填写'), titleDirection: text('AI 出题方向，ai 时填写'), type: choice('题型', ['text','single','multiple'], 'text'), optionDirection: text('选项生成方向，仅单选/多选生效'), required: flag('必填', false), allowOther: flag('允许补充其他答案', false),
    })), title: text('表单标题'), description: text('表单说明'), submitLabel: text('提交按钮文案'), attachmentsEnabled: flag('允许附加材料', false),
  }) },
  agent: { agentConfig: object('执行：负责生成内容、调用能力；下游产物设置自动注入本步', {
    agentId: { ...text('继承启动 Agent，不主动修改'), readonly: true }, modelId: { ...text('继承启动模型，不主动修改'), readonly: true }, systemPrompt: text('执行说明：目标、输入、方法、输出要求和禁止项'), skillIds: strings('已有 Skill ID；本次不主动查找或新增'), knowledgeIds: strings('已有知识文件引用，不能编造 ID'), confirmation,
    outputContract: object('解析格式；数量和业务要求写入 systemPrompt，旧规则只保留兼容', { format: choice('正文 Markdown / 结构化 JSON items', ['markdown','json']), minItems: { ...number('旧最少数量'), readonly: true }, maxItems: { ...number('旧最多数量'), readonly: true }, requiredFields: { ...strings('旧必需字段'), readonly: true }, requiredText: { ...strings('旧必含正文'), readonly: true }, forbiddenText: { ...strings('旧禁含正文'), readonly: true }, instructions: { ...text('旧输出要求'), readonly: true } }),
  }) },
  branch: { branchConfig: object('判断：根据条件选择一路，不能代表用户审批', { instruction: text('判断依据与方法'), routes: list('路线列表；单卡可改标签与条件，不得增删或改路线 ID', object('路线', { id: text('稳定路线 ID，与连线端口对应'), label: text('路线名称'), condition: text('进入此路线的具体条件') })), defaultRouteId: text('兜底路线 ID，必须对应已连接路线') }) },
  delivery: { deliveryConfig: object('产物：接收上游真实内容并写入画布，生成参数自动传给上游执行卡', { artifactKind: choice('产物类型', ['text','page','presentation','image','video'], 'text'), artifactName: text('产物名称，留空由内容自动命名'), requirements: text('交付用途、受众、约束等要求'), ...ARTIFACT_PROPERTY_SCHEMAS }) },
  review: { reviewConfig: confirmation },
};
const common = { title: text('卡片标题'), description: text('本步任务描述'), inputReferences: strings('额外输入卡片 ID，只能引用上游非开始卡片；不改变连线') };
export function workflowNodeProperties(kind: string): Record<string, WorkflowProperty> { return { ...common, ...WORKFLOW_NODE_PROPERTIES[kind] }; }
export function workflowPropertyAt(kind: string, path: readonly string[]): WorkflowProperty {
  let schema = object('卡片', workflowNodeProperties(kind));
  for (const key of path) {
    if (['__proto__','prototype','constructor'].includes(key)) throw new Error('非法配置路径');
    const next = schema.type === 'array' ? schema.items : schema.properties?.[key];
    if (!next || (schema.type === 'array' && !/^(0|[1-9]\d*)$/.test(key))) throw new Error(`不支持的配置项：${path.join('.')}`);
    if (schema.readonly || next.readonly) throw new Error(`该配置由系统维护：${path.join('.')}`);
    schema = next;
  }
  return schema;
}
export function validateWorkflowProperty(value: unknown, schema: WorkflowProperty, path: string): void {
  const fail = (reason: string): never => { throw new Error(`${path}（${schema.description}）：${reason}`); };
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('必须是列表');
    (value as unknown[]).forEach((v,i) => validateWorkflowProperty(v, schema.items!, `${path}.${i}`));
  } else if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('必须是配置对象');
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const child = schema.properties?.[key];
      if (!child || ['__proto__','prototype','constructor'].includes(key)) fail(`不存在配置项 ${key}`);
      if (v === undefined) continue;
      validateWorkflowProperty(v, child!, `${path}.${key}`);
    }
  } else {
    if (typeof value !== schema.type) fail(`必须是 ${schema.type}`);
    if (schema.values && !schema.values.includes(value as string | number)) fail(`允许值：${schema.values.join('、')}`);
    if (schema.type === 'number' && (!Number.isFinite(value) || (schema.integer && !Number.isInteger(value)) || (schema.min !== undefined && (value as number) < schema.min) || (schema.max !== undefined && (value as number) > schema.max))) fail('数值超出允许范围');
  }
}
