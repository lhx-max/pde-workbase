import { parseDocument, stringify } from "yaml";
import type { ExecutionSnapshot } from './execution-snapshot.js';

/** Request-only credentials; never part of a persisted Hook definition or event. */
export interface HookExecutionRequest { execution?: ExecutionSnapshot }
export interface HookCompileRequest extends HookExecutionRequest {
  prompt: string;
  model?: HookConfig['action']['model'];
}
export interface HookTestRequest extends HookExecutionRequest {
  assetId?: string;
  data?: Record<string, unknown>;
}
export type HookEmitRequest = HookEvent & HookExecutionRequest;

export interface AssetAnalysisStatus {
  status: 'idle' | 'queued' | 'running' | 'ready' | 'failed';
  error?: string | undefined;
  version?: string | undefined;
  paused?: boolean;
  queue?: { concurrency: number; queued: number; running: number; failed: number };
}

export type HookConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "in"
  | "exists";

export interface HookCondition {
  field: string;
  operator: HookConditionOperator;
  value?: string | string[];
}

export interface HookConfig {
  version: 1;
  name: string;
  enabled: boolean;
  trigger: { event: string; conditions: HookCondition[] };
  action: {
    type: "ai" | "asset_metadata";
    instruction: string;
    /** Both empty: follow the current Agent and its saved defaults at execution.
     * A model override belongs to an explicitly selected Agent. */
    model: { agentId: string; modelId: string };
  };
  scope: { spaceIds: string[] };
  policy: { retries: number };
}

export interface HookDefinition extends HookConfig {
  id: string;
  revision: number;
  updatedAt: number;
}

export interface HookEvent {
  id: string;
  name: string;
  assetId?: string | undefined;
  versionId?: string | undefined;
  spaceId?: string | undefined;
  assetType?: string | undefined;
  data?: Record<string, unknown>;
}

export interface HookRun {
  id: string;
  hookId: string;
  hookName: string;
  event: HookEvent;
  status: "queued" | "running" | "succeeded" | "failed";
  attempt: number;
  createdAt: number;
  finishedAt?: number | undefined;
  output?: string;
  error?: string | undefined;
  test: boolean;
}

export interface HookCatalogField {
  id: string;
  label: { zh: string; en: string };
  operators: HookConditionOperator[];
  options?: Array<{ value: string; label: { zh: string; en: string } }>;
}

export interface HookCatalogTrigger {
  event: string;
  group: "assets" | "external";
  label: { zh: string; en: string };
  description: { zh: string; en: string };
  supportsSpaceScope: boolean;
  fields: HookCatalogField[];
  custom?: boolean;
}

export interface HookCatalogAction {
  type: HookConfig["action"]["type"];
  label: { zh: string; en: string };
  description: { zh: string; en: string };
  eventGroups?: HookCatalogTrigger["group"][];
}

export interface HookCatalog {
  triggers: HookCatalogTrigger[];
  actions: HookCatalogAction[];
}

const assetTypeField: HookCatalogField = {
  id: "assetType",
  label: { zh: "内容类型", en: "Content type" },
  operators: ["in", "equals", "not_equals"],
  options: ([
    ["image", "图片", "Image"],
    ["video", "视频", "Video"],
    ["audio", "音频", "Audio"],
    ["text", "文本", "Text"],
    ["script", "脚本", "Script"],
    ["slides", "幻灯片", "Slides"],
    ["webpage", "网页", "Web page"],
    ["motion", "动效", "Motion"],
    ["file", "文件", "File"],
  ] as Array<[string, string, string]>).map(([value, zh, en]) => ({
    value,
    label: { zh, en },
  })),
};

