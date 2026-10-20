---
name: 画布卡片包开发
description: 画布 App 业务卡片（Card Pack）开发入口。Use when 用户要"开发画布卡片/卡片包/card pack/新建一种卡片/FDE 业务卡片/画布自定义节点/卡片挂载/卡片动作"或要在画布上加一种新的卡类型（商品卡/数据卡/业务卡等）。负责指引按契约 v1 产出可挂载卡片包；不负责通用画布引擎本身的开发（那是平台侧）、不替你定业务字段。
version: 1.0.0
---

# 画布卡片包开发

一句话：**卡片 = 一个 npm 包（TSX 渲染器 + 可选动作 handler），按 `card.<团队>.<名>` 命名挂载**。

**契约真源**：[`docs/canvas-card-pack.zh-CN.md`](../../../docs/canvas-card-pack.zh-CN.md)——本技能是操作指引，字段细节一律以契约文档为准，冲突时改契约不改技能。

## 开工前必读（按顺序）

1. `docs/canvas-card-pack.zh-CN.md` §1–§3：交付形态、命名规范、卡片数据协议
2. §11 平台待补清单：确认你要用的接缝平台已接上
3. 附录 A 示范卡：最小可用实现，照抄改名

## 铁律（违反 = 包被拒收）

- **信封归平台，内容归你**：`data` 黑盒随便写（JSON、≤256KB）；平台信封字段只读
- **改卡只走 `onPatch`**：不直接改画布 state、不 localStorage 偷渡、不 fetch 画布内部 `/api/*`
- **命名带前缀**：kind 和动作全部 `card.<你的团队>.<名>`，保留前缀列表见契约 §2
- **两种开发模式**：新建业务卡走 `card.<团队>.<名>`；改通用卡（text/image 等）直接注册核心 kind 的渲染器覆盖 + `ops` 里 `{handler, targets:'text'}` 声明动作目标——都是增量，不改平台代码
- **文件统一口**：`ctx.files`/`projectFilePath`，禁止自创存储
- **动作要幂等**：同输入同输出，去重平台管

## 技术环境速览（卡片开发视角）

仓级真源是根目录 `AGENTS.md`——布局、命令、安全规则以它为准，这里只挑卡片开发会撞到的：

| 环境 | 你的卡要遵守的 |
|---|---|
| **工具链** | Node 24 + pnpm 10.33.2（corepack 自选锁版本）；装包统一 `pnpm add` |
| **渲染宿主** | 卡片跑在 React Flow（xyflow）节点里——你写的是节点内容区组件，不是独立页面 |
| **React 版本** | 仓内组件约束 **React 18**；不要引入 React 19 专属 API（compiler、use()、新 ref 写法） |
| **语言** | 新代码全 TypeScript；不要新增 `.js/.mjs` 源文件（存量 .mjs 是构建产物） |
| **包结构** | 你的包进 `packages/canvas-pack-<业务>/`；渲染器挂 `canvas-workbench`；跨端共享类型进 `contracts`，不许前后端互相 import 私有实现 |
| **样式** | 用画布 CSS 变量（`--canvas-*`、`accent-*`、`status-*`），不写死颜色/字号；卡壳类名复用 `canvas-node/node-inner` 那套 |
| **数据路径** | 服务存储一律从显式 data root / 构造参数派生，禁止 cwd 推断、禁止引用上游仓路径 |
| **提交前必跑** | `pnpm install`（改了依赖）→ `pnpm guard` → `pnpm typecheck` → 包级测试（`pnpm --filter <包> test`），不准用根级 build/test 别名 |
| **测试位置** | 包级 `tests/` 目录（src 同级），src 里不放 `*.test.*`；UI 自动化归 `e2e/ui/` |

## 分支模型

| 分支 | 角色 | 谁能动 |
|---|---|---|
| `main` | 稳定主线 | 只收 MR，由仓库 Owner（zhuzhiheng）审 |
| `feat/zhuzhiheng-card-pack-base` | 卡片包共同开发基线 | FDE 从这里拉、MR 回这里 |
| `feat/card-pack-<团队>-<业务>` | 你的工作分支 | 你自己 |

