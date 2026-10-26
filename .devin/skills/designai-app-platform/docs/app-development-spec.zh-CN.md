# DesignAI App API 与实现规范

文档修订：3.2.0；日期：2026-10-23。文档版本不改变 COI、MA 或业务协议自身的版本。

> 给要**从零开发一个新 App** 的人或 Agent。业务参考：`designai-app-doc`；外部接入参考：[一涵示范仓与合同逐项对照](da-plugin-kit-integration.zh-CN.md)（2026-10-22 深度复核）。示范、MA实际合同与本项目云端/可靠性增补分开取证。
> **先读 [App架构与开发白皮书](app-development-handbook.zh-CN.md)**：定义 App/卡包/surface/包装层/CLI、责任、ID、环境与完整开发验收流程；本文件保留具体协议。COI 与 MA 是不同 profile；P1–P24 按提供方分工，不要求每个 App 实现宿主所有路由。旧运行样例仅证明当时范围，不能当生产就绪结论。
> **正文接入增补（2026-10-21）**：[双入口版本编辑、持久同步与资产复制合同](<document-sync-contract.zh-CN.md>)。doc 既有正文变更必须带基线/版本；使用资产为独立复制，镜像确认不能重新广播成本地用户修改。此增补优先于下面的旧式无版本写示例；生产就绪程度以实际验收记录为准。
> 配套：[资源与负责人目录](platform-resource-catalog.zh-CN.md)、[统一可靠性交付合同](unified-app-delivery.zh-CN.md)、`canvas-app-interop.zh-CN.md`、`canvas-card-pack.zh-CN.md`。规范适用范围与证据状态分别维护。

---

## 〇、一个 App 是什么

**App = 一个自带前端 + 后端 + 存储的完整小产品。** 它不依赖画布就能独立启动、独立使用；接进画布后，画布里的卡片可以打开它做深度编辑，管理侧 Agent 可以像调画布一样调它。

一个 App 有三项责任；服务/库可以按已批准架构共享，不能从“独立App”推导每项必须单独部署。生图当前目标使用独立生图后端、自己的业务存储与私有桶；画布承载生图属于历史兼容 profile，不作为新生图业务的默认落点：

```
┌─────────────────────────────────────────┐
│  App（例如 doc 文档编辑器）                │
│                                         │
│  前端   React 组件 → 打成 npm 包交给画布    │
│  后端   自己的 API 服务（Express/等价物）    │
│  存储   经批准的权威 Appwrite 资源            │
└─────────────────────────────────────────┘
        ↑ npm 包（组件嵌进来）
        ↑ 统一 API（Agent 调用）
        ↑ 文件通道（和画布交换内容）
     画布 / 管理侧 Agent
```

- **前端**：React 写的编辑器界面，最终以 **npm 组件包** 的形式交给画布（或其他宿主）嵌进去用
- **后端**：自己的 API 服务，管自己的业务逻辑和数据读写
- **存储**：明确归属与授权的权威 Appwrite 资源；可按批准架构共享后端，不能直接访问其他App私有存储（见 §三）

---

## 一、仓库结构与命名

```
designai-app-<appId>/
├── apps/
│   ├── server/            # 后端：协议 API + 自有业务 API
│   └── web/               # 前端壳：独立运行时用的页面
├── packages/
│   └── <app>-surface/     # npm 组件包：交给画布/宿主嵌入的 React 组件
├── functions/<app>-api/   # 可选：同一套后端打包成 Appwrite Function
└── docs/, scripts/        # 文档、云资源初始化脚本
```

| 项 | 规则 | doc 示例 |
|---|---|---|
| appId | 小写单词，全局唯一 | `doc` |
| 仓库名 | `designai-app-<appId>` | `designai-app-doc` |
| 组件包名 | 发布清单确定有权限的 npm scope；appId 不决定 scope 所有权 | 当前 `@ks-designai/doc-surface`；固定版本及发布状态另查制品记录 |
| 服务端口 | 独立服务登记端口；共享后端明确复用地址与路由 | `19000` |
| Appwrite 库 | 合同登记实际project/database；命名不是自动分配或访问授权 | `doc_app_dev`（已核对的开发资源） |
| Appwrite 桶 | 合同登记实际bucket/用途/归属，可按批准架构共享 | `doc_assets_v2`（已核对的开发资源） |
| 环境变量前缀 | `<APPID>_` | `DOC_REGISTER_TO` |

端口由运行配置明确指定，启动前检查实际进程；资源/负责人见目录，临时测试端口留在执行记录，不作为所有新App的固定端口分配。

本家族当前工程基线为TypeScript、Node 24及pnpm 10.33.2；画布surface约束React 18。具体后端框架、宿主renderer和peer兼容以目标仓规则/合同及实际测试为准，不因文档示例强制复制运行栈。

### 1.1 从零起步：以 doc 为参考实现

零上下文接手时先填 [App 合同模板](../templates/APP_CONTRACT.template.md)。`designai-app-doc` 是现有领域参考，不是所有端点都经生产验收的模板；复用接口与结构，按自己的业务/部署验证：

| doc 文件 | 职责 | 新 App 如何复用 |
|---|---|---|
| `apps/server/src/protocol.ts` | **manifest 真源**——动作清单、editorKinds、tenancy 声明、注册体 | 复用声明结构，按业务定义appId、schema与动作 |
| `apps/server/src/app.ts` | **协议路由全集**——actions 分发、instances/state/files、REST 镜像端点、回执、租户中间件 | 参考路由分层，接入自身领域服务与统一授权 |
| `apps/server/src/store.ts` + `local-store.ts` + `appwrite-store.ts` | 存储接口 + 本地实现 + 云实现（同接口双后端） | 参考业务存储端口，按实际生命周期实现并验证租户过滤 |
| `apps/server/src/tenant.ts` | 本地身份与部署认证边界 | 按目标可信身份合同适配；不能仅复用头解析就声明认证完成 |
| `apps/server/src/index.ts` | 启动 + COI 可选注册/重注册 | 仅内部画布 profile 配置时采用；不是 MA 登记或必需启动依赖 |
| `packages/doc-surface/` | 详情页组件包（编辑器 + api-types 注入接口） | 复用包结构和公共适配边界，挂载自身编辑器 |
| `apps/web/` | 独立壳页面 | 最小壳：一个页面挂你的 surface |

