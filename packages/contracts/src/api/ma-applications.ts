import { z } from 'zod';

/** Session Apps 应用接入契约（源自 design-ai-client-integration 仓库的
 * packages/contracts/src/api/ma-applications.ts；ID schema 在此内联，目标仓
 * 无 ma-sessions/ma-team-applications 依赖）。仅覆盖本地联调 SOP 使用的
 * Manifest、Provider 动作请求与目录登记结构，未引入对话或账号体系。 */

/** Appwrite 元数据会话标识，非 daemon 项目 ID。 */
export const maSessionIdSchema = z.string().regex(/^[A-Za-z0-9_]{1,36}$/u);
export const maApplicationInstanceIdSchema = z.string().regex(/^ai_[a-f0-9]{24}$/u);
export const maApplicationIdSchema = z.string().regex(/^app_[a-f0-9]{24}$/u);

const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const permission = z.string().regex(/^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/u).max(100);

export const maApplicationActionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u).max(100),
  title: z.string().trim().min(1).max(100), description: z.string().trim().min(1).max(500),
  effect: z.enum(['read', 'write']), inputSchema: z.record(z.string(), z.unknown()),
  confirmation: z.literal('required').optional(),
  requiredPermissions: z.array(permission).max(20),
}).strict();

export const maApplicationManifestSchema = z.object({
  schemaVersion: z.literal(1), slug: z.string().min(1).max(64), version: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(200), description: z.string().max(1000), icon: z.string().max(2048).optional(),
  instanceMode: z.enum(['single', 'multiple']),
  frontend: z.object({ moduleId: z.string().min(1).max(120), exportName: z.string().min(1).max(100) }).strict(),
  provider: z.object({ baseUrl: z.string().url().max(2048), protocolVersion: z.literal('1.0') }).strict(),
  permissions: z.array(permission).max(30), actions: z.array(maApplicationActionSchema).max(50),
}).strict();

export const maRegisterApplicationRequestSchema = z.object({ manifest: maApplicationManifestSchema }).strict();
export type MaRegisterApplicationRequest = z.infer<typeof maRegisterApplicationRequestSchema>;

export const maProviderActionRequestSchema = z.object({
  applicationInstanceId: maApplicationInstanceIdSchema, sessionId: maSessionIdSchema,
  actionId: z.string().min(1).max(100), expectedRevision: version.optional(), input: z.record(z.string(), z.unknown()),
}).strict();

export type MaApplicationManifest = z.infer<typeof maApplicationManifestSchema>;
export type MaApplicationAction = z.infer<typeof maApplicationActionSchema>;
export type MaProviderActionRequest = z.infer<typeof maProviderActionRequestSchema>;
