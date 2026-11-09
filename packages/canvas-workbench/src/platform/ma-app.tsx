'use client';

/**
 * MA 宿主会话应用的 App 侧挂载包装层。
 *
 * 宿主按已发布合同传入 props：`{ context, fileClient, conversation }`
 * （providerClient 在 SDK 类型中可选、宿主实际未传）。本包装层只消费
 * context——fileClient / conversation / providerClient 原样忽略，
 * 不发明 SDK 钩子，不要求宿主新增保存或 transport 参数。
 *
 * 打开语义：providerInstanceId 不是画布 projectId。服务端真实映射是
 * canvasProviderProjectId = ma-sha256(['canvas', tenant, applicationId, pid]).slice(0,32)，
 * 浏览器侧无法重算——挂载前只发一次带认证信封的 Provider `canvas.read`
 * 只读动作（未登记实例服务端回 PROVIDER_INSTANCE_NOT_FOUND，该路由没有
 * 创建语义），用响应里核验过的 data.canvasInstanceId 作为 projectId。
 * 404/401/403 或映射校验失败都渲染明确的不可用提示，绝不调用
 * create / register / MA 管理接口，也不会假装成功。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';

import { CanvasWorkbenchSurface } from '../CanvasWorkbenchSurface';
import type { CanvasWorkbenchSurfaceProps } from '../CanvasWorkbenchSurface';
import type { CanvasTransport } from './api-base';
import { createMaCanvasTransport } from './ma-transport';
import type { CanvasUiHost } from './ui-host';
import {
  CanvasAppError,
  canvasAppScopeKey,
  canvasAppUnavailableMessage,
  canvasProviderActionPath,
  canvasReadEnvelope,
  newCanvasAppRequestId,
  parseCanvasReadResponse,
  preflightFailureCode,
  sanitizePreflightError,
  validateCanvasAppContext,
  type CanvasAppContext,
  type CanvasAppUnavailableCode,
} from './ma-context';

const CREDENTIAL_FORMAT = /^Bearer [A-Za-z0-9\-._~+/]+=*$/i;

/** 宿主发布合同中的组件 props。context 之外的字段本适配层一律不读。 */
export interface CanvasAppProps {
  context?: unknown;
  fileClient?: unknown;
  conversation?: unknown;
  providerClient?: unknown;
}

/** 允许宿主接入的既有画布回调；全部可选，缺失时对应能力自然不可用。 */
export type CanvasAppSurfaceCallbacks = Partial<Pick<
  CanvasWorkbenchSurfaceProps,
  | 'onSubmitAgentTask'
  | 'onStageChatAttachments'
  | 'onStageCanvasObject'
  | 'readHostConversation'
  | 'onNavigate'
  | 'onOpenArtifact'
  | 'onOpenTextDocument'
  | 'onInteractionActiveChange'
  | 'onDocumentsDrop'
>>;

export interface CreateCanvasAppOptions {
  /**
   * App API 入口的显式完整地址（允许含部署前缀，如函数网关路径）。
   * 校验沿用 createMaCanvasTransport：仅 http/https；http 仅限 loopback；
   * 不得带用户名/密码/query/hash。
   */
  baseUrl: string;
  /**
   * 宿主 SDK 的凭据 getter。每个 HTTP 请求都会用当前 context 现取一次，
   * 不缓存、不全局共享；返回值必须是 `Bearer <token>` 形状，否则该请求
   * 判 CREDENTIAL_UNAVAILABLE。getter 抛错不会把原始 cause 透出到 UI。
   */
  getCredential: (context: CanvasAppContext) => string | Promise<string>;
  /** 画布外壳 UI 原语（Popover/Dialog/Menu/Tabs 等），沿用既有宿主合同。 */
  uiHost: CanvasUiHost;
  /** 可注入的 fetch（测试、网关签名代理）；缺省用全局 fetch。 */
  fetcher?: typeof fetch;
  /**
   * 浏览器 img/frame 导航无法携带凭据头，宿主必须提供受认证的资源地址桥
   * （签名 URL / cookie 代理地址）。缺失时画布整体报 RESOURCE_URL_UNAVAILABLE
   * ——绝不把凭据拼进 URL。
   */
  resourceUrl?: (url: string, context: CanvasAppContext) => string;
  /** 既有画布回调子集；只有宿主确实需要时才配置。 */
  surface?: CanvasAppSurfaceCallbacks;
  /** 可替换的不可用提示渲染；缺省用内置 role="alert" 提示。 */
  renderUnavailable?: (status: { code: CanvasAppUnavailableCode; message: string; locale: string | null }) => ReactNode;
  /** 可替换的载入中渲染；缺省用内置 role="status" 提示。 */
  renderLoading?: (status: { locale: string | null }) => ReactNode;
}