**顺序**：① 填App合同，计划接DA时先对齐§4.6.1 → ② 建立独立仓库骨架与领域边界，`protocol.ts`定动作词表 → ③ `store`接口与Appwrite真实读写，本地实现仅用于显式隔离测试 → ④ `app.ts`路由与认证/版本闭环 → ⑤ 同一surface与独立壳 → ⑥ 按本次profile实现宿主包装层并联调 → ⑦ 按§十自检表分级实测。

## 二、前后端自闭环（硬性要求）

完整独立App的核心业务必须可独立使用，不以画布UI或已打开卡片为前提。批准共享后端的能力在合同中声明服务依赖并单独验收其业务，不因此强拆服务。仅交付卡包/工具时不得自动宣称完整独立App已完成。

自闭环要求：

- 独立后端不以画布UI为启动前提；批准共享后端时明确依赖和责任边界
- 前端壳 `apps/web` 能独立打开并使用编辑器
- 业务权威数据存自己的Appwrite；缺配置明确不可用，不静默本地降级。与画布交换内容只走公开API，不直接读对方数据库；本地文件仅用于显式隔离测试
- 和画布相关的配置（`CANVAS_ORIGIN`、`<APP>_REGISTER_TO`）**全部是可选的**——配了就接上画布，不配就独立跑

## 三、存储规范

资源与访问按[资源目录](platform-resource-catalog.zh-CN.md)登记并向归属仓库负责人审批。新环境必须验证schema预置、字段/索引、私有ACL、写锁、规范字节/索引及必要恢复状态；所有metadata与后台写入共用与正文相同的授权/并发前提。

**业务数据由其权威服务保存。** 独立存储的 App 使用自己的 Appwrite 库/桶；复用已批准共享后端的能力声明实际归属和隔离边界，不为符合目录图另建重复库。不同服务不互查私有数据库，交换只走公开 API（见 §七）。这项云存储要求是本项目增补，不是示范仓要求每个插件都自建数据库。

### 2.9 动作归属规则（卡操作 vs App 操作）

**动作由对应权威数据的责任服务提供。** Agent 和所有调用方按这条路由请求：

| 操作类型 | 归属 | 通道 |
|---|---|---|
| 建/删/移/改名卡、连线、画布实例生命周期 | **画布** | `/api/apps/canvas/instances/{id}/operations` + 实例 actions |
| 写正文、改生成参数、触发 App 能力 | **绑定的 App** | `/api/apps/<appId>/instances/{id}/actions/{actionId}` |
| 查卡绑的是哪个 App 实例 | 画布 bindings 索引 | `GET .../bindings` |
| 发现能力 | 目录 manifest | `GET /api/apps`（画布自己也带 manifest） |

收敛规则：卡的镜像字段也允许经 `node.update` 写（画布会推给绑定 App）——两个入口落到同一份真相，但**改内容优先走 App 动作**。

以下注册分层、治理表与能力清单仅属于 **Canvas COI profile**；MA 目录由基座维护。业务 App 不建立第二套 MA 目录。

**Canvas COI manifest 形状**——内部注册时声明、发现时返回：

```text
{
  "appId", "name", "version", "protocolVersion",
  "cardKinds":   ["能提供的卡种"],
  "editorKinds": ["负责编辑哪些卡种"],
  "actions":     [{"actionId","mode":"app|instance","async","available?"}],
  "operations":  ["实例级批处理操作（画布的卡 API）"],
  "endpoints":   {"路由模板"},
  "events":      {"available","types"},
  "tenancy":     "required",
  "execution":   "synchronous|receipt"
}
```

上块是字段速记，不是可直接提交的 JSON；实际 manifest 按已发布 schema 生成，并区分下方 MA manifest。带说明注释的请求示例使用 `jsonc` 展示，发送时必须去掉注释、填入当前实际值并通过输入 schema 校验。

Agent 工作流：`GET /api/apps` 看清单 → 画布侧 `operations` 做编排 → 按 bindings 找 App 实例 → App `actions` 做内容。CLI `apps call` 对两边是同一条门道。

### 2.9.1 文档类 API 模板（第一个完成的 App 类别）

下表是当前 doc 的 Canvas COI 适配词表。文档类能力可据此选用，其他 App 按自己的业务与消费合同定义动作，不要求复制 doc 端点全集：

| 动作 | scope | 作用 | 级联 |
|---|---|---|---|
| `doc.list` | app | 列本租户文档 | — |
| `doc.create` | app | 建文档；仅绑定模式携带 `input.nodeId` 与画布关联 | 有绑定时上报 bindings 索引；独立文档无需卡片 |
| `doc.read` | instance | 读 meta+正文 | — |
| `doc.write` | instance | 改正文 | 自动回写画布镜像 |
| `doc.rename` | instance | 改名 | — |
| `doc.archive` | instance | 归档（不物理删） | 级联归档画布 binding |
| `doc.open` | instance | 返回详情页 openUrl | — |

通用配套：REST 镜像端点（GET/POST/PATCH/DELETE `/api/documents`）、instances/state、action-receipts、files 通道、租户过滤与越权 403、`archivedAt` 生命周期字段。后续类别（生图/视频/分镜）按各自业务合同确定适用生命周期与专属动作（如 `image.generate`），不为凑齐文档词表添加无语义的write/open路由；未提供项在manifest和验收表如实说明。

### 3.0 租户与资产归属（所有 App 通用，强制）

**每条资产出生就带租户指纹，每个查询都被租户过滤。** 这是未来所有 App 的统一规则——资产必须能回答「哪个团队的、谁的」。

**租户上下文**：`{ teamId, userId }`，每个协议请求携带：

- **显式 local-test**：可用 HTTP 头 `X-Team-Id` / `X-User-Id` 及 `local/local` fixture；正常云端开发/联调不默认降级为该身份
- **部署态**：由宿主 SSO/会话解析注入，App **不信任客户端自报的身份头**（部署端网关重写为准）

**资产字段**：每条持久化记录至少 `{ teamId, createdBy }`（可加 `updatedBy`）。跨服务绑定资产**继承上游实体的租户**——画布实例的租户跟着实例走，卡绑定的 App 文档继承画布实例的租户（画布推送 `doc.create` 时把头带过去）。

**查询与写入门禁**：

