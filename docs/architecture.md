# 独立工作区：边界、数据与适配器

## 1. 运行边界

```text
原画布／标签／查看器／项目资产侧栏
        │ HTTP + SSE / CanvasTransport
        ▼
独立 Canvas Server
        ├─ 项目注册与原画布 JSON
        ├─ 项目文件、预览、版本、产物清单
        ├─ durable AgentTasks → 候选／交付／采用
        ├─ 原工作流图、执行状态机与结果交互
        ├─ 媒体适配器 → 原画布媒体交付
        └─ 浏览器资源桥 → 独立 Electron 原生宿主
```

Web 不导入服务器私有实现；服务器不依赖 Next、原 daemon 或原聊天数据库。共享 DTO 位于 [contracts](<../packages/contracts/src/api/canvas-workspace.ts>)，宿主接口位于 [canvas-workbench 公共出口](<../packages/canvas-workbench/src/index.ts>)。

生产 Web 通过 [运行时流式代理](<../apps/web/src/server/proxy.ts>) 转发 API、产物与 frame 请求。它在请求时读取明确配置的 `CANVAS_SERVER_ORIGIN`，不使用构建时固定端口，也不猜测已有本机服务。没有目标配置返回 503。代理保留流式 SSE、上传、Range、下载响应、浏览器 Origin 和作用域头；服务端传输密钥不会写入客户端 bundle。代理在注入凭据前校验 Host：默认只允许本机地址；配置 `CANVAS_WEB_URL` 后只接受该明确主机及端口。通过反向代理部署时必须正确配置这个外部地址，不能信任来访者自行提供的转发头。

`CANVAS_AUTH_TOKEN` 保护后端传输，不是 Web 用户登录系统。默认部署是本机单用户工作区；若把 Web 暴露到网络，必须另外配置访问认证与授权，不能把 Host 校验或后端传输密钥当成用户身份验证。

[tools-dev](<../tools/dev/src/cli.ts>) 是生命周期入口，统一传递地址、独立数据根和原生宿主密钥，并只管理自己启动的子进程。

## 2. 数据模型与文件组织

数据根约束以 [AGENTS.md 的 Safety and data](<../AGENTS.md#safety-and-data>) 为准。项目内容路径由原 [PROJECT_LAYOUT](<../packages/contracts/src/project-layout.ts>) 定义；不要重新发明另一套目录布局。

| 层次 | 保存内容 | 所有者 |
|---|---|---|
| 项目注册 | 项目 DTO、标签顺序、活动标签、浏览器标签 | [ProjectRegistry](<../apps/server/src/storage/project-registry.ts>) |
| 画布文档 | 原 state 键、节点、连线、分组、草稿及视口；保留未知字段 | [CanvasStateService](<../apps/server/src/canvas/state.ts>) |
| 项目输入／可编辑源／产物 | 原 uploads、collected、text、sketch、storyboard、image、video、page、presentation 语义 | [项目布局常量](<../packages/contracts/src/project-layout.ts>) |
| 文件版本与清单 | 原版本字节、当前版本指针、产物元数据、依赖关系 | [文件 API](<../apps/server/src/routes/files.ts>) |
| Agent 回执 | 稳定任务 ID、原始请求、执行状态、交付状态、输出引用与错误 | [AgentTasks](<../apps/server/src/services-tasks.ts>) |
| 工作副本／候选 | 授权输入快照、输入 digest、目标 digest、隔离输出与候选清单 | [artifact-workspace](<../apps/server/src/canvas/artifact-workspace.ts>) |
| 工作流与媒体 | 独立 SQLite 中的图版本、运行、步骤、输入快照、结果交互及媒体任务 | [workflow composition](<../apps/server/src/routes/workflows.ts>) |

画布状态 API 使用服务端返回的 `revision` 作为并发条件，不应假定它只是客户端可自行加一的计数器。提交 `expectedRevision` 和必要的 `base`；冲突处理保留原逻辑，不能通过去掉修订检查强制覆盖。

文件身份以服务端返回的 canonical path 为准。草图使用原 `.sketch.json` 格式；打开 pending 草图必须先读取真实文件，仅在确定 404 时创建空白内容。重命名先排空自动保存，再采用服务端返回的名称，不能继续向旧路径写入。

## 3. Agent 的最小契约

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

## 4. 外部能力

- Agent：进程内 `AgentAdapter` 或 `CANVAS_AGENT_ADAPTER_URL`。
- 媒体：`MediaAdapter` 或 `CANVAS_MEDIA_ADAPTER_URL`；模型与配置从适配器发现，不内置真实供应商凭据。
- 能力／目录：`CapabilityAdapter` 或 `CANVAS_CAPABILITY_ADAPTER_URL`，提供 Agent、模型、知识、模板等原 UI 所需的目录数据。
- 外部资产：`AssetAdapter` 或 `CANVAS_ASSET_ADAPTER_URL`；查询与导入分离，导入必须提供真实文件字节，而不是返回“成功”的虚构路径。
- 工作流设计助手：独立 `WorkflowAssistantPort`；不回接原聊天系统。
- QuestionForm 外部参考：保留原表单渲染，通过可选 `QuestionReferenceAdapter` 查询、选择及预览参考；没有适配器时显式不可用。
- HTML 发布、模板保存和外部编辑器交接：通过可选 [HtmlViewerAdapters](<../apps/web/src/components/html-viewer/adapters.tsx>)，不附带原发布控制台或资产平台。

HTTP 适配器实现与准确的 payload 见 [http-adapters](<../apps/server/src/http-adapters.ts>)。所有 TOKEN 环境变量仅用于服务端调用；不放入画布 JSON、项目清单或 localStorage。

## 5. 原生与 Web 的差别

普通 Web iframe 不等价于 Electron WebView。跨域 DOM、资源观测、截图与页面归档需要原生宿主和对应会话授权，不能通过伪造 `window` 对象或扩大 iframe 权限替代。

浏览器资源读取校验项目、会话、导航代次和授权；页面导航／撤销后旧授权失效。资源二进制与旁路元数据是多文件操作，并非数据库事务；部分落盘时应明确报告已保存路径，而不是删除用户文件“回滚”。

独立窗口使用独立 Electron profile；自动化截图只捕获目标应用页面／合成器，不捕获用户的整个桌面。

## 6. 并发与已继承边界

- 一进程运行一个服务实例。多实例测试和部署使用独立进程、数据根与端口；不要把原模块级事件／桥接状态误认为多租户内存隔离。
- 同一 JS 页面中的多活动画布仍受原模块级 host/Agent 桥接状态限制；多个工作区用独立页面或窗口。
- 原画布写序列化以进程为边界；多进程共享同一数据根需要额外存储并发协议，本提取不声称支持。
- 原浏览器面板当前版本未渲染 inspect/edit 工具入口，虽然内部函数仍存在；保持原基线，不添加新按钮。
- 原 HTML 查看器当前基线停用了 palette/tweaks 活跃 UI；HTML 手动编辑与真实 deck 查看不因此移除。
- 未提取已删除的历史多槽 image-task 平台或其旧数据库迁移。保留当前媒体生成、重试、取消和画布交付，兼容读接口不能被解释为历史平台恢复。

验收证据与未覆盖项见 [功能对照表](<feature-parity.md>) 和 [运行验证](<runtime-verification.md>)。
