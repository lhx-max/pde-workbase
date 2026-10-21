---
name: 画布 APP 平台开发
description: 画布 App 平台开发与 Agent 调用入口。Use when 用户要"开发画布卡片/卡片包/card pack/新建一种卡片/FDE 业务卡片/开发新 APP/接入画布体系/Agent 调画布/租户治理/App 显隐"，或要让 AI/Agent 通过 API/CLI 操作画布与已注册 App。负责指引卡片包契约、App 开发规范（P1–P24 合同）、租户资产体系、Agent 统一调用口；不负责替你定业务字段。
version: 2.1.0
---

# 画布 APP 平台开发（卡片包 + App + Agent 调用）

本 Skill 覆盖三种工作：开发卡包、开发独立 App、适配宿主/Agent。**App 是有业务与权威数据的产品；surface、卡包、CLI 是不同交付物。一个卡包可提供多种卡，一张卡是画布中的实例。**

**零背景入口**：先读 [独立 App 开发手册](docs/app-development-handbook.zh-CN.md)，再按下表加载专项合同。开发合同与实现/发布状态分开记录；不从旧文档的“✅”推断今天的运行状态。

## 开工前必读（按顺序）

| 任务 | 读什么 | 必须交付 |
| --- | --- | --- |
| 新 App / 无背景接手 | 手册 → `docs/app-development-spec.zh-CN.md` → [合同模板](templates/APP_CONTRACT.template.md) | 本 App 的 `docs/APP_CONTRACT.md`、前后端独立闭环及适用验收证据 |
| 新卡包 | 手册 §1/§6 → `docs/canvas-card-pack.zh-CN.md` §1–§3、§11、附录A | 前端 renderer、纯服务端 kind/可选 handler、data/schema 与真实保存读回 |
| 卡片深编辑 / App互联 | `docs/canvas-app-interop.zh-CN.md`；正文另读 `docs/document-sync-contract.zh-CN.md` | 同实例绑定、版本化读写、复制隔离、同步/冲突/恢复 |
| 外部 MA-V / CLI | 手册 §7–§11 → App规范 §4.5/§4.6 | 未改宿主的适配包、manifest、Provider、安装/配置/Skill 和分级验收 |

现有冲突修正与工程待补清单见 [规范审计](../../../docs/app-development-standards-audit.zh-CN.md)。打包发布按实际发布任务核验，不改他人宿主或伪造登记。以下卡片专用章节只适用于卡包开发，不把其工作面限制套到独立 App 任务上。

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
   - 💡 **卡有深编辑 App 时**：`/server` 入口里给 `cards[]` 加 `editorApp: '<appId>'`（如 `'doc'`），能力清单的 `editorApps` 会带上，画布「打开编辑器」和管理侧都认这个关联
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

### Agent 统一 CLI（首选）

`canvas-server apps` 是 Agent/脚本操作整个平台的一条门道——不用记各 App 地址：

```bash
export CANVAS_SERVER_URL=http://127.0.0.1:17462
node apps/server/dist/cli.js apps list                          # 目录+能力清单（谁有什么动作）
node apps/server/dist/cli.js apps call canvas node.create --instance <画布ID> --body-file op.json   # 调画布操作
node apps/server/dist/cli.js apps call doc doc.write --instance <文档ID> --body-file input.json     # 调 App 动作（宿主代理转发）
node apps/server/dist/cli.js apps state <appId> --instance <ID> # 读实例状态
node apps/server/dist/cli.js apps bindings --project <画布ID>   # 卡都绑了哪些 App 资产
node apps/server/dist/cli.js apps entitlements                  # 显隐治理表（GET/PUT/DELETE 走 HTTP）
node apps/server/dist/cli.js apps audit                         # 操作账本
# 租户身份：--tenant <teamId> --actor <userId>（或 CANVAS_TEAM_ID/CANVAS_USER_ID；默认 local/local）
```

**Agent 分工规则**：改卡片本体（建/移/删/连）→ `canvas` 的 operations/actions；改卡片内容（正文/参数/产出物）→ 先 `apps bindings` 查绑定 App 实例 → 调它的 actions。能力看 `apps list` 各 App 的 manifest。

### COI 门脸（直接打 HTTP 的等价面）

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