- 所有 list/read 默认只返回**请求租户**的记录；跨租户读写一律 `403 TENANT_FORBIDDEN`
- `local/local` 仅属于显式隔离测试；正常云端或 MA profile 缺可信身份直接拒绝。MA 模式还须校验 bizId 与 applicationId/applicationInstanceId/providerInstanceId 的完整归属，不能只按 teamId 过滤
- 文件通道同样校验租户：镜像写入、文件读写必须匹配目标实例的租户

**App 注册分两层**：

| 层 | 含义 |
|---|---|
| `platform` | 内部 Canvas 目录的平台级能力，可被适用团队发现；业务调用仍须通过当前用户、实例、动作及资源授权 |
| `team` | 团队自装 App/卡包，只出现在本团队目录、只能本团队实例挂载 |

注册条目带 `{ scope: 'platform' | 'team', teamId? }`；`GET /api/apps` 按请求租户过滤（platform + 本团队）。

**治理面**：

- manifest 声明 `tenancy: 'required'`——合规 App 必须实现租户过滤；不声明 = 不合规
- 仅在实际消费方约定用量/配额接口时交付 `usage` 或等价能力，并核对权限与计量合同；不要求纯卡包或所有新 App 创建同名路由
- 已采用可恢复文档生命周期的资产，删除走归档；字段及恢复行为按 App 合同。临时产物、任务取消、垃圾回收与依法删除分别定义，不把文档归档字段强加给所有业务实体
- 事件/回执记录带 `actor: { teamId, userId }`

**APP 显隐治理表（`app_entitlements`）**：注册表管「App 存在」，治理表管「是否显示或禁止进入」。行结构 `{ scope, appId, effect, updatedBy, updatedAt }`，`scope = * | team:<id> | user:<id>`，`effect = allow | deny`。**匹配：精确者优先 user > team > *；此内部显隐表无规则时只表示未禁止显示，不授予业务读写权限。** MA 的实例/动作授权仍走其正式合同和 App 服务端可信策略；不能把本表规则当作 MA 官方权限体系。

- 显隐：`GET /api/apps` 自动按表过滤——被 deny 的 App 从目录消失，加卡菜单/页签入口联动消失
- 显隐预检：`GET /api/apps/entitlements/check?appId=<id>` 返回的 `{allowed}` 只表达内部显隐策略。App 每个业务入口仍须校验可信身份、实例归属及动作权限；该接口不能独自防止绕过菜单直调，也不签发 MA 授权
- 管理：`GET/PUT/DELETE /api/apps/entitlements` 读写表行，管理侧可做成一张运维表格

用大白话说：各管各的仓库，要货走传送带（API），不许直接去对方仓库搬。

### 3.1 卡内容的存储归属（宿主卡 vs App 自有数据）

**已绑定业务 App 的正文真相在该 App**；不是要求所有纯卡包自建存储。下文规定选择doc文字卡双入口模式时的目标行为，不构成当前版本已通过证明，也不能推广到全部卡种；画布信封与纯卡片 JSON 仍由画布保存：

- **正文真相 = App 私有库的文档**（doc 文档）。卡详情打开的文档与 App 页签打开的文档是同一份、同一个组件——卡上「放大」按 `nodeId` 绑定/找回 App 文档（`doc.create {nodeId}` 幂等，不重复建）
- **出生即绑定（资产沉淀）**：卡**第一次有内容**保存时，画布自动 `doc.create {nodeId, name:卡标题, content, mirrorCanvasId, mirrorPath}` 建绑定文档——不等用户点开详情；之后每次保存推 `doc.write`（服务端文本同步钩子，UI 与 API 操作全覆盖）。由此用户资产自然全部落到 App 库，无任何上传入口
- **画布侧存镜像**：卡 JSON 的 `text` 和 `projectFilePath` 指向的文件都只是**渲染/实时操作镜像**——卡预览、连线、快照、离线渲染靠它。App 编辑保存时画布把同样内容写回镜像文件（`mirrorPath`），经既有的文件→state 通道让卡预览实时跟上
- **镜像可过期**——真相在 App 侧；App 未注册/下线时镜像仍可显示但不再更新，详情入口随之不可用
- App 私有库里因此有两大类东西：画布卡绑定的文档（meta.nodeId 指回卡）、App 独立使用形态的自有文档

存储两层模式：

- **索引集合**：Appwrite collection 存元数据（`{ name, path, fileId, size, updatedAt }`）
- **桶**：Appwrite bucket 存内容字节，fileId 可在声明的资源作用域内由内容 hash 派生。摘要只用于完整性/去重，不授予跨租户访问权；冲突对象先校验归属和字节，不自动复用或放宽权限

**本地模式**：仅显式隔离测试可选择文件存储，数据根由入口注入。正常开发/联调默认使用Appwrite；配置缺失应失败/503，不能静默落到本地目录或假装上云。

存储配置必须来自资源归属仓库负责人批准的环境，不根据appId推测已创建资源：

| 配置语义 | 应登记的非敏感信息 |
| --- | --- |
| 连接 | 实际endpoint、project、database、collection、bucket与namespace |
| 身份与权限 | 服务端注入的身份来源、可执行操作、资源范围与期限；不保存秘密值 |
| 并发与恢复 | 单写者配置、独占锁、运行态schema、缓存/临时目录和空缓存恢复 |
| 缺配置 | 启动失败或明确503，不静默回退local/local与本地业务存储 |

维护者个人会话只用于明确授权的开发检查，不是共享生产凭据。CLI、浏览器和Appwrite服务身份分别说明；申请入口与资源现状见[资源目录](platform-resource-catalog.zh-CN.md)。

## 四、API profile 与角色分工

本节区分自有业务、内部 Canvas COI 和外部 MA Provider。每个 App 只实现合同选定的 profile 与提供方职责；不能把内部 API 表变成外部 MA 接入的附加前提。

### 4.1 自有业务 API

App 自己领域的接口（doc 的 `/api/documents` 列表/读写/导出）。领域字段自行设计，输入/输出与错误均在公开schema中说明。COI信封仅用于COI入口，MA使用§4.5合同，不混用。未实现或未配置能力显式返回适用的501/503，不返回假成功。

<a id="42-统一协议合同v1唯一标准"></a>

### 4.2 Canvas COI profile（v1）

这是**我们维护的 Canvas COI profile**，画布和业务 App 按角色复用同一骨架。它不取代外部 MA open-platform 合同（§4.5），也不表示旧客户端已完成迁移。新增实现按此合同；兼容撤除需另验。

**目录与接入**