**你的流程**：从 `feat/zhuzhiheng-card-pack-base` 拉 `feat/card-pack-<团队>-<业务>` → 干活 → MR 回 `feat/zhuzhiheng-card-pack-base` → Owner 审核合入。主干 `main` 由 Owner 定期从基线升级，FDE 不直接合 main。

## 开发流程

1. **建分支**：`feat/card-pack-<团队>-<业务>`，从 `feat/zhuzhiheng-card-pack-base` 拉
2. **建包**：`packages/canvas-pack-<业务>/`（或独立仓发 npm 包），结构见契约 §1
3. **写卡**：TSX 渲染器实现 `CardRenderProps`（node/selected/onPatch/onOpenFile）
4. **挂包（两处都要）**：
   - 前端渲染：`packages/canvas-workbench/src/packs.ts` 加一行 `import`/注册（一期构建期挂载）
   - 服务端注册：包必须再导出一个 **`/server` 入口**（`src/server.ts`，只含 `packId`/`name`/`cards[].kind`/`cards[].ops`，**不许 import React/TSX**），在 `apps/server/src/card-packs.ts` 挂载；参考 `@bezier/canvas-pack-demo/server`
   - ⚠️ **闸口**：`card.*` 卡种必须在服务端完成注册才能建卡——没挂 `/server` 入口的卡种会被 `CARD_KIND_NOT_ALLOWED` 拒掉（403）。`card_packs` 注册表会把挂载包镜像到 Appwrite，管理侧据此发现能力；`card_grants` 控制哪些团队/画布能用哪些卡（无授权行=默认全放开）
5. **本地验证**：

```bash
pnpm install
APPWRITE_ENDPOINT=... APPWRITE_PROJECT=grworkspace APPWRITE_DATABASE=canvas_app_dev \
APPWRITE_BUCKET=canvas_assets_v2 APPWRITE_SESSION_COOKIE=<问平台要> \
pnpm tools-dev run web --data-dir /tmp/<数据目录> --daemon-port 17460 --web-port 17580
# 浏览器 http://127.0.0.1:17580，node.create 建卡看渲染
```

6. **交付检查**（契约 §10 清单）：前缀、data 大小、memo 安全、幂等、README 三件套（建卡动作/data 字段表/动作清单）

## API / CLI 速查

### COI 门脸（验证卡片动作的标准入口）

不用 UI 也能测卡——直接打 HTTP：

```bash
# 1. 看能力清单（你的 card.* 动作注册后会出现在 actions 里）
curl http://127.0.0.1:17460/api/apps/canvas

# 2. 建画布实例（App 级动作，固定 actionId=canvas.create）
curl -X POST http://127.0.0.1:17460/api/apps/canvas/actions/canvas.create \
  -H 'content-type: application/json' \
  -d '{"input":{"instanceId":"my-test","name":"测试画布"}}'

# 3. 发动作建你的卡（node.create 通用动作即可）
curl -X POST http://127.0.0.1:17460/api/apps/canvas/instances/my-test/actions/node.create \
  -H 'content-type: application/json' -H 'idempotency-key: op-demo-1' \
  -d '{"input":{"node":{"id":"c1","kind":"card.acme.product","x":100,"y":100,
        "title":"商品卡","data":{"sku":"A1"}}}}'

# 4. 你的专属动作（注册后自动可调）
curl -X POST http://127.0.0.1:17460/api/apps/canvas/instances/my-test/actions/card.acme.product.refresh \
  -H 'content-type: application/json' -d '{"input":{"nodeId":"c1","params":{}}}'

# 5. 查状态 / 查凭条
curl http://127.0.0.1:17460/api/apps/canvas/instances/my-test/state
curl http://127.0.0.1:17460/api/apps/canvas/instances/my-test/action-receipts/op-demo-1
```

**规则**：响应统一 `{requestId, data}` 信封；错误 `{code: "CANVAS_*"}`；409 = 版本冲突（带 `expectedRevision` 重试）；`idempotency-key` 相同重复提交返回旧凭条。

### CLI / 服务起法

