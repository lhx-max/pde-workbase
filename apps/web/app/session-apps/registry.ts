import type { SessionAppRegistryEntry } from './types';
import { notesInstallation } from './notes-example/installation';

/** 本地开发 App 注册表（源自参考仓 ma-v/session-apps/registry.ts；
 * 本仓不搬 plugin-kit 与 EVA 内置项，仅保留 SOP 的本地开发数组）。
 * 生产构建为空数组：未注册即显式不可见，不假成功。 */
export const localDevelopmentApps: readonly SessionAppRegistryEntry[] =
  process.env.NODE_ENV === 'development' ? [notesInstallation] : [];

export const sessionAppRegistry: Readonly<Record<string, SessionAppRegistryEntry>> = Object.fromEntries(
  localDevelopmentApps.map(entry => [entry.manifest.frontend.moduleId, entry]),
);
