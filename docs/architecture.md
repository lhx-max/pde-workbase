# 独立工作区：边界、数据与适配器

## 1. 运行边界

```text
原画布／标签／查看器／画布·资产·采集侧栏
        │ HTTP + SSE / CanvasTransport
        ▼
独立 Canvas Server
        ├─ 项目注册与原画布 JSON
        ├─ 项目文件、预览、版本、产物清单
        ├─ 内建本地资产库：空间、目录、元数据、版本、保存与导入
        ├─ 浏览器偏好与采集持久化
        ├─ durable AgentTasks → 候选／交付／采用
        ├─ 原工作流图、执行状态机与结果交互
        ├─ 媒体适配器 → 原画布媒体交付
        └─ 浏览器资源桥 → 独立 Electron 原生宿主
```

提取基线为 Bezier/Loom `319e5eee556a3641d2ee68a6111a36ddc7a1eff7`。原工作区、资产目录／详情／保存窗口、浏览器与采集界面复用原组件及 CSS；不是重设计后的替代页面。当前边界包含用户选择的**内建本地资产库**，不再沿用初次提取时“全局资产库一律排除”的限制。它不恢复原聊天、账号、团队、原 daemon 或 Agent 运行时平台。

Web 不导入服务器私有实现；服务器不依赖 Next、原 daemon 或原聊天数据库。画布共享 DTO 位于 [画布契约](<../packages/contracts/src/api/canvas-workspace.ts>)，资产库协议位于 [资产库契约](<../packages/contracts/src/api/asset-library.ts>)，宿主接口位于 [canvas-workbench 公共出口](<../packages/canvas-workbench/src/index.ts>)。

生产 Web 通过 [运行时流式代理](<../apps/web/src/server/proxy.ts>) 转发 API、产物与 frame 请求。它在请求时读取明确配置的 `CANVAS_SERVER_ORIGIN`，不使用构建时固定端口，也不猜测已有本机服务。没有目标配置返回 503。代理保留流式 SSE、上传、Range、下载响应、浏览器 Origin 和作用域头；服务端传输密钥不会写入客户端 bundle。代理在注入凭据前校验 Host：默认只允许本机地址；配置 `CANVAS_WEB_URL` 后只接受该明确主机及端口。通过反向代理部署时必须正确配置这个外部地址，不能信任来访者自行提供的转发头。

`CANVAS_AUTH_TOKEN` 保护后端传输，不是 Web 用户登录系统。默认部署是本机单用户工作区；若把 Web 暴露到网络，必须另外配置访问认证与授权，不能把 Host 校验或后端传输密钥当成用户身份验证。

[tools-dev](<../tools/dev/src/cli.ts>) 是生命周期入口，统一传递地址、独立数据根和原生宿主密钥，并只管理自己启动的子进程。

### MF 开放 UI：独立文档、单一执行者

新增 MF 对话侧栏，不恢复旧聊天平台。MF SDK 位于独立文档 `http://mf.localhost:<webPort>/mf-ui/`，与 `127.0.0.1` 画布共用应用监听器、不同 origin。保留域名避免 SDK 的 localhost 开发 SSO 令牌提取分支；不提供 `/sso-health` 代理。MF 文档不能直接访问普通画布 API，服务端凭据不进入浏览器；此凭据模式仅支持本机单用户。

[MF 契约](<../packages/contracts/src/api/mf-integration.ts>)、[RPC 桥](<../packages/mf-bridge/src/index.ts>)与[MF 后端](<../apps/server/src/routes/mf.ts>)定义受控上下文、原生 HTTP/SSE/WS、任务登记、文件导入和交付。MF 登记不调用会立即执行的本地任务入口；生成绑定先规范保存，再由 MF 单独执行，只有明确交付才成功。取消禁止本地晚到写入，不承诺远端已停止计费。独立导入需宿主确认、排空保存，实际文件与画布节点持久化后才返回含摘要的完成回执。

画布包的 React 18 依赖约束没有升级，但 Next 16 的浏览器渲染器由框架自带，实测为 React DOM `19.3.0-canary-3f0b9e61-20260317`；MF 独立使用 `19.2.3`。两个文档各一份渲染器，不能把安装声明当成浏览器运行版本。配置、来源规则、新对话限制、可选查看器及云端待验清单见 [MF 接入与验收](<mf-integration.md>)。

## 2. 数据模型与文件组织

