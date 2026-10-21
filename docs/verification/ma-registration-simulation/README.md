# MA-V 本地模拟登记

日期：2026-10-21。**登记数据为本地 fixture，未登记到云端；组件、Provider 和编辑器保存均为真实本地实现。**

## 运行

Node 24、仓库已有 pnpm/tsx。保持原 MA-V 宿主运行在 `127.0.0.1:18580`，文档 Provider 运行在 `127.0.0.1:19000`。本工具不启动或修改它们。

在画布仓库分别运行：

```sh
pnpm exec tsx apps/server/src/local-provider.ts --data-dir /Users/zhuzhiheng/Desktop/canvas-workspace/.tmp/ma-registration-simulation/canvas --port 17463
pnpm exec tsx scripts/ma-registration-simulator.ts --data-dir /Users/zhuzhiheng/Desktop/canvas-workspace/.tmp/ma-registration-simulation/directory
```

打开 `http://127.0.0.1:18581/?session=s_b9c4575a1ba14c66bb0080b3d2e6ea`。右上角 `+ → 管理` 可从目录创建画布/文档；创建后实例出现在原有标签页和菜单中。原 `18580` 页面保留真实云端登记行为。停止模拟代理不会修改云端应用目录、关联或标签。

## 实现边界

- 代理在原宿主之外，代码仅在画布仓库。使用已存在的 moduleId/exportName/version，不修改宿主、SDK、菜单或 Agent 调度。
- 模拟应用目录、实例创建、会话实例关联和标签持久化；后两项只存在指定本地数据根，不能将假的实例 ID 写入云端标签。
- 新实例初始化调用真实 Provider；画布组件通过同源 `/canvas-provider` 访问真实独立服务，文档组件沿其现有本地 Provider 地址访问。其余宿主请求透传，不记录登录凭据。
- 本次仅验当前登录用户的 Design Agent 个人空间；这是本地测试工具，不提供生产租户授权，不支持公开部署。
- 页面有显式“本地模拟登记”标记。模拟动作入口连接真实 Provider，但不证明远程 MA 模型具有可执行的工具通道。
- staging 仅复用组件、manifest 和 Provider 协议；代理/fixture 不部署。正式登记与正式认证仍需对接。

## 验证结果

- 两个应用、两个实例均通过目标宿主 `fa9475183` 中实际 `maApplicationSchema`、`maApplicationInstanceSchema` 校验（只读核对）。
- 从原管理页创建并打开两个真实组件；刷新后两个标签恢复。
- 在文档组件代码视图写入测试正文，通过真实 `doc.read` 读回相同正文和内容 hash；刷新后文档视图显示相同正文。测试内容仅写入新建的专用实例。
- 旧关联版本返回 409；外部 Origin 返回 403；不存在实例返回 404。
- 工具 TypeScript 检查通过。仓库 guard 未通过，当前报告为 MF React/ReactDOM 固定版本及两个 esbuild `.mjs` 兼容产物未登记；均不在本次修改范围。
- 全仓 `pnpm typecheck` 在现有 e2e 的 `extension-fixture`、`browser-fixture` 模块缺失处失败；本次工具及 canvas-surface 类型检查通过。
- [实际页面截图](apps-open.png)。尚未宣称 MA 自主工具调用通过。