export const DEFAULT_HOOK_CATALOG: HookCatalog = {
  triggers: [
    {
      event: "asset.created",
      group: "assets",
      label: { zh: "新增内容时", en: "Content added" },
      description: { zh: "内容保存到任一空间后触发", en: "Runs after content is saved to a space" },
      supportsSpaceScope: true,
      fields: [assetTypeField],
    },
    {
      event: "asset.versioned",
      group: "assets",
      label: { zh: "内容发生变化时", en: "Content changed" },
      description: { zh: "内容保存了新版本后触发", en: "Runs after a new content version is saved" },
      supportsSpaceScope: true,
      fields: [assetTypeField],
    },
    {
      event: "asset.updated",
      group: "assets",
      label: { zh: "内容信息修改时", en: "Content details changed" },
      description: { zh: "名称、标签或描述等信息变化后触发", en: "Runs after content details change" },
      supportsSpaceScope: true,
      fields: [assetTypeField],
    },
    {
      event: "asset.analysis_requested",
      group: "assets",
      label: { zh: "请求 AI 填写时", en: "AI analysis requested" },
      description: { zh: "用户保存内容并勾选 AI 填写后触发", en: "Runs when AI-assisted details are requested" },
      supportsSpaceScope: true,
      fields: [assetTypeField],
    },
    {
      event: "custom.event",
      group: "external",
      label: { zh: "其他情况", en: "Something else" },
      description: { zh: "用一句话描述，由 AI 判断并生成触发规则", en: "Describe it in your own words and let AI create the trigger" },
      supportsSpaceScope: true,
      fields: [
        { id: "data.source", label: { zh: "来源", en: "Source" }, operators: ["equals", "not_equals", "contains", "exists"] },
        { id: "data.status", label: { zh: "状态", en: "Status" }, operators: ["equals", "not_equals", "contains", "exists"] },
      ],
      custom: true,
    },
  ],
  actions: [
    {
      type: "ai",
      label: { zh: "交给 AI 处理", en: "Ask AI to handle it" },
      description: { zh: "结果保存在运行记录中", en: "Keeps the result in run history" },
    },
    {
      type: "asset_metadata",
      label: { zh: "补全内容信息", en: "Fill content details" },
      description: { zh: "只填写内容中仍为空的信息", en: "Fills only empty content details" },
      eventGroups: ["assets"],
    },
  ],
};

export const DEFAULT_ASSET_HOOK_ID = "asset-metadata-analysis";

export const newHookConfig = (): HookConfig => ({
  version: 1,
  name: "",
  enabled: false,
  trigger: { event: "asset.created", conditions: [] },
  action: {
    type: "ai",
    instruction: "",
    model: { agentId: "", modelId: "" },
  },
  scope: { spaceIds: [] },
  policy: { retries: 1 },
});

export const hookConfigYaml = (value: HookConfig): string => stringify(value);

export function parseHookYaml(source: string): HookConfig {
  if (source.length > 40000) throw new Error("YAML 最多 40000 字");
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(`YAML 格式错误：${doc.errors[0]?.message}`);
  return parseHookConfig(doc.toJS({ maxAliasCount: 0 }));
}

function legacyHookConfig(v: Record<string, unknown>): unknown {
  if (!("event" in v || "prompt" in v || "spaces" in v || typeof v.action === "string")) return v;
  const assetTypes = Array.isArray(v.assetTypes) ? v.assetTypes : [];
  return {
    version: 1,
    name: v.name,
    enabled: v.enabled,
    trigger: {
      event: v.event,
      conditions: assetTypes.length ? [{ field: "assetType", operator: "in", value: assetTypes }] : [],
    },
    action: { type: v.action, instruction: v.prompt, model: v.model },
    scope: { spaceIds: Array.isArray(v.spaces) ? v.spaces : [] },
    policy: { retries: v.retries },
  };
}