### App 互联（卡片有对应 App 时才用）

> 开发一个新 App（不是卡包）时，规范真源是 [`docs/app-development-spec.zh-CN.md`](docs/app-development-spec.zh-CN.md)：仓库结构、存储、协议面 P1–P11、嵌入形态、合规自检表——照它做就能插进这套体系。

```bash
# 6. 看装了哪些 App（自注册的都在这里）
curl http://127.0.0.1:17460/api/apps
# 外部 App 自注册：POST /api/apps/register {"appId","name","endpoint"}

# 7. 卡 → 编辑器 App 解析（kind→editorApps→endpoint+filePath）
curl -X POST http://127.0.0.1:17460/api/apps/canvas/instances/my-test/open-editor \
  -H 'content-type: application/json' -d '{"nodeId":"c1"}'
# 未关联/未注册返回 404 APP_NOT_INSTALLED

# 8. 卡片文件取件（App 读写卡里 projectFilePath 指的同一份文件）
curl "http://127.0.0.1:17460/api/apps/canvas/instances/my-test/files?path=<相对路径>"
curl -X PUT "http://127.0.0.1:17460/api/apps/canvas/instances/my-test/files?path=<相对路径>" \
  -H 'content-type: application/json' -d '{"content":"..."}'
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
- **「建卡 403 CARD_KIND_NOT_ALLOWED」**：服务端没挂你的 `/server` 入口——卡种注册是强制的，不是只有 ops 才需要
- **「open-editor 404」**：卡没声明 `editorApp` 或那个 App 没 `POST /api/apps/register` 自注册
- **「卡数据丢了」**：data 超过 256KB 被截/拒；大内容落 `ctx.files`，卡里存路径
- **审批/字段细节未定**：全塞 `data` 黑盒，平台不认得的字段原样保留——别把"未定"当阻塞

## 边界

- 通用卡片（text/image/sketch/storyboard/video/page/presentation）的修改是平台侧的活，不走本技能
- 卡片要的业务后端是你的事，平台只提供画布内通道（onPatch/files/动作）
- 视频大卡（>30MB）本期不支持
- 画布引擎/通用卡/平台 API 的改动走平台侧分支，不在卡片包里夹带

## 冻结区（正在拆出，禁止 FDE 改动）

本节限制 **FDE 卡包任务**。平台所有者明确授权的独立 App/接入/规范任务按用户范围执行，不得误解为所有 Agent 都只能改下面三处。

以下代码正在拆成独立 App 仓（`designai-app-*`），**不是卡片开发面，不要读、不要改、不要引用**：

- `apps/web/src/components/Browser*`、`DesignBrowserPanel`、浏览器标签/收集面板——拆为 `designai-app-browser`
- `SketchEditor`、`SketchWorkspaceTab`、`CanvasSketchCard`、草图相关路由——拆为 `designai-app-sketch`（**草图卡类型留在画布**，编辑器是独立 App，交互协议见 `docs/canvas-app-interop.zh-CN.md`）
- 剪辑器相关（`clip-*`、ClipEditor、clip 导出）——**已决定整体删除**，别依赖 clip 卡类型
- `apps/server/src/routes/`、`apps/web/src/components/FileWorkspace.tsx` 等非卡片面——平台运行时，一律视为冻结

你的工作面**只有**：`packages/canvas-pack-*`、`packages/canvas-workbench/src/packs.ts`、`apps/server/src/card-packs.ts` 三处，外加自己的测试。

## App ↔ 画布交互

**外部基座接入（2026-10-21）**：只改我们自己的 App、包装层和部署产物以适配目标已公开合同；不要修改对方基座/公共 SDK/菜单/Agent 调度。静态组件注册、后端应用登记、真实 Agent 调用是三项独立验收。MA profile 的完整 URL、正式 props、版本匹配和交付自检见 [`App 开发规范 §4.6`](docs/app-development-spec.zh-CN.md#46-外部基座接入应用侧适配与登记验收2026-10-21-用户确认)。

卡片点开编辑器是「画布 → 独立 App」的请求，协议见 `docs/canvas-app-interop.zh-CN.md`：COI 读状态 / COI 动作写回 / 共享桶存文件，App 与画布互不依赖内部代码。