```bash
# 后端服务（数据走 Appwrite 就带上这 5 个环境变量）
APPWRITE_ENDPOINT=... APPWRITE_PROJECT=grworkspace APPWRITE_DATABASE=canvas_app_dev \
APPWRITE_BUCKET=canvas_assets_v2 APPWRITE_SESSION_COOKIE=<...> \
node apps/server/dist/cli.js --data-dir /tmp/<数据目录> --port 17460

# 全栈本地环境（推荐）：pnpm tools-dev run web --data-dir ... --daemon-port 17460 --web-port 17580
```

- `--data-dir` 必须显式绝对路径（仓规：禁止 cwd 推断）
- `CANVAS_AUTH_TOKEN` 可选，给服务加令牌鉴权
- 内部画布 API（`/api/projects/:id/canvas/*`）是实现细节，卡片开发统一走上面 COI 门

### 自助拿 Appwrite 会话（不用求人）

```bash
# 1. 注册测试账号（内网实例开放注册）
curl -X POST https://frontend-cloud.corp.kuaishou.com/v1/account \
  -H 'content-type: application/json' -H 'x-appwrite-project: grworkspace' \
  -d '{"userId":"unique()","email":"<你>@kuaishou.com","password":"<密码>","name":"dev"}'
# 2. 登录拿会话 cookie（X-Fallback-Cookies 头里的 a_session_grworkspace）
curl -X POST https://frontend-cloud.corp.kuaishou.com/v1/account/sessions/email \
  -H 'content-type: application/json' -H 'x-appwrite-project: grworkspace' \
  -d '{"email":"<你>@kuaishou.com","password":"<密码>"}' -D - -o /dev/null | grep Fallback
# 3. 起服务时：APPWRITE_SESSION_COOKIE='a_session_grworkspace=<上一步的值>'
```

## 常见坑

- **「我的卡渲染不出来」**：先查 kind 前缀对不对、`packs.ts` 挂没挂、数据里 `kind` 字段和注册名一不一致
- **「改了 data 画布没变」**：你绕开 `onPatch` 直接改了 node——补丁必须过 onPatch 才进持久化
- **「动作 404」**：动作名没带全前缀，或没在包的 `ops` 表里注册
- **「卡数据丢了」**：data 超过 256KB 被截/拒；大内容落 `ctx.files`，卡里存路径
- **审批/字段细节未定**：全塞 `data` 黑盒，平台不认得的字段原样保留——别把"未定"当阻塞

## 边界

- 通用卡片（text/image/sketch/storyboard/video/page/presentation）的修改是平台侧的活，不走本技能
- 卡片要的业务后端是你的事，平台只提供画布内通道（onPatch/files/动作）
- 视频大卡（>30MB）本期不支持
- 画布引擎/通用卡/平台 API 的改动走平台侧分支，不在卡片包里夹带

## 冻结区（正在拆出，禁止 FDE 改动）

以下代码正在拆成独立 App 仓（`designai-app-*`），**不是卡片开发面，不要读、不要改、不要引用**：

- `apps/web/src/components/Browser*`、`DesignBrowserPanel`、浏览器标签/收集面板——拆为 `designai-app-browser`
- `SketchEditor`、`SketchWorkspaceTab`、`CanvasSketchCard`、草图相关路由——拆为 `designai-app-sketch`（**草图卡类型留在画布**，编辑器是独立 App，交互协议见 `docs/canvas-app-interop.zh-CN.md`）
- 剪辑器相关（`clip-*`、ClipEditor、clip 导出）——**已决定整体删除**，别依赖 clip 卡类型
- `apps/server/src/routes/`、`apps/web/src/components/FileWorkspace.tsx` 等非卡片面——平台运行时，一律视为冻结

你的工作面**只有**：`packages/canvas-pack-*`、`packages/canvas-workbench/src/packs.ts`、`apps/server/src/card-packs.ts` 三处，外加自己的测试。

## App ↔ 画布交互

卡片点开编辑器是「画布 → 独立 App」的请求，协议见 `docs/canvas-app-interop.zh-CN.md`：COI 读状态 / COI 动作写回 / 共享桶存文件，App 与画布互不依赖内部代码。