| # | 端点 | 级别 | 行为与约束 |
|---|---|---|---|
| P1 | `GET /api/apps` | 必须 | 目录：列出所有已注册 App（调用方在宿主/画布侧调） |
| P2 | 启动时 `POST <宿主>/api/apps/register` `{appId,name,endpoint,webUrl?,description?,scope?,manifest}` | 必须 | 自注册：告诉宿主「我上线了，在这个地址」。`endpoint` 是协议/API 面地址；`webUrl` 是**你自己前端页面的地址**（宿主「打开 App 详情页」时跳它，不填退化到 endpoint）。**`manifest` 必填**——能力清单随注册入目录（见 §五），Agent 靠它发现你的动作；`scope:'team'` 时只进注册者团队目录。**注销**：宿主侧 `DELETE /api/apps/<appId>` 把 App 从目录移除——此后它的卡片从所有「+」菜单消失、页签「+」不再列出它；`canvas` 自身不可注销 |
| P3 | `GET /api/apps/<appId>` | 必须 | 能力清单：我是谁、我编辑什么卡、我有哪些动作、事件流在哪 |
| P4 | `POST /api/apps/<appId>/open-editor` `{nodeId,filePath,canvasId?}` → `{openUrl}` | 编辑器 App 必须 | 收「打开我编辑这张卡」的请求；配套 `GET ?nodeId=` 可查回话 |

**实例与状态**

| # | 端点 | 级别 | 行为与约束 |
|---|---|---|---|
| P5 | `GET /api/apps/<appId>/instances` | 应当 | 实例列表 |
| P6 | `POST /api/apps/<appId>/actions/<app>.create` `{input:{name?}}` | 应当 | 建实例（App 级动作） |
| P7 | `GET /api/apps/<appId>/instances/:id/state` | 必须 | 实例当前状态（含 `revision`/`eventCursor`） |
| P8 | `GET /api/apps/<appId>/instances/:id/revision` | 可 | 只拿版本号 |
| P9 | `GET /api/apps/<appId>/instances/:id/context` | 可 | 实例摘要（Agent 读的轻量上下文） |
| P10 | `GET /api/apps/<appId>/instances/:id/nodes/:nodeId` | 可 | 单实体读取 |
| P11 | `GET /api/apps/<appId>/instances/:id/nodes/:nodeId/history?limit=` | 可 | 实体历史 |

**写操作（统一动作模型）**

| # | 端点 | 级别 | 行为与约束 |
|---|---|---|---|
| P12 | `POST .../instances/:id/operations` `{operationId,baseRevision,operations[]}` | 画布必须；其他 App 有批量语义时必须 | **批量原子提交**，1–100 个操作一个版本——写操作的正形 |
| P13 | `POST .../instances/:id/actions/:actionId` `{input,expectedRevision}` + `idempotency-key` 头 | 应当 | 声明为可用的动作必须有实际路由与行为；未实现动作标 `available:false` 并明确不支持，已实现但缺配置返回不可用，不把占位路由当可用动作 |
| P14 | `GET .../instances/:id/operations/:operationId` 或 `.../action-receipts/:receiptId` | 应当 | 回执查询：网络结果不确定时先查这里不重发 |
| P15 | 实例生命周期动作 `<app>.rename`/`<app>.delete`/`<app>.duplicate` | 应当 | 挂在 P13 动作入口下，不走 REST DELETE |

**文件与交换**

| # | 端点 | 级别 | 行为与约束 |
|---|---|---|---|
| P16 | `GET/PUT /api/apps/<appId>/instances/:id/files?path=` | 必须 | 读写我这个实例的文件，响应 `{data:{content}}` |
| P17 | `GET/PUT /api/apps/<appId>/canvas/:canvasId/files?path=` | 编辑器 App 应当 | 画布文件桥：后端转发到画布文件通道，前端不用直接知道画布地址 |

**事件与权限**

| # | 端点 | 级别 | 行为与约束 |
|---|---|---|---|
| P18 | `GET .../instances/:id/events?after=<cursor>` | 画布已实现；其他 App 二期 | SSE 变化流：`ready` → 实体增删改；`resync:true` 时先重读 state |
| P19 | `GET /api/apps/<appId>/permissions` | 必须 | 团队权限口；未接入返回 `501 + {available:false, reason}`，**不许编造权限服务** |
| P20 | `.../instances/:id/snapshots*` | 二期 | 快照 CRUD+恢复；未实现时 manifest 标 `available:false` |

**租户与代理（Agent 统一入口）**

| # | 端点 | 级别 | 行为与约束 |
|---|---|---|---|
| P21 | 请求头 `X-Team-Id` / `X-User-Id` | 必须 | 租户上下文（§3.0）：仅显式local-test允许 `local/local`；云端/部署态由可信认证通道验证，客户端不可伪造。**每个 App 必须校验并过滤** |
| P22 | `POST <宿主>/api/apps/<appId>/(instances/:iid/)actions/:aid`、`GET <宿主>/api/apps/<appId>/instances(/:iid/state)` | 宿主实现 | **Agent 统一代理口**：按 appId 查注册表转发到 App 端点，自动带租户头/幂等键，entitlement deny 短路。Agent/CLI 只需知道宿主地址，不记各 App 地址；`canvas` 自身路由不经过代理 |
| P23 | `GET/PUT/DELETE /api/apps/canvas/instances/:id/bindings[?nodeId=]` | 画布实现 | 卡↔App 绑定中心索引（data-model §三）：App 建绑定时 PUT 上报，资产归档时 DELETE 级联归档，治理/Agent 用 GET 查 |
| P24 | `GET/PUT/DELETE /api/apps/entitlements`、`GET /api/apps/entitlements/check?appId=`、`GET /api/apps/audit` | 宿主实现 | 治理面：显隐表（scope×appId×effect）、App 自校验口、审计尾日志 |

> 本表级别只在选定 Canvas COI profile 且属于相应提供方职责时适用；P1/P2 的登记接收/P22/P23/P24 属宿主，业务 App 按角色实现，纯卡包不新增 HTTP 服务。MA-only App 按 §4.5–§4.6 接入。
> 「必须」= 该角色/profile 的必需项；「应当」= Agent 的统一调用面；「可」= 有就给、没有不强求；「二期」= 可缓但要诚实标注。
> CLI：`canvas-server apps list|call|state|bindings|entitlements|audit` 是 COI 的源码命令行包装。独立安装包、真实命令名、MA 环境安装/网络/认证/实例上下文仍需按发布清单与手册 §8 验收；不能从本机命令存在推断远端可调用。当前 `apps call` 的 body-file 是input；源码另提供 `--expected-revision`/`--idempotency-key` 和回执命令，实际安装包须核对版本与help，不能把源码能力反推给旧包。

