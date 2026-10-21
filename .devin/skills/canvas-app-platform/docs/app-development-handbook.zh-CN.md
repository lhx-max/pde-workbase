# 独立 App 开发手册：从零背景到交付验收

版本：2026-10-21。读者：没有历史对话的新开发者或 Agent。

本手册规定开发决策、责任和交付流程；具体字段沿用已有合同，不创造第二套 HTTP 协议。**规范要求、源码实现、本地验证、正式登记、staging 验收是五种状态**，必须分别记录。包装发布状态由对应发布任务维护，不能从本文推断某个包已经发布。

## 1. 先建立正确概念

### 1.1 产品与交付物

| 名称 | 是什么 | 不应混同的对象 |
| --- | --- | --- |
| App | 有业务能力、权威数据与公开 API，能通过独立壳运行，也能嵌入宿主的小产品 | 一个 React 组件、一个卡种或一个 npm 包 |
| App 后端 | 校验权限、版本、输入，执行业务、持久化、返回结果的服务 | npm UI 包；宿主数据库 |
| surface | App 可嵌入的 React 界面，使用公开 props/API 适配器 | 独立 Web 站点；自带另一套服务端 |
| 独立壳 | 挂载同一 surface 的 `apps/web`，供独立使用和自闭环验收 | 另一套编辑器实现 |
| 卡片 | 画布中的一个实例；有卡片 ID、kind、位置、尺寸、标题与业务内容/引用 | 一整个 App；每张卡一个 npm 包 |
| 卡包 | 提供一种或多种卡片渲染器及可选服务端动作的 npm 包 | 每个卡包都要自建后端/数据库 |
| 宿主 | 安装组件、管理页面/标签与上下文的应用 | 数据库；Agent 执行环境 |
| App 包装层 | 把某个宿主的 context、文件、会话等合同转成 surface 需要的 props/API | 修改宿主 SDK 或复制编辑器业务 |
| CLI | Agent/人使用的命令行 HTTP 客户端，调用同一个权威后端 | 第二份数据存储；安装后自动被 MA 发现的工具 |
| Skill | 解释能力发现、参数、调用顺序及错误恢复的说明 | 认证凭据；可执行权限；工具安装本身 |
| manifest | 某个协议中的能力/安装声明 | 可执行实现；权限凭据；运行验证报告 |
| Provider | 外部 MA open-platform 信封到 App 业务服务的适配入口 | 身份提供方；只要 actor 有值就可信的公开 API |

“宿主”有两层：**画布工作台可以宿主文档编辑器；一涵 MA-V 又可以宿主整个画布 App 和文档 App**。同一个 App 可以有多个宿主适配器，不为每个宿主复制业务后端。

### 1.2 三条实际连接

```text
渲染/安装：业务卡包 → 画布组件 → MA-V 的画布 App 包装层 → MA-V 标签
                        文档组件 → 文档 App 包装层 → MA-V 标签/画布详情

人操作：surface → 注入的 API/transport → App 后端 → App 权威存储

Agent 操作：MA 执行环境 → 已安装 CLI 或已注册工具 → 认证网关/Provider
                                                → 同一个 App 后端/存储
```

npm 交付代码，不替代应用登记，也不部署数据库。卡包安装到画布；surface/包装层安装到宿主；CLI 安装到 Agent 的执行环境；后端独立部署。宿主安装 UI 包时，不要求复制部署一份 App 后端。

### 1.3 该做哪一种

| 需求 | 最小开发面 |
| --- | --- |
| 新增一种展示/轻编辑卡，内容只是可序列化 JSON | 卡包，使用 `data` 和 `onPatch`，文件走 `ctx.files` |
| 卡片有复杂编辑器、资产生命周期或独立使用价值 | 独立 App；卡面/入口可另提供卡包 |
| 已有 App 要接入 MA-V | surface + MA-V 包装层 + MA manifest + Provider，复用业务服务 |
| 已有 App 要给 Agent 用 | 公开动作与 schema + CLI/工具接缝 + Skill，复用业务服务 |
| 移动卡、改尺寸、连线、排列 | 画布动作，不给每个 App 再造一套布局 API |

