import type { ComponentType } from 'react';
import type { MaApplicationManifest } from '@bezier/contracts';

/** Session Apps 挂载类型（源自 design-ai-client-integration 的
 * ma-v/session-apps/types.ts，按本仓裁剪：无 plugin-kit SDK 与账号体系，
 * context 仅保留本地联调 SOP 使用的实例上下文）。 */

export type SessionAppContext = {
  actor: { userId: string };
  sessionId: string;
  applicationInstanceId: string;
};

export type SessionAppComponentProps = {
  context?: SessionAppContext | null;
};

export type SessionAppRegistryEntry = {
  manifest: MaApplicationManifest;
  component: ComponentType<SessionAppComponentProps>;
};