### COI 命名与包格式（不覆盖 MA Provider）

- 本项目动作名 `<appId>.<动词>`：`doc.read`、`sketch.update`；示范 MA 动作如 `list_content` 也是有效外部 ID，不能以本项目命名覆盖目标合同
- 错误码 `<APPID>_<SCREAMING_SNAKE>`：`DOC_NOT_FOUND`
- 成功包：`{ "requestId": "req_<uuid>", "data": {...} }`
- 失败包：`{ "error": { "code", "message", "retryable", "details?" }, "requestId": "req_<uuid>" }`
- 写操作认 `idempotency-key` 头：同一个键重发返回原结果，不重复执行
- 共享可编辑资源写应携带目标合同规定的版本/基线；冲突回 `409`，缺前提可回 `428`。doc 既有正文遵守正文增补合同，不允许以“一期放宽”为由恢复最后写赢。

**诚实铁律**：没配置、没接入的能力返回显式 `501/503`，**永不假成功、永不编造端点**。

### 4.3 卡片可见性 = 注册表驱动（宿主侧规则）

以下是自有画布工作台的入口设计合同，存量入口是否完全声明化按实际版本核验，不作为所有 App 或外部 MA 的菜单规则：

- **画布上的「+」加卡菜单**（卡柄、底栏、空白画布）：卡的种类必须出现在画布 manifest `nodeKinds` 里，且——
  - **原生卡**（image / video / storyboard）：始终显示，画布自己就能编辑；
  - **App 支撑卡**（text / sketch / page / presentation，及 manifest `editorApps` 里登记的任何 kind）：**对应 App 已注册且 active 才显示**。App 一上线卡就出现，一下线/未装就消失——不是灰掉，是隐藏。**文字卡也是 App 卡**：`text` 归 doc App（`editorApps['text']='doc'`）——卡内正文渲染直接用 doc 的 surface 组件（`@ks-designai/doc-surface` 的 `MarkdownWordDocument`），doc 注销后文字卡从加卡菜单消失（画布上已存在的卡仍以 surface 组件渲染，只是不再可新建、深度编辑入口失效）。
- **页签栏「+」**：列出已注册的外部 App（画布自己除外），点击**在工作区新开一个页签、挂载 App 的 TSX 组件**（不是 URL 跳转）——页签 id `app:<appId>:<target>`，存进持久化页签状态。它只负责「打开 App 页签」，不负责「建卡」；建卡永远走画布上的「+」。
- **App 页签的挂载方式**：宿主安装 App 的 surface npm 包（如 `@ks-designai/doc-surface`），按 appId 找到对应组件渲染；组件通过 App 的 `endpoint`（协议面地址）读写数据，**不走 iframe**。跨源访问仅在确有需要时按已批准的精确来源与凭据策略配置；同源代理可不需要 CORS。隔离测试也不以通配凭据来源代替鉴权，CORS 不能充当资源授权。
- 所以 App 想让自己的卡在画布上可建：① 注册自己（P2）② manifest `editorKinds` 声明你编辑什么 kind ③ 宿主 manifest `editorApps` 里有 kind→appId 映射（卡包注册时写入）。

### 4.4 卡面三权分立（卡内 UI 归属）

一张卡上的 UI 分三个归属方，各管各的：

- **卡壳**（边框、缩放手柄、标题栏、复制/删除、连线锚点、「+」）：**宿主画布**，App 不碰
- **内容区**（渲染、内联编辑）：**卡所属 App 的 surface 组件**全权决定——宿主不得往内容区塞自己的提示菜单
- **空卡初始动作面板**：**宿主**——空卡时展示的初始面板（如文字卡的「自己编写/拆分镜/生成图片/文生视频」）动作全是编排层动作（进入编辑态、建连卡），归宿主管；一旦进入编辑/有了内容，内容区归 App
- **跨卡动作入口的可见性 = 目标卡可建**：卡上「建一张连过来的 X 卡」类按钮（初始面板、卡边快捷动作、源锚点「+」菜单共用同一份规则）只在**目标卡种当前可建**时显示——目标 App 未注册/卡种不可用就整条隐藏，与加卡菜单用同一个注册表数据源。动作本身是「建卡+连线」的编排动作；连过去的卡内容谁生成，仍是 §4.4 末条的 Agent 通道问题
- **新增卡间联动入口必须走声明，不许硬编码**：以后想在卡与卡之间加绑定关系按钮（如「文本→分镜」「图→视频」），以动作记录声明 `{源卡种, 目标卡种, 入口位置(初始面板/卡边/锚点菜单), 图标, 文案}`，由宿主统一渲染、统一按目标卡可用性过滤——不许再在具体卡组件里写死按钮；存量硬编码入口（文字卡的三连）随卡包化逐步迁成声明
- **Agent 面向的动作**：小按钮（如工具栏「发给 AI」）**默认展示**（无内容置灰不可点），无执行通道时点击返回明确的不可用报错（不静默失败）；大输入面板（AI 操作条那种整段表单）才在无通道时整条隐藏
- **详情入口 = 同一组件 + 同一数据源**：卡上「放大/详情」和页签「+」打开的 App 页面必须挂**同一个 surface 组件、读写同一份 App 文档**（§3.1——App 存真相，画布文件只是渲染镜像）。宿主不许再开一套自己的查看器/编辑器做「详情」
- **绑定详情与独立文档分开**：从已有卡片打开详情必须找到同一绑定；独立 App/外部 MA-V 创建文档允许无卡。画布工作台某个创建入口若要求同时建卡，作为该入口明确约定，不升级为所有宿主/所有文档的一一绑定规则。
- **打开时只读对账**：不因为卡镜像与正文不同就推卡稿覆盖 App。按正文增补合同读取真实版本、显示待同步/冲突，并通过有基线的写和显式恢复处理；不能把缓存 `preferContent` 当覆盖授权。
- **空卡初始面板自适应**：卡存的尺寸小于初始面板所需时必须自动补到完整尺寸，不许把初始动作裁掉一半
- **AI 生成操作条**（提示词输入、「拆分镜/生图/文生视频」这类跨卡生成）：**管理侧 Agent 执行通道**——它不是「卡的部件」，是借卡的位置放的 Agent 入口。宿主 manifest 的 `agentRuntime.available` 声明执行通道是否接入；**未接入时整条生成 UI 必须隐藏**，不许放一个能输入但没人执行的假框（诚实铁律）