数据根约束以 [AGENTS.md 的 Safety and data](<../AGENTS.md#safety-and-data>) 为准。项目内容路径由原 [PROJECT_LAYOUT](<../packages/contracts/src/project-layout.ts>) 定义；不要重新发明另一套目录布局。

| 层次 | 保存内容 | 所有者 |
|---|---|---|
| 项目注册 | 项目 DTO、标签顺序、活动标签、浏览器标签 | [ProjectRegistry](<../apps/server/src/storage/project-registry.ts>) |
| 画布文档 | 原 state 键、节点、连线、分组、草稿及视口；保留未知字段 | [CanvasStateService](<../apps/server/src/canvas/state.ts>) |
| 项目输入／可编辑源／产物 | 原 uploads、collected、text、sketch、storyboard、image、video、page、presentation 语义 | [项目布局常量](<../packages/contracts/src/project-layout.ts>) |
| 文件版本与清单 | 原版本字节、当前版本指针、产物元数据、依赖关系 | [文件 API](<../apps/server/src/routes/files.ts>) |
| 本地资产库 | 原 PersonalAsset DTO、文件夹、空间、元数据、版本、使用记录、稳定采集请求身份 | [资产库存储](<../apps/server/src/storage/asset-library.ts>)、[资产库 API](<../apps/server/src/routes/asset-library.ts>) |
| 浏览器偏好 | 书签、参考网站、采集开关与修订；浏览器本地存储只用于兼容迁移／缓存 | [偏好 API](<../apps/server/src/routes/browser-preferences.ts>) |
| Agent 回执 | 稳定任务 ID、原始请求、执行状态、交付状态、输出引用与错误 | [AgentTasks](<../apps/server/src/services-tasks.ts>) |
| 工作副本／候选 | 授权输入快照、输入 digest、目标 digest、隔离输出与候选清单 | [artifact-workspace](<../apps/server/src/canvas/artifact-workspace.ts>) |
| 工作流与媒体 | 独立 SQLite 中的图版本、运行、步骤、输入快照、结果交互及媒体任务 | [workflow composition](<../apps/server/src/routes/workflows.ts>) |

画布状态 API 使用服务端返回的 `revision` 作为并发条件，不应假定它只是客户端可自行加一的计数器。提交 `expectedRevision` 和必要的 `base`；冲突处理保留原逻辑，不能通过去掉修订检查强制覆盖。

文件身份以服务端返回的 canonical path 为准。草图使用原 `.sketch.json` 格式；打开 pending 草图必须先读取真实文件，仅在确定 404 时创建空白内容。重命名先排空自动保存，再采用服务端返回的名称，不能继续向旧路径写入。

## 3. 原资产与采集界面的本地依赖闭包

[原侧栏](<../apps/web/src/components/CanvasAssetsSidebar.tsx>)保留“画布／资产／采集”三个入口；资产页由同一个 [AssetLibraryPanel](<../apps/web/src/components/AssetLibraryPanel.tsx>)服务紧凑侧栏与展开库。原类型导航、排序／隐藏设置、空间切换、目录面包屑、搜索／筛选、预览、评分、标签、收藏、复制／移动／删除、版本替换和文件夹上传由 [PersonalAssetLibrary](<../apps/web/src/components/PersonalAssetLibrary.tsx>)及其原组件闭包提供。设计系统等原导航入口不因缺少外部能力而被静默裁掉；没有配置的数据／目录能力必须如实显示空态或不可用。

[资产库 provider](<../apps/web/src/providers/asset-library.ts>)是唯一前端存储端口：默认访问 `/api/asset-library`，保留原 `{assets}`、`{asset}`、版本／内容／使用记录／空间响应形状；也可注入或选择外部实现。内建库的列表、文件字节、目录、元数据、版本和项目导入／保存不依赖外部供应商。`/info` 明确声明能力，AI 分析／Prompt 提取及外部目录不随本地库自动启用；未配置时不生成伪造结果。独立 CLI 使用同一 HTTP 边界，相关集成证据见 [资产库 CLI 测试](<../e2e/tests/asset-library-cli.test.ts>)。

### 空间与文件夹

空间是本地资产集合，不是团队账号或项目生命周期。空间内还可以有资产文件夹树。[空间选择器](<../apps/web/src/components/AssetLibrarySpacePicker.tsx>)复用原下拉菜单和 [空间编辑对话框](<../apps/web/src/components/WorkspaceSpacePicker.tsx>)，在权威读取及服务器确认后才关闭编辑、刷新缓存并持久化选择；失败保留输入。虚拟默认空间不可重命名或删除。移除普通空间默认移动资产及完整子树到目标空间；只有用户明确取消移动选项并确认删除，才请求永久删除这些资产。**这不是删除项目的操作。**

[空间缓存](<../apps/web/src/state/project-folders.ts>)按当前来源身份隔离。来源身份解析成功后才恢复该来源的已选空间，且不能覆盖显式打开请求或加载期间的新选择。跨异步操作捕获来源适配器；切换来源后，旧结果不能驱动新来源的编辑或选择。

### 保存与引用

[统一保存请求](<../apps/web/src/state/save-asset.ts>)接受名称、文件名、MIME／类型、文本／URL／`readContent(signal)`、来源／项目及可选 AI 能力。文本优先；打开窗口或取消不写库。每份已打开草稿保留稳定 `captureId`，网络失败后的重试复用同一身份；服务器对内容或元数据改变的同键请求返回冲突，不冒充同一操作成功。

[SaveAssetDialog](<../apps/web/src/components/SaveAssetDialog.tsx>)保留原元数据和 YAML 编辑，保存完成时解析请求；`inspectAfterSave` 可继续显示 [SavedAssetDialog](<../apps/web/src/components/SavedAssetDialog.tsx>)。卸载取消读取并忽略迟到内容；保存后的元数据修改携带原修订，冲突不覆盖未保存草稿。项目保存、采集保存与浏览器资源保存共用此生命周期。资产导入项目与画布接受是不同步骤；参考图先进入 [引用托盘](<../apps/web/src/components/WorkspaceReferenceTray.tsx>)，只有后续明确提交才成为 Agent 输入。

## 4. Agent 的最小契约

[CanvasTaskRequest](<../packages/contracts/src/api/canvas-workspace.ts>) 不要求 conversation/message ID：

- `requestId`：调用方稳定幂等键；不同内容不得复用同一个键。
- `prompt`：实际任务。
- `designSystemId` / `taskContext`：原界面选择的设计系统与目标上下文；保留给适配器，不取代服务端的版本校验。
- `canvasTextGeneration` 或 `canvasArtifactGeneration`：可选、互斥的画布目标绑定。
- `inputPaths`：明确授权的项目相对输入；不会默认暴露整个项目。

[AgentAdapter](<../apps/server/src/services-tasks.ts>) 接收回执、请求、隔离工作区和 `AbortSignal`。工作流还可以提供仅执行时有效的模型／提供商快照、系统提示和技能选择；这些信息不进入任务请求摘要和持久回执。

执行结果与交付结果是两个维度：

| 状态 | 含义 |
|---|---|
| queued / running | 服务端已接收／正在执行 |
| succeeded | 执行与规定交付步骤完成 |
| failed | 执行或交付失败；检查 error 与已有结果引用 |
| cancelled | 显式取消；拒绝迟到结果 |
| interrupted | 进程中断后的真实状态，不冒充自动续跑 |
| deliveryState=applied | 已通过目标版本校验，写回目标 |
| deliveryState=candidate_saved | 结果保留为候选，尚未采用 |
| deliveryState=delivery_failed | 没有成功完成目标交付 |

**保留原文本行为：** 绑定省略 `outputKind` 时是原画布的直接文本生成；显式 `outputKind: 'text'` 是候选模式，由调用方使用 adopt API 确认；`storyboard` 按原分镜交付流程应用。当前原生画布没有额外的文本候选 Apply 面板，不为此自行设计新 UI。

[createCanvasTaskSubmitter](<../packages/canvas-workbench/src/platform/task-client.ts>) 上传附件后提交，轮询持久回执，并支持 recover/cancel。`dispose()` 只停止前端观察，不取消服务端执行。关闭页面不应让服务端任务消失；重新打开从项目任务列表恢复绑定。

通用图工作流的结果确认继续已有运行／步骤的执行器，并验证项目、运行、工作流及步骤归属，不创建脱离图的第二份付费 Agent 任务。托管执行的服务端响应不再把内部继续提示交给前端重复提交；未托管的流程仍可交给外部宿主。旧业务 `workflowBinding` / `runArchive` 默认明确要求专用宿主适配器，不会静默丢弃归档语义。

## 5. 外部能力

- Agent：进程内 `AgentAdapter` 或 `CANVAS_AGENT_ADAPTER_URL`。
- 媒体：`MediaAdapter` 或 `CANVAS_MEDIA_ADAPTER_URL`；模型与配置从适配器发现，不内置真实供应商凭据。
- 能力／目录：`CapabilityAdapter` 或 `CANVAS_CAPABILITY_ADAPTER_URL`，提供 Agent、模型、知识、模板等原 UI 所需的目录数据。
- 外部资源：`AssetAdapter` 或 `CANVAS_ASSET_ADAPTER_URL`；查询与导入分离，导入必须提供真实文件字节，而不是返回“成功”的虚构路径。这一可选资源接口不取代前述默认可用的本地资产库；资产库本身的可替换来源走 [资产库 provider](<../apps/web/src/providers/asset-library.ts>)。
- 工作流设计助手：独立 `WorkflowAssistantPort`；不回接原聊天系统。
- QuestionForm 外部参考：保留原表单渲染，通过可选 `QuestionReferenceAdapter` 查询、选择及预览参考；没有适配器时显式不可用。
- HTML 发布、模板保存和外部编辑器交接：通过可选 [HtmlViewerAdapters](<../apps/web/src/components/html-viewer/adapters.tsx>)，不附带原发布控制台、安装模板平台或团队服务；本地文件另可使用统一资产保存入口。

HTTP 适配器实现与准确的 payload 见 [http-adapters](<../apps/server/src/http-adapters.ts>)。所有 TOKEN 环境变量仅用于服务端调用；不放入画布 JSON、项目清单或 localStorage。

## 6. 原生与 Web 的差别

普通 Web iframe 不等价于 Electron WebView。跨域 DOM、资源观测、截图与页面归档需要原生宿主和对应会话授权，不能通过伪造 `window` 对象或扩大 iframe 权限替代。

浏览器资源读取校验项目、会话、导航代次和授权；页面导航／撤销后旧授权失效。资源二进制与旁路元数据是多文件操作，并非数据库事务；部分落盘时应明确报告已保存路径，而不是删除用户文件“回滚”。

[原采集器](<../apps/web/src/components/BrowserCollectorPanel.tsx>)保留原紧凑浏览器、资源面板、项目采集托盘与展开浏览器入口。普通 Web 保留原回退／首页界面，但不能凭 iframe 获得原生资源权限。书签、参考网站和采集开关通过偏好 API 保存；写入失败不展示虚假持久化成功。

独立窗口使用独立 Electron profile；自动化截图只捕获目标应用页面／合成器，不捕获用户的整个桌面。扩展设置、下载和登录交接复用原浏览器界面及宿主协议，不构成新的账号平台。扩展安装需要用户在目标浏览器手动操作并同意权限；临时测试 profile 中的结果不等于用户普通 profile 已安装。Pinterest 登录交接的可用范围仍限于受支持的 macOS 未打包运行条件，不代表全平台或真实账号端到端验收。准确限制见 [原生浏览器宿主](<browser-host.md>)。

页面归档保存 HTML、CSS 与清单，不是完整网站／运行时克隆；动态应用状态、全部网络资源和完整批注恢复不能由“归档完成”推导出来。页面提取／重建可向独立 Agent 适配器传递有界上下文与归档输入，没有适配器时明确不可用。

## 7. 并发与已继承边界

- 一进程运行一个服务实例。多实例测试和部署使用独立进程、数据根与端口；不要把原模块级事件／桥接状态误认为多租户内存隔离。
- 同一 JS 页面中的多活动画布仍受原模块级 host/Agent 桥接状态限制；多个工作区用独立页面或窗口。
- 原画布写序列化以进程为边界；多进程共享同一数据根需要额外存储并发协议，本提取不声称支持。
- 原浏览器基线没有可达的 inspect/edit/comment 工具栏调用入口；浏览器 viewport 尺寸控制也没有可达 UI。内部函数／状态存在不等于可由用户操作，不能写成完整界面能力。
- 批注相关原结构及 `previewAnnotations` 宿主端口保留，但不恢复原聊天批注数据库，也不声称所有批注采集、保存、重开路径都已闭环。
- 原 HTML 查看器当前基线停用了 palette/tweaks 活跃 UI；HTML 手动编辑与真实 deck 查看不因此移除。
- 未提取已删除的历史多槽 image-task 平台或其旧数据库迁移。保留当前媒体生成、重试、取消和画布交付，兼容读接口不能被解释为历史平台恢复。

验收证据与未覆盖项见 [功能对照表](<feature-parity.md>) 和 [运行验证](<runtime-verification.md>)。