type Phase =
  | { scope: string; status: 'checking' }
  | { scope: string; status: 'ready'; projectId: string }
  | { scope: string; status: 'unavailable'; code: CanvasAppUnavailableCode };

function DefaultUnavailable({ code, locale }: { code: CanvasAppUnavailableCode; locale: string | null }) {
  const message = canvasAppUnavailableMessage(code, locale);
  return (
    <div role="alert" data-canvas-app-unavailable={code} style={{ padding: 24, fontSize: 14 }}>
      <strong style={{ display: 'block', marginBottom: 8 }}>{message}</strong>
      <code style={{ fontSize: 12, opacity: 0.6 }}>{code}</code>
    </div>
  );
}

function DefaultLoading({ locale }: { locale: string | null }) {
  return (
    <div role="status" style={{ padding: 24, fontSize: 14 }}>
      {locale && locale.toLowerCase().startsWith('en') ? 'Opening canvas…' : '正在打开画布…'}
    </div>
  );
}

/**
 * 生成一个可由 MA 宿主登记的 React 组件。所有宿主/环境差异都收敛到
 * options 闭包；返回组件只接收发布合同 props，不再接受额外注入。
 */
export function createCanvasApp(options: CreateCanvasAppOptions): ComponentType<CanvasAppProps> {
  function CanvasApp(props: CanvasAppProps) {
    const { context: rawContext } = props;
    // fileClient / conversation / providerClient 按发布合同接收但刻意忽略。

    // Hosts may reuse and mutate context objects; inspect field values on every render.
    const validation = validateCanvasAppContext(rawContext);
    const context = validation.ok ? validation.context : null;
    // 凭据 getter / 资源桥始终读到“当前”context；scope 之外的字段
    // （sessionId、locale）变化不重建 transport。
    const contextRef = useRef<CanvasAppContext | null>(null);
    contextRef.current = context;

    const scope = context ? canvasAppScopeKey(context, options.baseUrl) : '';

    const transport = useMemo<CanvasTransport | null>(() => {
      if (!context) return null;
      try {
        return createMaCanvasTransport({
          baseUrl: options.baseUrl,
          tenantId: context.actor.tenantId,
          applicationInstanceId: context.applicationInstanceId,
          getCredential: async () => {
            const current = contextRef.current;
            if (!current||canvasAppScopeKey(current,options.baseUrl)!==scope) throw new CanvasAppError('CONTEXT_INVALID', 'MA scope is no longer active');
            let credential: string;
            try {
              credential = await options.getCredential(current);
              if(!contextRef.current||canvasAppScopeKey(contextRef.current,options.baseUrl)!==scope)throw new CanvasAppError('CONTEXT_INVALID','MA scope changed during credential lookup');
            } catch {
              throw new CanvasAppError('CREDENTIAL_UNAVAILABLE', 'MA SDK credential unavailable');
            }
            if (!CREDENTIAL_FORMAT.test(credential)) {
              throw new CanvasAppError('CREDENTIAL_UNAVAILABLE', 'MA SDK credential unavailable');
            }
            return credential;
          },
          ...(options.fetcher ? { fetcher: options.fetcher } : {}),
          resourceUrl: (url) => {
            const current = contextRef.current;
            const bridge = options.resourceUrl;
            if (!current||canvasAppScopeKey(current,options.baseUrl)!==scope||!bridge)throw new CanvasAppError('CONTEXT_INVALID','MA resource scope is no longer active');
            return bridge(url, current);
          },
        });
      } catch {
        // baseUrl 未过 transport 自身的安全校验——配置错误，报不可用而不是抛出。
        return null;
      }
      // 只在真实 scope 变化时重建；context 对象等价但换引用不重置。
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope]);

    const configCode: CanvasAppUnavailableCode | null =
      !context ? 'CONTEXT_INVALID'
        : !transport ? 'CONFIGURATION_INVALID'
          : !options.resourceUrl ? 'RESOURCE_URL_UNAVAILABLE'
            : null;

    // 渲染时对 scope 不匹配显示 loading，effect 负责新预检，避免旧画布闪现。
    const [phase, setPhase] = useState<Phase>({ scope, status: 'checking' });

    useEffect(() => {
      if (!context || !transport || configCode) return;
      const currentScope = scope;
      setPhase({scope:currentScope,status:'checking'});
      const controller = new AbortController();
      const fail = (code: CanvasAppUnavailableCode) => {
        setPhase((prev) => (prev.scope === currentScope ? { scope: currentScope, status: 'unavailable', code } : prev));
      };
      // 只读预检：canvas.read 打开 providerInstanceId 对应的既有实例并拿回
      // 服务端持久映射的 canvasInstanceId。该动作对不存在实例回 404，
      // 没有创建语义；其余任何 Provider 动作都不在打开路径上。
      const apiRoot = options.baseUrl.replace(/\/+$/, '');
      void transport.fetch?.(`${apiRoot}${canvasProviderActionPath(context.providerInstanceId, 'canvas.read')}`, {
        method: 'POST',
        signal: controller.signal,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(canvasReadEnvelope(context, newCanvasAppRequestId())),
      })
        .then(async (res) => {
          if (controller.signal.aborted) return;
          if (!res.ok) {
            fail(preflightFailureCode(res.status));
            return;
          }
          let body: unknown = null;
          try {
            body = await res.json();
          } catch {
            body = null;
          }
          if (controller.signal.aborted) return;
          const projectId = parseCanvasReadResponse(body, context.providerInstanceId);
          setPhase((prev) =>
            prev.scope === currentScope
              ? projectId
                ? { scope: currentScope, status: 'ready', projectId }
                : { scope: currentScope, status: 'unavailable', code: 'SERVICE_UNAVAILABLE' }
              : prev);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          fail(sanitizePreflightError(error));
        });
      return () => controller.abort();
      // context / transport / configCode 均由 scope 派生；只随真实 scope 重跑。
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope]);

    const locale = context?.locale ?? null;
    if (configCode) {
      return options.renderUnavailable
        ? <>{options.renderUnavailable({ code: configCode, message: canvasAppUnavailableMessage(configCode, locale), locale })}</>
        : <DefaultUnavailable code={configCode} locale={locale} />;
    }
    if (phase.scope !== scope || phase.status === 'checking') {
      return options.renderLoading ? <>{options.renderLoading({ locale })}</> : <DefaultLoading locale={locale} />;
    }
    if (phase.status === 'unavailable' || !context || !transport) {
      const code = phase.status === 'unavailable' ? phase.code : 'SERVICE_UNAVAILABLE';
      return options.renderUnavailable
        ? <>{options.renderUnavailable({ code, message: canvasAppUnavailableMessage(code, locale), locale })}</>
        : <DefaultUnavailable code={code} locale={locale} />;
    }
    return (
      <CanvasWorkbenchSurface
        {...options.surface}
        key={scope}
        projectId={phase.projectId}
        transport={transport}
        uiHost={options.uiHost}
        locale={locale}
      />
    );
  }
  CanvasApp.displayName = 'CanvasApp';
  return CanvasApp;
}