上述门控针对画布宿主的 Agent 入口。业务 App 自有的图片处理/生成若由其真实后端执行，则按 App 的公开动作、任务与结果合同验收，不强制依赖外部 MA；未配置实际执行服务时仍须明确不可用，不能伪造生成成功。

### 4.5 MA open-platform Provider 口（接入外部 MA 时必接）

管理侧 Agent（MA 网关）不直连我们的统一 API——它走自己的
**open-platform 协议**打进来。选择外部 MA 接入 profile 的 App 必须另外暴露这个适配口，
否则 Agent 目录里的应用登记了也调不动。本阶段仅要求自己的画布内部闭环时，不以此适配口、正式 Provider 认证、远端 MA 或 staging 验收作为前置门槛；仍须完成内部业务、卡片互联和适用的安装/读写验收：

```
POST {provider.baseUrl}/open-platform/v1/instances/{providerInstanceId}/actions/{actionId}
```

这是 **MA→Provider** 一跳的完整信封；调用者→MA 的入口只接收其 strict schema 允许的 applicationInstanceId/sessionId/actionId/expectedRevision?/input，不能把下面整包直接提交给 MA。请求字段须按目标版本核对：

```jsonc
{
  "protocolVersion": "1.0",
  "requestId": "req_xxx",            // 网关每次调用唯一
  "idempotencyKey": "req_xxx",
  "applicationId": "app_...",        // 网关注册的应用 ID
  "applicationVersion": "0.1.0",
  "applicationInstanceId": "ai_...", // 网关侧实例 ID
  "providerInstanceId": "<path 参数>",// 我们侧实例 ID（doc: 文档 ID/别名）
  "bizId": "biz_...",                // 业务/项目 ID
  "sessionId": "s_...",
  "actor": { "userId": "u_...", "tenantId": "t_..." },
  "actionId": "doc.write",
  "expectedRevision": 7,             // 传输字段可选；修改既有资源时按动作合同要求必填
  "input": { "content": "..." }      // 各 action 自己的入参
}
```

响应（网关逐字段校验，形状不对整单判失败）：

```jsonc
{
  "protocolVersion": "1.0",
  "actionId": "doc.write",
  "providerInstanceId": "ma-test-1",
  "revision": 8,                  // Provider 正安全整数；示意值，不能假定总是加1或等于正文hash/核心revision
  "summary": "文档「x」已写入",   // ≤2000 字的人类可读一句话
  "data": { /* 原 action 返回，网关原样透传给 Agent */ }
}
```

读快照另有 `GET {provider.baseUrl}/open-platform/v1/instances/{providerInstanceId}`，SDK形状为 `{protocolVersion,providerInstanceId,revision,summary,content,availableActions}`。示范画布也可用 `list_content` 动作读取；App明确实际采用的读合同，消费snapshot才要求对应GET和鉴权，不用虚构路由凑齐。动作结果用 `data`，快照用 `content`，均不再套 COI 的 `{requestId,data}` 外壳。SDK类型本身不完成认证、响应校验或持久重试保证。

2026-10-22 统一交付增补见 [完整 MA 作用域、云权威与恢复合同](unified-app-delivery.zh-CN.md)。下面的版本与认证约束按该增补执行，历史实例和已安装包须核对实际版本。

适配语义（doc 的 `apps/server/src/open-platform.ts` 可作领域参考，不作为已验证的通用生产模板）：