不是所有 App 都必须绑定卡片：独立创建的文档可以没有画布；从卡片打开的详情必须找到**原绑定实例**，不能顺手创建另一份文档。宿主某入口是否同时建卡，是该入口的产品规则，不是全局一一对应规则。

## 2. 一次开发先写一份合同

在新 App 仓复制 [APP_CONTRACT 模板](../templates/APP_CONTRACT.template.md) 为 `docs/APP_CONTRACT.md`。先填实际业务目标、动作、数据归属、宿主 profile 和验收出口，再写代码。`待提供` 是有效状态，但不得伪造外部接口补空。

| 必填信息 | 需要做出的决定 |
| --- | --- |
| 身份 | appId/slug、包名、kind、actionId、moduleId/exportName 各自是什么 |
| 功能 | 最小独立任务、编辑卡入口、Agent 任务各一个 |
| 权威数据 | 每种实体由谁保存；谁仅保存引用/镜像；复制和归档的含义 |
| 接缝 | 组件 props、业务 API、COI、MA Provider、CLI 分别支持什么 |
| 运行 | 本地/staging 的地址、认证来源、存储模式、单写者限制 |
| 失败 | 冲突、断网、不确定写入、权限失败、取消/重试如何处理 |
| 验收 | 复现命令、测试数据根、UI 路径、回执、重开及失败证据 |

开发者可以独立决定内部模块组织；影响外部协议、权威数据或宿主接口的决定要写入合同。外部缺项写成“接口/字段/提供者/阻塞哪道验收门”，不要停在“需要对齐”四个字。

## 3. 责任、ID 与数据归属

### 3.1 谁负责什么

| 责任方 | 拥有 | 不能靠它证明 |
| --- | --- | --- |
| 外部基座 | 身份/组织、应用发布与实例、会话关联、宿主标签、MA 调度 | 我们的正文已保存、App 内部版本正确 |
| 画布 App | 卡片/连线/布局/画布版本、可发现的卡种、卡↔App 关联接口 | 文档正文镜像一定已送达 |
| 业务 App | 业务正文/资源、资产元数据、条件写、冲突与生命周期 | 身份来自自报 header 就已认证 |
| 卡包 | `data` 格式、卡面渲染、自定义动作语义 | 自行更改画布信封、另开本地存储绕过持久化 |
| surface/包装层 | 编辑草稿、状态显示、API 适配、宿主生命周期对接 | 客户端校验可以替代后端授权 |
| CLI/Skill | 能力发现、请求编排、错误报告、读回确认 | Agent 环境已安装、已授权、已能访问服务 |

应用方适配对方已发布合同；不修改一涵的宿主、共享 SDK、菜单或 MA 调度来证明接入成功。宿主确有缺口时，提供最小复现和所需能力，由其维护者处理。

### 3.2 ID 不能互换

| 字段 | 语义 |
| --- | --- |
| `appId` / MA `manifest.slug` | 人可识别的能力标识，例如 `doc`；两者的对应关系由适配器声明 |
| npm 包名 | 代码分发名称；不从 appId 自动推导 scope 权限 |
| `kind` | 卡种，例如 `card.acme.brief`；不是实例 ID |
| `nodeId` | 某张画布内的卡片 ID；绑定必须连同画布和团队校验 |
| Canvas 内部 `projectId` / COI `instanceId` | 当前实现的画布数据身份；不是外部项目 `bizId` |
| MA `bizId` / `sessionId` | 外部业务空间/会话，由基座提供 |
| MA `applicationId` / `applicationInstanceId` | 正式登记的应用/实例身份，当前分别匹配 `app_...` / `ai_...` |
| `providerInstanceId` | 外部实例在 Provider 的解析键，可能是别名，不保证等于 docId 或画布 ID |
| `docId` / 其他 App 实例 ID | 业务 App 保存正文/业务状态的身份 |
| `projectFilePath` / `mirrorPath` | 受实例作用域约束的相对路径；不是全局资产主键或授权凭证 |
| `operationId` / `idempotencyKey` | 一次逻辑写入的稳定身份，不是业务实例身份 |