export function parseHookConfig(input: unknown): HookConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Hook 配置必须是对象");
  const value = legacyHookConfig(input as Record<string, unknown>);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Hook 配置必须是对象");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => !["version", "name", "enabled", "trigger", "action", "scope", "policy"].includes(key))) throw new Error("配置包含不支持的字段");
  if (v.version !== 1) throw new Error("Hook 配置版本无效");
  const text = (inputValue: unknown, key: string, max: number) => {
    if (typeof inputValue !== "string" || !inputValue.trim() || inputValue.length > max) throw new Error(`${key} 不能为空且最多 ${max} 字`);
    return inputValue.trim();
  };
  const textList = (inputValue: unknown, key: string) => {
    if (!Array.isArray(inputValue) || inputValue.length > 100 || inputValue.some((item) => typeof item !== "string" || !item.trim() || item.length > 160)) throw new Error(`${key} 必须是文本列表`);
    return [...new Set(inputValue.map((item) => item.trim()))];
  };
  if (typeof v.enabled !== "boolean") throw new Error("enabled 必须是布尔值");

  const trigger = v.trigger as Record<string, unknown>;
  if (!trigger || typeof trigger !== "object" || Array.isArray(trigger) || Object.keys(trigger).some((key) => !["event", "conditions"].includes(key))) throw new Error("触发器配置无效");
  const event = text(trigger.event, "event", 100);
  if (!/^[a-z][a-z0-9_.-]*$/.test(event)) throw new Error("事件名称使用英文、数字、点、横线或下划线");
  if (!Array.isArray(trigger.conditions) || trigger.conditions.length > 20) throw new Error("条件最多 20 条");
  const conditions = trigger.conditions.map((raw, index): HookCondition => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`第 ${index + 1} 条条件无效`);
    const condition = raw as Record<string, unknown>;
    if (Object.keys(condition).some((key) => !["field", "operator", "value"].includes(key))) throw new Error(`第 ${index + 1} 条条件包含不支持的字段`);
    const field = text(condition.field, "condition.field", 120);
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(field)) throw new Error("条件字段格式无效");
    if (!["equals", "not_equals", "contains", "in", "exists"].includes(String(condition.operator))) throw new Error("条件运算符无效");
    const operator = condition.operator as HookConditionOperator;
    if (operator === "exists") return { field, operator };
    const conditionValue = Array.isArray(condition.value) ? textList(condition.value, "condition.value") : text(condition.value, "condition.value", 1000);
    return { field, operator, value: conditionValue };
  });

  const action = v.action as Record<string, unknown>;
  if (!action || typeof action !== "object" || Array.isArray(action) || Object.keys(action).some((key) => !["type", "instruction", "model"].includes(key))) throw new Error("动作配置无效");
  if (action.type !== "ai" && action.type !== "asset_metadata") throw new Error("action.type 必须是 ai 或 asset_metadata");
  const model = action.model as Record<string, unknown>;
  if (!model || typeof model !== "object" || Array.isArray(model) || Object.keys(model).some((key) => !["agentId", "modelId"].includes(key)) || typeof model.agentId !== "string" || typeof model.modelId !== "string" || model.agentId.length > 80 || model.modelId.length > 200) throw new Error("模型配置无效");
  // Installed runtimes and local profiles are resolved by the daemon. The wire
  // contract must not keep a separate, stale list of four CLI implementations.
  if (model.agentId && !/^[a-zA-Z0-9][\w.-]*$/.test(model.agentId)) throw new Error('Agent 标识无效');
  if (!model.agentId.trim() && model.modelId.trim()) throw new Error('指定模型时必须选择所属 Agent');

  const scope = v.scope as Record<string, unknown>;
  if (!scope || typeof scope !== "object" || Array.isArray(scope) || Object.keys(scope).some((key) => key !== "spaceIds")) throw new Error("范围配置无效");
  const policy = v.policy as Record<string, unknown>;
  if (!policy || typeof policy !== "object" || Array.isArray(policy) || Object.keys(policy).some((key) => key !== "retries") || !Number.isInteger(policy.retries) || Number(policy.retries) < 0 || Number(policy.retries) > 3) throw new Error("重试次数为 0–3");

  return {
    version: 1,
    name: text(v.name, "name", 120),
    enabled: v.enabled,
    trigger: { event, conditions },
    action: {
      type: action.type,
      instruction: text(action.instruction, "instruction", 12000),
      model: { agentId: model.agentId.trim(), modelId: model.modelId.trim() },
    },
    scope: { spaceIds: textList(scope.spaceIds, "scope.spaceIds") },
    policy: { retries: Number(policy.retries) },
  };
}