- **身份**：Provider 必须先验证来自约定可信网关的调用/委托，再使用actor映射内部租户。actor本身不是认证。Provider 实现须提供可信调用方、actor 与实例归属核验；隔离 fixture 通过不代表正式 SSO 或部署已验。未配置可信入口时拒绝远端调用，正式宿主验收独立记录。参考 [Kit接入记录](da-plugin-kit-integration.zh-CN.md#4-文档-app-参考与当前限制)，按实际发布版本验收可信入口后才可公开部署。
- **providerInstanceId → 实例**：按该 App 的完整可信 MA 归属解析、云端保存映射。文档的 `ma:<pid>` 是其领域别名示例，不能作为全局唯一键或所有 App 通用算法；普通业务 ID 也须通过当前归属/权限校验。创建与打开分离，不能由read隐式创建。
- **版本**：Provider 外层 `expectedRevision` 用上次 Provider 响应，不匹配回409。正文基线/hash是业务内层语义；适配器不得先取得新基线再盲盖过时稿。若依据外层整数版本补内层基线，必须在同一原子检查/提交边界证明安全，不能只靠先 check 后 write。doc 的当前 Node 实现以实例串行边界及持久计数器处理，修改后仍须验证检查与提交的竞争窗口。
- **幂等**：一次逻辑操作保留稳定 idempotencyKey/输入；公开回执持久范围。doc 在配置共享云状态口时持久保存 reservation 与完成回执，未配置时仍是会话级；画布有自己的持久操作日志。验收要包含空工作目录重启、同键不同输入及提交后响应丢失，不能推导别的入口也已通过。
- **动作面**：只开 manifest 声明过的动作；未知动作 404、实例不存在 404、版本不符 400/409、`protocolVersion ≠ 1.0` 400。
- **部署面**：部署哪个入口就测试哪个入口。函数 executions 可能有额外传输外壳，必须核对网关/函数的 path/method/body 映射，不能简单在函数执行 URL 后拼业务路由。

应用登记走基座已确认的正式机制，不由 App 直接写后端数据行。`manifest.slug` 与内部 appId 的映射由 App 合同声明（可以相同）、`provider.baseUrl` = 你的 endpoint、`actions[]` 按 `{id,title,description,effect,inputSchema,requiredPermissions}` 逐个列、`frontend:{moduleId,exportName}` 指 surface 组件注册位（见 §七）。**登记前先实测本口——他网关对响应形状是硬校验，形状不对整单失败。**

### 4.6 外部基座接入：应用侧适配与登记验收（2026-10-21 用户确认）

**责任边界**：我们适配目标基座已经公开的合同；基座源码、公共 SDK、菜单、会话和 Agent 调度由其所有者维护。不得把修改目标基座作为 App 的安装步骤或“接入成功”前提。合同确实缺项时记录缺口与适用范围，不私自加宿主参数来证明兼容。

目标基座当前核对基线：`design-ai-client/yihan-dev-ma` 的 `fa9475183`，其中 `packages/contracts/src/api/ma-applications.ts`、`ma-v/src/session-apps/types.ts`、`resolver.ts`、`SessionAppSurface.tsx` 及 Plugin Kit SDK 1.0.0。它是外部兼容性基线，后续按目标正式版本更新，不复制成我们的平台真源，也不据此宣称全部生产链路已完善。

交付与验收必须区分三层：

1. **组件可安装**：提供独立可安装包、版本、CSS、真实命名导出与依赖闭包。`frontend.moduleId/exportName` 是宿主编译注册身份，版本要与后端 `currentVersion`、manifest 和实例 `applicationVersion` 一致；源码软链、Preview 能渲染不等于可移植交付。
2. **后端可登记**：交付部署 manifest，按目标正式登记/发布入口安装。MA profile 的 `provider.baseUrl` 必须是完整 URL；`/canvas-provider` 只是本机 Preview 路由，不能作为正式登记值。不得自造 `app_`/`ai_` ID、用我们的 `/api/apps/register` 冒充 MA 登记，也不向目标数据库直接塞行。云端目录被 503 门禁拒绝时，记录为目标服务未就绪，不能改菜单假装注册成功。
3. **可打开调用**：从目标目录创建、关联并打开真实实例；Agent 经其正式工具通道调用公开动作，回执、App 存储与 UI 读回一致。前端关键词预执行、模型复述脚本结果和只在 Kit Preview 点击均不得算真实 Agent 调用通过。

前端适配只消费目标已承诺的 props。当前 MA-V 会传 `context/fileClient/conversation`；`providerClient` 虽在 SDK 类型中可选，宿主实际没有传，不能当成必需项；`registerBeforeLeave` 和画布私有 `transport` 也不是该宿主已承诺的接口。应用自己的发布配置/包装层负责接入现有通道，不能要求基座新增这些参数。缺少必要能力时如实报不支持并给出所需公开合同，不静默连到开发者电脑。

所有地址按部署 profile 配置，不能把 `127.0.0.1:19000`、`17463`、绝对工作目录或另一个仓库源码路径写成通用运行依赖。联调 manifest 可使用明确的本机 URL，但必须与生产登记产物区分；远端服务上的 loopback 不指向用户电脑。用户与团队身份由约定的认证/委托通道证明，actor 字段本身不是认证凭据。前端共用宿主渲染器，遵守本仓 React 18 约束并独立核验真实宿主运行兼容性，不靠捆绑另一份 React 规避冲突。

最小交付包包括：组件安装包、按环境生成的 manifest、Provider 协议/版本/错误说明、认证与网络依赖、声明动作的参数 schema、在未修改目标基座上完成的安装/打开/调用/持久化证据及未通过项。规范与能力声明只记录实际通过的范围。

### 4.6.1 新 App 从开发阶段准备 Kit 接入（2026-10-21）

正式宿主接入工具仓为 [design/design-agent-plugin-kit](https://git.corp.kuaishou.com/design/design-agent-plugin-kit)（`master`）；SDK、静态registry、Preview的职责与兼容基线见 [Kit仓库与App接入准备](da-plugin-kit-integration.zh-CN.md)。它是一涵基于其后端的App示范，展示前端接入合同；不代替App业务服务、云端存储或基座正式登记。

计划接DA的独立App在开发合同中提前确定：① 可独立安装的surface与App自有包装层；② Kit/目标宿主版本和实际props；③ 应用/Provider/业务实例映射及恢复；④ 精确动作schema、版本/幂等及UI与Agent共用服务；⑤ 各环境地址和可信认证注入；⑥ 保存切换、文件资源与对话能力的支持范围。缺输入记录“待提供”和所阻塞的验收门，不猜接口或先写死localhost。

这些是开发准备要求，不要求外部Provider、正式目录或staging先就绪。自身云端闭环、Kit组件联调、正式DA登记/打开、真实Agent调用与staging依次按本次profile验收；纯卡包仍只履行适用的卡包合同。每个App用 [合同模板](../templates/APP_CONTRACT.template.md) 记录准备项和各门证据。

## 五、能力清单 manifest

`GET /api/apps/<appId>` 返回的样子：

```json
{
  "appId": "doc",
  "name": "文档编辑器",
  "version": "0.1.0",
  "protocolVersion": 1,
  "editorKinds": ["text"],
  "actions": [
    { "actionId": "doc.list",  "mode": "app",      "async": false },
    { "actionId": "doc.read",  "mode": "instance", "async": false },
    { "actionId": "doc.write", "mode": "instance", "async": false },
    { "actionId": "doc.open",  "mode": "instance", "async": false }
  ],
  "events": { "available": false },
  "snapshots": { "available": false },
  "requiresExpectedRevision": true,
  "execution": "synchronous"
}
```

- `editorKinds`：我负责深编辑哪几种卡——**必须和画布能力清单里的 `editorApps` 映射对得上**（`text→doc`）。对不上管理侧会把请求指到错的地方。
- `actions`：只写真实现的。

## 六、和画布的交互（三个半口）

| 通道 | 职责 |
|---|---|
| **自注册** | 启动时向画布 `POST /api/apps/register` 登记 `{appId, name, endpoint, manifest}`；失败只告警不退出。只在选择内部COI自注册profile时启用约定重注册；30s是已有开发实现的间隔，不是MA登记合同。注册恢复按实际持久化/生命周期验收，不能假定所有宿主重启都会清目录 |
| **镜像同步** | 卡内/业务App两个入口通过版本、共同基线和持久投递协调；正文已保存与镜像送达分别报告。不得把写完“顺手 PUT”当成可靠双写，正文按增补合同 |
| **open-editor** | 画布把「这张卡归你编辑」的请求发过来：`{nodeId, filePath, canvasId?}`，你返回能打开编辑器的 `openUrl` |
| **画布文件通道** | 卡片里的 `filePath` 为画布侧逻辑锚点；交换画布工程文件用 `GET/PUT /api/apps/canvas/instances/:id/files?path=`，可经业务 App 的 P17 转发。App 自有正文/资源另走自己的 API，不把 filePath 当全局资产主键 |
| **事件订阅（半个）** | 可选：订画布的卡片增删改事件流，卡变了你能知道 |

关联语义：文件路径是有实例作用域的内容定位符，不是唯一绑定身份。doc 当前绑定域为 `teamId + mirrorCanvasId + nodeId`，解析出明确 docId；其他 App 在自身合同中定义。两边不互查对方私有数据库。

## 七、前端交付形态

**默认形态：npm 组件包。** 你的编辑器界面写成 React 组件，发到有权限且在发布清单中固定的包名（本项目示例 `@ks-designai/doc-surface`），画布/宿主 `import` 进来挂载：

```tsx
import { DocumentEditorPane } from '@ks-designai/doc-surface';
<DocumentEditorPane api={api} document={doc} />
```

**同时要有一个独立壳** `apps/web`：同一套组件放进一个能独立打开的页面里（验证自闭环用）。组件和壳共用同一套数据接口（如 doc 的 `DocDocumentApi`），只是挂载环境不同。

**宿主挂载缝（新 App 进「+」菜单/页签的口子）**：包发出去后在宿主侧登记一行——画布仓 `apps/web/src/app-surfaces/index.tsx` 的 `APP_SURFACES` 表加 `{appId, label, icon, surface}` 条目 + `openTab` 映射（点「+」时怎么建卡、怎么开详情页签）。这是我们拥有的画布适配登记位置，新增能力仍按实际公开入口核验，不能承诺所有新 App 只改一行；登记后加卡菜单、页签、详情打开按目录驱动，App 被 deny/注销时入口自动消失。

上段仅指我们自己维护的画布工作台；不适用于外部 MA 基座。外部宿主遵守 §4.6，由其所有者按既有安装/发布机制接收交付包，我们不修改其挂载逻辑。

## 八、环境变量规范

| 变量 | 用途 | 必需? |
|---|---|---|
| `<APP>_SERVER_PORT` | 服务端口 | 否（有默认） |
| `<APP>_PUBLIC_ENDPOINT` | 对外通告的自身地址 | 自注册时需要 |
| `<APP>_REGISTER_TO` | 画布地址，有则启动时自注册 | 否 |
| `CANVAS_ORIGIN` | 画布地址，文件桥转发用 | 接画布时需要 |
| `<APP>_DATA_DIR` | 显式隔离测试数据或可丢弃缓存目录；不是云端业务的回退存储 | 按实际入口显式配置绝对路径 |
| `APPWRITE_*` | 自有Appwrite存储连接与后端凭据 | 正常开发/联调的权威存储需要；缺配置明确不可用 |
| `TEAM_PERMISSIONS_URL` | 历史内部权限适配配置；不代表 MA 官方接口 | 未约定前 P19 返回显式未配置，不因此允许业务写入 |

## 九、安全与可验证性

- 所有 `?path=` 参数必须消毒：拒 `..`、拒空段、限后缀白名单（参考 doc 的 `sanitizeLogicalPath`）
- 跨App调用仅使用对方已发布的公开合同，不访问其私有实现或数据库
- 未配置的能力显式报 `501/503`
- commit 邮箱必须公司域 `@kuaishou.com`，否则 GitLab 拒收

## 十、交付自检表（Definition of Done）

逐项提供真实执行与读回证据；源码存在、命令退出或构建成功不能单独证明业务可用。按角色/目标 profile 判定适用项；N/A 写原因。包安装、模拟宿主、正式登记、Agent、staging 分开验收，详见手册 §11：

- [ ] 按实际仓库规则执行安装（依赖变化时）、guard/typecheck、包级测试/构建和真实运行；不使用本仓禁止的根 build/test 别名；已有失败记录原因和范围
- [ ] 不配任何画布变量，App 能独立启动、核心功能可用（自闭环）
- [ ] 设 `<APP>_REGISTER_TO` 重启后，`GET <画布>/api/apps` 能看到自己
- [ ] `GET /api/apps/<appId>` 返回 manifest，声明的动作都有实现
- [ ] 画布建卡 → `POST .../open-editor` → 拿到本 App 地址和 filePath
- [ ] `POST /api/apps/<appId>/open-editor` → 拿到能打开的 openUrl
- [ ] 经文件通道写入 → 画布侧读回内容一致（双向实测）
- [ ] COI JSON响应带 `requestId`，错误带 `code/message/retryable`；MA Provider按§4.5直接返回其信封；文件字节/SSE按所属传输合同
- [ ] 未配置的能力全部显式 501/503
- [ ] **租户**：本地 header 测试验证过滤；部署另用已验证身份测试团队/资源授权和绕过菜单直调拒绝。新资产带正确 teamId/actor，自报头不算生产认证
- [ ] **MA Provider 口**：`/open-platform/v1/instances/:pid/actions/:actionId` 走通 create→read→write 一轮：create 幂等（同完整MA归属域及pid解析到同一业务实例）、`expectedRevision` 过期返回 409、响应形状过网关校验（protocolVersion/revision 正整数/summary）
- [ ] **注册韧性（仅COI自注册profile）**：按实际重注册/持久化策略验证宿主重启后的目录恢复；不向MA发送COI心跳
- [ ] **绑定**：带 `nodeId` 建资产 → `GET .../bindings` 出现 active 行；归档资产 → 绑定转 archived
- [ ] README 写明：结构、自闭环验证方法、环境变量、启动命令、未实现清单
- [ ] 适用的云端深编辑补验：存储标识/索引与旧键兼容、检查至提交的实例并发保护、持久回执及不确定写处理、按可信身份隔离的草稿恢复、私有导出下载授权；案例与验收边界见[草图接入案例](sketch-integration-cases.zh-CN.md)
- [ ] 涉及云状态、宿主凭据工厂或vendor制品时，按[统一交付增补](unified-app-delivery.zh-CN.md)验证实际codec读回、提交失败恢复、旧身份回调隔离及最终制品与lockfile一致性；测试替身未经过真实codec不能替代此项
- [ ] npm交付从registry下载固定版本核对integrity；未发布tgz明确标注模式并核对SHA。仓外验证JS/类型/CSS/字体及纯Node manifest入口；README分别记录Git、包、登记、Agent和部署的实际状态

## 十一、历史资料

旧doc状态及本地API样例已迁至 [历史COI资料](legacy-coi-examples-20261020.zh-CN.md)，仅用于追溯。新开发使用本文精确合同、白皮书流程及当前实际安装CLI的schema/help，不从旧样例继承无版本写入或认证默认值。