示例：当前画布 Provider 用 `tenantId + applicationId + providerInstanceId` 解析内部画布，不能把外部 `bizId` 直接当画布 ID。文档 Provider 可以用 `ma:<pid>` 别名找到正文。实现参见 [画布 Provider](../../../../apps/server/src/routes/canvas-provider.ts)。

### 3.3 权威存储与文件

- 画布信封和布局由画布服务保存；纯卡片业务 JSON 可以由画布状态承载，卡包无需独立数据库。
- 有权威业务 App 的正文由该 App 保存。画布里的文字、预览、文件可以是可编辑镜像，不是第二个盲覆盖源。文档双入口遵循 [正文增补合同](document-sync-contract.zh-CN.md)。
- App 可用自己的 Appwrite 存储，或者显式本地模式；独立性指责任隔离，不要求每个 App 自建数据库引擎。不同服务不直查/写对方私有库。
- App 自有资源走 App 文件 API；画布工程镜像走画布文件通道；卡包文件用平台注入的 `ctx.files`。**不得把“共享文件通道”理解为给 App/浏览器发另一服务的桶凭据。**
- 资产使用的既定产品语义是复制：授权读取源版本后创建新的可编辑身份、文件与归属。只有显式选定“打开既有绑定”才编辑同一实例。
- 删除/归档如何保留正文、解除绑定、恢复要写清楚。不能让迟到的旧解绑通知删除新的 active binding。

云端业务数据位置见 [数据模型](data-model.zh-CN.md) 的当前设计；本地绑定索引、回执、同步队列与云表不是同一件事。不能因“不新建云绑定表”删除已用的协议/本地恢复机制，也不能凭有一个 `.ts` 文件宣称云表已初始化。

## 4. 代码怎样分层

```text
designai-app-<id>/
  apps/server/src/       领域服务、路由、认证/Provider 适配、存储入口
  apps/server/tests/     业务/协议/存储测试
  apps/web/              独立壳，挂载同一编辑器
  packages/<id>-surface/ src/、tests/、构建与包出口
  packages/contracts/   可选：需要跨包共享的纯 DTO/schema
  packages/<id>-cli/     采用 CLI 交付时使用；实际包名按发布清单确定
  docs/APP_CONTRACT.md   本 App 实际接入合同
  docs/verification/    可复现记录与已知限制
```

这是职责模板，不是要求复制空目录。现有仓库按已存在边界实施，不为符合目录图重构。新代码 TypeScript；本项目 Node 24、pnpm 10.33.2、React 18。服务端不得导入 surface 私有实现，浏览器不得导入存储/凭据模块。

独立启动和嵌入使用同一业务 API 与组件。不要为了嵌入成功改成直接读宿主文件，也不要在包装层再维护一份正文。数据根由入口显式解析并注入；禁止依赖另一个 checkout、cwd、开发者绝对路径或本机 symlink。

