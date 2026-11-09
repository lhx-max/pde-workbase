# Canvas Workspace ↔ 当前 DA 画布差异审计

> 比较基线：DA `133ee7ead5da741a954331fdf3664eaa32b83b54`，独立仓 `f89d7ab7f8caaa004e26582844f4c2c91ab41a13` 加本次未提交工作树变更。两仓均有其他未提交改动；不把工作树等同于部署版本。这里的 PASS 指本轮所列检查范围，不代表全部功能、生产部署或外部服务已经验收。

## 本轮已补齐的画布主链

- **共享操作契约**：独立仓增加 `packages/contracts/src/api/canvas-operations.ts`，支持普通未分组文字／图片／网页与演示文稿节点、引用边及撤销的公开操作协议。它继承 DA 的受限边界，**不是八类节点所有 UI 动作的通用 API**。
- **服务端**：`apps/server/src/routes/canvas.ts` 增加 capabilities、操作提交与回执查询；`apps/server/src/canvas/state.ts` 保存幂等 operation ID、revision、回执，并保留旧 PATCH、媒体／候选／工作流写入和未来字段。冲突、跨项目回执、Origin 与只读权限有独立测试。旧画布首写迁移为单调持久 revision；损坏状态拒绝覆盖。
- **前端**：`packages/canvas-workbench/src/platform/canvas-compat.tsx` 将可完整映射的乐观 UI 改动优先发到 operations，无法完整表达的仍走旧 PATCH；同请求重试保留 operation ID，检查回执，未确认草稿限频保存并在成功后清理。`canvas-operation-batch.ts` 的拒绝映射规则避免截断未知业务字段。
- **图片资产**：独立服务器把内建资产库适配器注入画布服务。真实 HTTP 测试覆盖指定版本的图片附加、来源绑定、使用记录、幂等重放及只读项目拒写。

## 能力对照

| 功能 | 当前判断 | 证据与边界 |
|---|---|---|
| 画布基础 UI、八类可创建节点、连线与分组 | 核心保留，非逐交互等价 | 两仓 `packages/canvas-workbench/src/workbench/canvas-node-catalog.ts` 都有 image/text/sketch/storyboard/video/clip/page/presentation；独立仓原 `Workbench.tsx` 与 DA 有大量差异。原生浏览器、所有节点×动作组合未在本轮穷举。 |
| 画布公开操作、状态、版本与回执 | 本轮补齐受支持范围 | DA `apps/daemon/src/routes/canvas.ts:24-51`；独立仓 `apps/server/src/routes/canvas.ts`、`apps/server/src/canvas/state.ts`、`packages/contracts/src/api/canvas-operations.ts`；`e2e/tests/canvas-operations-http.test.ts` 2/2 通过。旧状态 PATCH 仍保留。 |
| 旧编辑器/首个剪辑节点保存 | 浏览器主流程通过 | 首次空状态 PATCH 的 `[]` 基线不再与未设置字段虚假冲突；先红后绿回归 `apps/server/tests/canvas-empty-collection-patch.test.ts`，生产 Web `e2e/ui/workspace.test.ts` 2/2 通过。 |
| 画布本地图片资源 | 图片 operation 可用；并非所有来源 | `apps/server/tests/canvas-image-asset-http.test.ts` 验证内建资产库版本、来源 ID 和授权；外部资产适配器及所有格式未做真实验收。 |
| 文件、版本、资产库、剪辑、网页/PPT | 独立仓已有，局部本轮验证 | `apps/server/src/routes/files.ts`、`routes/asset-library.ts`、`apps/web/src/components/FileWorkspace.tsx`；生产 Web 画布/工作区/素材选择所选 11 场景最终 11/11 通过（在空状态 PATCH 修复后复跑失败的工作区场景 2/2）。不代表全部文件格式或原生权限通过。 |
| Agent、媒体、工作流和产物 | 可接入但不等价 | 独立仓 `apps/server/src/services-tasks.ts`、`routes/tasks.ts`、`routes/media.ts`、`routes/workflows.ts`；外部真实 Agent、媒体供应商和 MF 云端身份/模型依赖适配器与授权。DA 原主对话、账号／团队平台有意未搬入。不能把离线或本地适配器验收当线上生成成功。 |
| DA 专有业务与预览 | 仍有差异 | DA 中 safety-gr/ordinary-glow、业务专属配图、`ReadonlyCanvasSurface` 等未按原样进入独立仓。这些是有意裁剪或需宿主适配，不在“画布公开操作”补齐范围内。 |
| 独立运行与多实例 | 已分 Web/Server 进程；未完成部署证明 | 独立仓 `apps/web/src/server/proxy.ts` 在运行时配置后端，`tools/dev/src/cli.ts` 分别起 Web/Server。尚未验证两边独立发布/回滚；画布存储锁仍限单服务进程，多实例共享同一数据根不保证安全。 |

## 实测与未验

本轮 Node 24 本地结果：`pnpm guard` 通过；全工作区 `pnpm typecheck` 通过；`@canvas/server` 41 个文件、425 项测试通过；`@bezier/canvas-workbench` 20 个文件、220 项测试通过；contracts、server、生产 Web 构建通过；画布公开操作 HTTP 用例 2/2 通过；生产 Web 所选画布节点、素材和工作区 11/11 通过（其中工作区 2/2 为修复后重跑）。这些结果只覆盖对应本地流程，不是生产部署或全面无 Bug 证明。

仍需单独验收：DA 专有业务节点与其宿主权限、真实 MF 云端登录／模型授权、原生浏览器及扩展人工确认、外部媒体供应商、多服务实例共享存储、独立发布与回滚，以及两仓数据迁移／项目身份映射。若目标扩至“与 DA 所有画布 UI 功能逐项一致”，需依 `Workbench.tsx` 等差异逐功能验收，而不能只凭 API 接通宣称完成。