doc 参考仓为 [公司 Git `design/designai-app-doc`](https://git.corp.kuaishou.com/design/designai-app-doc)，私有仓、默认main，需相应Git读取权限。可以读它的公开接口/测试、按其许可证和来源要求适配代码；不能把作者本机目录写进新 App 的 package.json。参考仓不可用时按本手册与合同实现最小领域服务，不猜其私有 API；若某宿主类型/schema不可得，则相应接入门标待提供，独立业务继续做。

### 4.1 surface 的最低合同

- 声明 props、必需 API 方法、可选能力以及未配置行为；`read/write` 与版本化 API 的能力差异明确。
- 导出实际 TS 类型和 CSS，组件不自行登录或内置服务端密钥。
- 文档独立壳与卡片详情使用同一编辑器与同一版本化读写适配器；画布 surface 另有公开 `transport` 和 `uiHost`，见 [包说明](../../../../packages/canvas-surface/README.md)。
- 只有经认证的配置决定 API/资源地址；不能从任意 URL 查询参数读取带凭据的服务地址。下载、图片、Range、上传、SSE 要分别核可达性与授权。
- dirty 草稿不能被轮询、旧读取或迟到保存覆盖。状态至少区分 loading、saving、saved、offline/error、conflict；需要镜像时另显示同步状态。
- 实例切换先保存/flush；失败保留草稿并阻止受控切换。只使用宿主已提供的生命周期；没有相应接缝要记录限制，不能承诺强关/断电不丢尚未提交的输入。
- 当前画布有模块级 host bridge，同一 JS realm 多活动实例未认证；默认一次挂一个，A/B flush/unmount/switch 单独测试。
- 共用宿主的一份 React renderer；不打包另一份 React 消除 peer 冲突。当前画布包锁 React/ReactDOM 18.3.1、xyflow 12.8.5；将来兼容矩阵由实际包版本与目标宿主测试决定。
- 卡面复用画布现有壳和CSS变量，不重画平台UI；独立编辑器由App负责，但应说明最小宽高、滚动、焦点/快捷键、弹层挂载与样式作用域，不能让全局CSS污染宿主。原生浏览器、媒体/模型、导出、文件选择等能力用已提供适配器；未接入就显式不可用，不在surface私自恢复原桌面平台。

### 4.2 后端与存储的最低合同

- 输入、文件路径、实例、action、响应按 schema 校验；路径穿越、符号链接和跨实例引用不可放松。
- 读和写都检查真实身份、团队、目标实例、动作权限；查不到授权 provider 时 fail closed。
- create 先定幂等绑定；read 返回真实状态/版本；write 校验版本与基线；archive/copy/restore 作用域明确。
- UI/API/Provider/CLI 使用同一领域服务和持久化实现。动作逻辑不复制到每个传输入口。
- 存储后端明确 local、Appwrite、持久操作日志/队列。部署必须声明可承受的单写服务进程数、恢复与备份；进程内锁不是分布式 CAS。
- 异步生成需声明任务 ID、queued/running/succeeded/failed/cancelled、回执/结果、取消与幂等。没有任务能力时先交付同步最小功能，不声明虚构事件/进度。

## 5. 三套接口分别怎么用

| 接口 | 调用者/作用 | 合同来源 |
| --- | --- | --- |
| App 自有 API | 独立壳、surface 适配器；业务领域接口 | App 公开 schema/DTO 与实际路由 |
| Canvas COI / P1–P24 | 我们的画布平台目录、动作、文件、绑定、CLI | [App 规范 §4.2](app-development-spec.zh-CN.md#42-统一协议合同v1唯一标准) |
| MA open-platform | 外部基座通过 Protocol `1.0` 调 App Provider | App 规范 §4.5–§4.6 + 目标基座真实合同 |

**P1–P24 是角色分工，不是每个 App 实现 24 个服务端路由。** 目录/注册/代理/治理由我们拥有的画布宿主实现；业务 App 提供自己的 manifest、实例/动作及适用文件接口；卡包通常不写 HTTP。不适用的能力说明 N/A 原因，不伪造成功路由。

COI manifest 用 `actionId/mode/async` 等字段；MA manifest 用 `id/effect/inputSchema/requiredPermissions` 等字段，不能直接互换。相同的业务词表通过显式适配映射；新增参数要同步 schema、版本和实例迁移计划。

注册到我们画布目录的 `endpoint` 是**协议根**，例如 doc 的 `https://<service>/api/apps/doc`；MA 的 `provider.baseUrl` 则是按网关约定拼 open-platform 路径的根。这两个地址不能共用一条未经转换的配置。宿主 `fileClient` 管的会话文件与 App 自有资产/正文、画布工程镜像也不是天然同一份存储；若业务要互换文件，明确授权、导入/复制及文件ID映射，不直接把路径或文件ID混用。

### 5.1 写入、幂等与回读

执行顺序：**发现能力 → 定位获授权实例 → 读状态和版本 → 校验输入 → 提交 → 回执/状态读回 → 同实例 UI 确认**。

- 画布 COI 批处理：`POST .../instances/:id/operations`，顶层 `{operationId, baseRevision, operations}`。
- COI 单动作：`POST .../instances/:id/actions/:actionId`，`{input,expectedRevision}`，幂等键在约定 header。不得把批处理信封随便塞给一个单动作。
- MA Provider：顶层 `expectedRevision` 是 Provider 正整数版本；画布当前投影为 `coreRevision + 1`，不直接当 COI `baseRevision`。
- doc 正文版本当前为 SHA-256 字符串，正文基线/版本在业务 `input` 中；Provider 外层整数版本是另一层检查，不能自动代替正文基线。严禁“先读取最新基线再盲覆盖过时用户稿”。
- 不确定写入保留原逻辑操作 ID 和请求体，先查回执；重试、409 解决和业务重复创建是不同动作。回执范围（内存/持久、保存期限）必须公开。
- 400 参数错；401/403 身份/权限错；404 实例或动作不存在；409 冲突；428 缺前提；501 未实现；503 未配置/不可用。实际错误码按所属 API，不把所有失败都变成 200。
- 正文保存成功与镜像同步成功分别确认。网络超时不能显示“已保存”，模型回复“完成”不算回执。

当前 CLI 的 `apps call --body-file` 把文件作为 `input` 封装；它不能因此表达所有顶层版本/幂等字段。需要完整 COI 写信封时，用已存在的 `request` 通道或发布任务确认后的 CLI 扩展，**不得把未来 CLI 参数写成今天已支持**。

## 6. 怎样嵌入画布卡片

分两件事验收：卡面挂载；卡片与 App 资产互联。卡包脚手架见 [卡包合同附录A](canvas-card-pack.zh-CN.md)，不是另起一套渲染框架。

1. 卡包按 [卡包合同](canvas-card-pack.zh-CN.md) 提供 `card.<team>.<name>`、`dataVersion`、渲染器及可选动作。核心 kind 覆盖按平台已有覆盖合同处理，不能借新卡包未经授权抢占保留前缀。
2. 前端把卡包登记进 `packages/canvas-workbench/src/packs.ts`；服务端 `./server` 纯服务入口登记进 `apps/server/src/card-packs.ts`。服务端也要登记卡种，无 handler 也不能省略，否则创建会被拒绝。
3. 卡壳/布局归画布，内容渲染/轻编辑归卡包；数据更新走 `onPatch`/公开动作，文件走注入文件端口。服务端不能导入 React 卡面。
4. 有深编辑 App 时声明 `editorApp`/`editorKinds` 对应关系；明确 card→业务实例映射、权限与打开参数。目录里有 App 不代表卡种 renderer 已安装，反过来也一样。
5. 新卡首次提交正文按业务约定建立资产；再次编辑找回同一绑定。打开既有详情默认读，不因镜像与权威正文不同自动回写覆盖。
6. 验证“卡内编辑→App读回”“App编辑→卡片更新”“复制后独立”“归档/恢复”“A/B 切换”；纯卡包 N/A 的部分写清理由。

现有核心卡不能假设一个 `node.update` 适用全部类型。图片用图片动作；草图、视频、分镜各有领域动作。查询 live `cardCapabilities`，以 [能力矩阵](canvas-card-capability-matrix.zh-CN.md) 的验证范围为参考。

## 7. 怎样嵌入一涵 MA-V

### 7.1 兼容基线与实际 props

本次核对基线为 `design-ai-client/yihan-dev-ma@fa9475183`、Plugin SDK 1.0.0；这是可更新的兼容记录，不是不可变公司标准。目标 schema 位于该仓 `packages/contracts/src/api/ma-applications.ts`。

MA-V 目前实际向组件传 `context/fileClient/conversation`。SDK 可选的 `providerClient` 不等于宿主一定注入；`registerBeforeLeave` 和画布 `transport` 不是该宿主已保证的 props。包装层从已有公共配置/接口适配必需能力；缺口写明，不要求修改他的源码。

### 7.2 三个独立登记动作

| 层 | 安装/登记什么 | 谁做 |
| --- | --- | --- |
| 代码 | npm surface/包装层进入宿主构建 registry，命名导出与版本可解析 | 交付方提供包；宿主维护者按既有机制安装 |
| 目录 | MA 应用 manifest 发布，Provider 地址、动作和权限可发现 | 交付方给 manifest；基座正式机制登记 |
| 业务 | 创建实例、初始化 Provider 数据、关联会话、打开标签 | 基座与 Provider 按约定流程；不让 read 隐式变成 write |

`POST /api/apps/register` 是我们的画布注册，不是 MA 后端的登记 API。npm publish 也不是正式应用发布。当前没有核实 MA 发布 API 时，只交付登记文件和验证结果，不发明端点或直接写表。

### 7.3 MA manifest/Provider 交付要点

- `frontend.moduleId/exportName` 与实际 registry 相同；manifest、后端 `currentVersion`、实例 `applicationVersion` 与包装层的兼容版本对齐。依赖的 surface 可有自己的版本，记录在 BOM，不能机械要求所有 npm 包版本都相同。
- `provider.baseUrl` 是完整可达 URL；Protocol 版本是字符串 `'1.0'`。动作有精确 schema、effect、权限；不能只给 `operations[].type=object` 就声称模型能可靠构造操作。
- `app_...` / `ai_...` 正式 ID 由基座签发。只在显式模拟模式可生成测试 ID，并与真实目录/会话标签隔离。
- Provider 验证可信调用方、租户和实例，再把固定信封转成业务操作；path/body/action/版本一致。actor/permissions 文本不是签名或身份票据。
- 当前画布 Provider 是显式 loopback 开发模式；doc Provider 的 actor 以可信上游为前提。两者都不能因为本地 200 就直接公开到 staging。
- 若部署到函数，必须核对函数执行外壳与 HTTP path/method/body/响应之间的映射；不能默认“函数 executions URL 加业务路径”可直接访问。

## 8. CLI 与 Agent 运行接缝

CLI 与 UI 是同一个 App 的两个消费者。我们交付可安装包、版本、Skill、配置清单和最小读写任务；MA 维护者负责在其执行环境安装、授予适当网络与凭据、把实例上下文传进调用。

| 要交付 | 最低要求 |
| --- | --- |
| CLI 包 | 独立 npm/tgz、可执行 bin、固定版本、Node 要求、无源码/workspace 路径依赖；安装不启动另一个后端 |
| 配置 | 服务地址、身份凭据来源、团队/调用者、实例 ID/映射；CLI 收到的本机地址必须从 MA 运行位置验证 |
| 行为 | 机器可读输出、失败非零退出、稳定操作 ID、版本与错误透传；不打印凭据、不自动重试不确定写 |
| Skill | 何时调用、能力发现、读版本、参数示例、回执/readback、冲突/离线恢复；引用安装包的实际命令 |
| 验收 | 干净目录安装且源码不可达仍能运行；连接真实测试服务完成一笔写入和失败路径 |

当前 `canvas-server` 源码已有 `apps list/call/state/bindings/entitlements/audit` 及 `request`，地址为 `CANVAS_SERVER_URL`/`--server-url`，传输 token 为 `CANVAS_AUTH_TOKEN`，本地身份为 `CANVAS_TEAM_ID/CANVAS_USER_ID` 或 flags。**这些身份 header 不是生产委托能力。独立 CLI 包的实际名称、安装命令与发布状态必须由发布清单给出。**

`动作说明进提示词`、`前端关键词预执行`、`MA 真实 tool-call` 分别记录。只有获得执行权限的 MA 自己生成参数并发起调用，且网关/Provider 回执与状态可关联，才报告自主调用通过。

## 9. 环境、认证与发布

### 9.1 每个 profile 明确三种地址

| 地址 | 从哪一端可达 | 检查 |
| --- | --- | --- |
| 独立 Web/浏览器 API/资源 URL | 用户浏览器 | Origin、登录态、CORS、CSS/字体/图片、上传/下载/SSE |
| Provider 服务 URL | 基座服务/网关 | 解析、TLS、路由外壳、可信调用方认证、超时 |
| CLI 服务 URL | MA 执行环境 | 包安装、网络访问、身份委托、实例映射 |

本地 `127.0.0.1` 在远端容器指容器自身。禁止把开发者目录、固定端口或代理 fixture 写入生产包。构建变量是否可在部署时修改要写清楚，不能声称静态 JS 总能读服务端环境变量。

profile 至少区分 local 独立运行、local 宿主联调、staging。生产不静默降级到本地文件库或 `local/local`；存储缺失应启动失败/503。Appwrite 单写者限制、持久队列卷、备份和重启恢复属于部署合同。

### 9.2 认证不是显隐

显隐表/卡种 grant 控制能力可用范围，不能替代用户认证、团队成员资格或资源授权。`platform` 范围不代表资产公开。服务端必须独立拒绝绕过菜单的直接请求；身份缓存缺失不得新建信任。SSO、传输 token、委托凭证、actor ID 分开说明。

开发者访问遵守 [只读合同](../../../../docs/developer-read-only-access.zh-CN.md)。本项目两个开发库/桶已按用户要求配置为“已登录用户默认读、显式维护/服务身份写”，无需逐个申请读者名单，且限制两条写函数的执行者；实测见 [只读验收](../../../../docs/verification/developer-readonly/README.md)。这不是所有生产App/业务团队资产都应开放全库读的通用授权规则。通用服务token不是只读token，开发者不运行初始化脚本；写入联调在隔离环境进行。

### 9.3 包发布的最低交付

公司内交付使用经确认的快手内网 registry 和 scope 权限；本仓 `.npmrc` 当前已为 `@ks-designai` 和 `@ks-kp` 配置内网地址；**不能据此推断其他 scope 会自动发到内网**。最新实际包名/固定版本及状态见 [仓库README](../../../../README.md)。发布任务明确 `publishConfig.registry`/发布参数、包名所有权和固定版本，不把凭据写进包。

交付清单至少列：surface、宿主包装层（独立包或与 surface 同包）、可选卡包/纯服务端入口、CLI、Skill、MA manifest、后端部署版本、schema/协议版本、已测 peer 版本、包完整性摘要、证据和限制。版本锁定并允许回滚；数据迁移另外写兼容策略。不要将已有 npm 版本原地替换。

## 10. 零背景 Agent 的执行顺序

| 步骤 | 交付出口 | 没通过时怎么办 |
| --- | --- | --- |
| A 定位 | 读 AGENTS/本手册/任务对应合同；记录真实仓库、branch、dirty 状态、相关实现 | 保留用户改动，不猜目录/分支 |
| B 定义 | 填 APP_CONTRACT，定 App/卡包、权威数据、动作/schema、profile | 未知外部项列成具体依赖，继续独立部分 |
| C 业务闭环 | 本地独立服务＋存储＋独立壳；完成 create/read/write/archive 的适用任务 | 先修业务与持久化，不靠宿主垫数据 |
| D 卡片互联 | 安装卡包、登记服务端 kind、建立绑定、同实例深编辑/同步 | N/A 或记录冲突，不复制正文规避同步 |
| E 宿主适配 | 按原 SDK 提供包装层、manifest、Provider；用未修改宿主装包打开 | 缺公共能力提交最小缺口，不修改对方 |
| F 分发 | 干净环境安装组件与 CLI；版本/注册/CSS/资源检查 | 源码依赖或绝对路径仍存在则交付未完成 |
| G 联调 | 本地模拟可验证登记 UI/真实本地读写；正式环境再验认证/目录/实例 | 严格标 mock 边界，不写云端成功 |
| H Agent | 在真实 MA 环境验证发现、调用、状态读回和 UI 变化 | 保留标准安装接缝，标未验而非改模型调度 |
| I 收尾 | 更新合同/证据/兼容清单/README；列交付状态与复现命令 | 不把计划、源码和发布状态混成一个完成项 |

只改文档时检查引用、语义和可执行例子；改代码时按所在仓要求安装/guard/typecheck/包级测试和构建，再做真实运行。使用实际 package scripts，不照抄另一仓的根 build/test。全仓已有失败必须记录具体原因，不算新能力通过，也不顺手修无关模块。

## 11. 验收分级：闭环到底闭在哪里

| 门 | 通过信号 | 不能代替它的证据 |
| --- | --- | --- |
| 独立 App | 独立壳完成业务，刷新/重启仍在，版本冲突有保护 | 只有组件截图或 HTTP 200 |
| 卡片互联 | 同一绑定双向读写，复制隔离，归档/旧回调正确 | 打开一个长得相同的新文档 |
| 可安装 | tarball 干净安装，类型/CSS/运行均通过，无外部源码依赖 | monorepo workspace 或软链可跑 |
| 模拟宿主 | 未改宿主，明确 fixture，真实组件/本地服务，刷新恢复 | 云端正式注册、生产安全、多租户已通过 |
| 正式接入 | 正式目录→实例→会话→打开→认证调用→持久化 | 本地模拟菜单出现 |
| Agent | run/tool-call→网关→Provider→回执→同实例 UI/readback | 前端先执行、CLI 人工写入后模型复述 |
| staging | 同一交付版本、远端网络/认证/存储、重开/权限/失败验收 | 本机地址换成 staging 字符串 |

每个适用门都做：正常写、重放、旧版本409、缺基线428（适用时）、断网/超时、不存在实例/动作、未授权读写、A/B切换、刷新/重启。身份隔离需真实已验证身份；改 header 的开发测试不能冒充生产授权验收。

证据至少含：commit/包版本/profile、命令/操作、测试时间、专用实例、前后版本、稳定操作ID、回执/错误、读回断言、UI截图（适用时）、限制与复现。不得含 token/cookie/私钥。文档与测试用语一致，不使用“完美注册”“全合规”替代逐门结果。

## 12. 从哪里继续查

| 要查 | 文件 |
| --- | --- |
| 精确 P1–P24、MA Provider 形状 | [App 开发规范](app-development-spec.zh-CN.md) |
| 卡包 API/命名/挂载/冻结区 | [卡包合同](canvas-card-pack.zh-CN.md) 与根 Skill |
| App ↔ 画布的打开、文件、事件 | [互联协议](canvas-app-interop.zh-CN.md) |
| 文档并发、持久同步、复制归档 | [正文增补合同](document-sync-contract.zh-CN.md) |
| 数据设计与现存实现的区别 | [数据模型](data-model.zh-CN.md) |
| 本轮规范修正与待工程实现项 | [规范审计](../../../../docs/app-development-standards-audit.zh-CN.md) |
| 当前双 App 的运行证据 | [关系与状态](../../../../docs/canvas-doc-relationship-and-status.zh-CN.md)、[MA 接入验收](../../../../docs/ma-base-integration-acceptance.zh-CN.md) |

发生冲突时：用户最新明确要求 → 对应宿主的实际已发布合同/仓库规则 → 本手册明确的适用范围 → 对应专项合同。外部合同决定外部信封，我们的规范决定内部责任；不能用任一方规则宣称另一方未经验证的能力已经存在。发现实现与合同不一致，记录为缺口并保留双方证据，不默默选容易跑通的一边。
