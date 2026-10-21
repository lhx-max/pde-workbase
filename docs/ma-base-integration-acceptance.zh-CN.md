# 画布、文档 App 接入 MA 基座：联调方案与验收

核对日期：2026-10-21。此文是执行与验收计划，不新增协议、不代表已完成真实 MA 接入。

**最新范围修正（用户确认）**：只适配我们自己的 App 与交付产物；一寒基座/公共 SDK/调度由其所有者维护。此前本地宿主补丁已撤回，不作为当前方案。最新规范见 App 开发规范 §4.6，下方历史执行记录仅保留过程证据。

**后续用户授权：本地模拟登记**。已新增独立代理，在不修改基座仓库的情况下模拟目录、实例、关联及标签；原宿主真实加载两个组件，编辑器使用真实本地 Provider。入口 `http://127.0.0.1:18581`；原 `18580` 不受替换。[复现与验收](verification/ma-registration-simulation/README.md)。这不替代下文正式云端与 MA 自主调用验收。

**npm 分发进展（2026-10-21）**：已发布内网 `@ks-designai/canvas-surface@0.1.2`、`@ks-designai/doc-surface@0.1.2`、`@ks-designai/canvas-cli@0.1.1`，并从内网按包名独立安装、完成本地真实服务发现/读写/回执/冲突及组件消费验收。[安装交接与证据](verification/npm-distribution/README.md)。这补齐包交付，不代表远端 MA 自主调用、正式登记或 staging 业务已验收。

## 目标与完成标准

在真实 MA-V 宿主中登记并打开我们的画布和文档 App，由真实 Agent 选择工具、生成参数、调用 Provider，编辑器显示同一实例的结果；刷新、切换和重开后数据仍一致。保留动作请求、回执、状态读回和界面证据。

范围先收敛为一个画布实例、一个文档实例。测试使用专用实例与显式独立数据根；不改用户正文、不清理旧实例、不绕过存储验收、不将 loopback 开发 Provider 公开暴露。生产上线、全套卡种和所有导出格式另验。

## 已核对的现场

| 部位 | 证据与状态 |
| --- | --- |
| MA-V 宿主/BFF | `/private/tmp/da-ma`，`yihan-dev-ma`，HEAD `fa9475183`；不能将它等同于云端 mavapi 的完整后端源码 |
| 基座业务后端 | 本地 BFF 当前指向 Appwrite `mavapi`，身份项目 `mavbackendwyh20261013` |
| 后端目录 | 真实登录态下 `/api/ma-v/applications` 返回 `STORAGE_ACCEPTANCE_REQUIRED`；目录是否已包含我们的 manifest 尚不能确认 |
| 实例目录 | 当前个人空间 `/api/ma-v/projects/:bizId/application-instances` 同样被存储验收门禁拒绝 |
| 前端静态注册 | Kit registry 已含 `design-agent-plugin-kit/canvas-workspace` 与 `design-agent-plugin-kit/doc`；这不等于后端登记/发布 |
| 画布 Preview | [现有运行结果](verification/canvas-kit-runtime/result.json) 记录五项通过：真实组件挂载、UI 持久化、Provider 更新可见、版本/重放保护、A/B 切换及刷新恢复；不属于真实 MA 网关或模型工具调用验收 |
| 画布宿主适配 | 外部宿主源码补丁已撤回。我们自己的包装层必须适配目标现有 context/fileClient/conversation；不能依赖宿主新增 Provider/transport/保存回调。默认 `/canvas-provider` 只是 Preview 配置 |
| 文档宿主适配 | 外部宿主及 SDK 补丁已撤回，Kit 文档示范包装层恢复原状；其中本机固定地址仍属开发局限，不能当作通用交付。后续改进落在我们自己的文档 App 包装层 |
| Agent 当前调用 | `ma-v/src/api.ts` 在发送模型请求前调用 `planApplicationConversationAction`，用关键词挑部分动作并执行，再把结果写入提示；该路径不能作为模型自主工具调用证据 |

## 五道验收门

| 顺序 | 工作 | 通过信号 | 失败信号 |
| --- | --- | --- | --- |
| 1. 真实目录 | 在 mavapi 源码确认应用目录/实例/关联的验收门禁；完成该能力的存储验收，再按其正式登记发布入口提交两个 manifest | 登录用户能读到两个应用，创建实例并关联会话；moduleId/exportName/version 与静态包一致 | 503、目录空但被当成功、只改前端菜单、直接翻全量验收开关 |
| 2. 宿主打开 | 我们的 App 包装层适配宿主已提供的 context/fileClient/conversation；通过其正式认证接口配置 Provider、画布 transport 和资源访问；按现有生命周期保存，文档实例按正式创建流程初始化，不要求修改宿主或 SDK | 两个真实组件可从管理页创建/打开；A/B 分离，刷新重开相同实例；失败保留草稿 | 相对地址落到错误服务、React 渲染器重复、doc 首次 read 404、切换丢保存 |
| 3. 网关调用 | 从基座动作入口执行画布 create/read/operations/context 与文档 create/read/write；对齐身份、实例映射、版本和幂等 | 网关请求经真实 Provider 写入，同实例 UI 可见，UI 编辑后网关可读回 | 仅直连 curl 成功、前端另存一份状态、重试重复建资产、过期写覆盖 |
| 4. Agent 自主调用 | 核对真实 Agent runtime 的工具注册与执行通道；提供 manifest/schema 和实例上下文，由模型生成参数后经网关执行 | 有 Agent run/tool-call → 网关 → Provider → receipt → state/UI 的完整关联证据 | 前端关键词预执行、人工/脚本先写后让模型复述、只有模型说“完成” |
| 5. 恢复与隔离 | 重放、过期版本、Provider 离线、切换未保存实例、重开、跨团队/无关联访问 | 重放不重复执行；冲突保留双方；离线不伪成功；越权拒绝；恢复后数据一致 | 以新幂等键自动重试不确定写入、丢草稿、越权读写、旧响应覆盖新稿 |

## 首批真实 Agent 测试任务

1. 画布：让 Agent 在选中的专用画布按指定标题和坐标创建两张卡片，再修改其中一张的位置；核对参数、实例 ID、回执、UI 与刷新结果。具体卡种必须与当前已开放能力一致，第一轮可用视频/分镜卡，不以恢复文档深编辑入口为前提。
2. 文档：让 Agent 在专用文档写入一段明确正文，再追加一段；手工编辑另一处后再次让 Agent 读取并修改。核对 App 自有正文、版本与 UI；若文档绑定画布，额外核对镜像状态，正文保存不等于镜像同步。
3. 冲突：取得旧版本后通过另一个入口保存，再提交旧版本；应明确冲突或按正文合同安全合并，不能静默覆盖。
4. 隔离：另一个已授权测试团队/身份读取或修改上述实例应被拒绝。没有第二身份时标待验，不用自报 header 冒充生产身份验收。

每个成功用例保存：app/module/version、applicationInstanceId、providerInstanceId、canvas/doc 实际 ID、requestId/idempotencyKey、提交前后 revision、工具调用与回执、读回断言、截图。证据中剔除 cookie/JWT/SSO secret。

## 优先补齐的接缝

- **地址与认证**：同页编辑器与基座服务器可能处于不同网络位置，Provider baseUrl、浏览器 transport、图片/文件 URL 分别验证；远端服务器上的 `127.0.0.1` 不会指向用户电脑。画布现有 Provider 只接受显式 loopback 开发模式；真正接远端网关需可信调用方验证，不能靠 actor 字段当认证。
- **版本**：画布 Provider revision 是内部画布 revision + 1；文档正文版本是 hash，Provider 外层版本另有数值语义。不可混传；所有写操作先读版本，网络结果不确定先查回执，不能换新 key 盲重放。
- **文档信任边界**：当前 Provider 适配代码以“网关已认证”为前提信任 actor；联调前核对入口的实际网关限制/凭据验证，不能直接把本机开发端点公开当安全接入。
- **动作 schema**：Agent 写画布需要真实 operation 联合类型与示例，当前 manifest 的 `operations[].type=object` 太宽；文档 write 需要明确 content 与正文基线，区分外层 expectedRevision。声明的动作都必须经网关真实跑过。
- **Agent 能力来源**：先核对现有 MA 是否有可执行的应用工具/CLI/MCP 接缝；复用其正式机制，不另造第二个模型运行时。仅传动作说明文本不足以证明可执行工具已经注册。
- **编辑器回读**：Provider 写入后要刷新同一个画布/文档状态；模型成功回复不能代替界面与状态验证。文档与画布双入口同步继续遵守正文增补合同。

## 最小下一步

先确认云端 mavapi 的登记/发布管理入口，由基座所有者处理本次两条存储验收拒绝。与此同时准备我们自己的部署 manifest、App 包装层与版本/schema 适配；未通过第一道门前，只能报告隔离环境验证，不报告“已注册到他的服务”或“他的 Agent 已调用成功”。

## staging 可复用的交付边界

目标是同一份 App 构建产物部署到 staging，通过环境配置切换地址与认证，不复制本机代理或改基座代码。目前尚未达到这一状态。

- 我们负责：可安装的画布/文档组件包、适配现有 SDK 的 App 入口、完整 manifest/action schema、Provider 服务、可信调用方验证、版本与幂等，以及 UI 与 Provider 共用的数据实例。
- 基座接入前提：提供正式登记/发布入口，开放应用目录与实例能力；提供实际可执行的 MA 工具通道和 Provider 调用身份约定。遵循已有规则；缺失的能力由其所有者补齐。
- 环境配置：Provider 服务地址、浏览器 API/资源地址、凭据来源、持久化存储必须明确。本机 loopback-only Provider 和文档包装层固定 localhost 地址不能原样上云。
- 最终现场：右上角能选择并创建“画布”“文档”，刷新后保留；在真实 MA 对话中提交编辑任务，保存 tool-call、网关请求、Provider 回执、状态读回及同一实例界面变化。只有这条链路通过，才声称真实接入。

本次只做代码核对与验收方案整理，没有对云端登记、存储开关、部署或真实用户资产执行写入。

## 历史本地适配执行记录（2026-10-21，已撤回）

此节更新上方最初“仅方案整理”的执行范围：已在 `/private/tmp/da-ma` 与桌面 Plugin Kit 修改宿主适配，没有推送或部署。

- 新宿主 ProviderClient 将画布/文档插件动作转到现有认证 BFF `executeApplicationAction`；校验上下文与实例匹配，浏览器不直接按 manifest URL 发 actor 请求。该客户端只支持动作面，不伪造快照端点；原有示例插件仍走原客户端。
- 受控的切换标签、关闭活动标签、新建/切换会话、隐藏应用和发送消息前等待活动 App 保存；失败保留当前页面，同一保存期间拒绝第二次跳转。未注册保存回调的原有页面保持原交互时序。浏览器强制关闭/刷新、租户切换及所有归档入口尚未纳入全覆盖保证。
- 文档插件稳定等价 context 的读取生命周期，缺少真实文档元数据时明确失败；未配置的导出显式不可用。打开文档只读取，不借此盲写初始化正文。
- Kit 17 项测试、类型检查与 Vite 构建通过；MA-V 52 项定向测试及包级类型检查通过，覆盖 App 原有云盘/画布行为、认证 allowlist、实例上下文校验、保存失败与竞争导航；根 guard 通过。真实页面仍被 `STORAGE_ACCEPTANCE_REQUIRED` 拒绝。
- 以上为本地适配与回归验证，不是云端登记成功、真实 App 打开成功或模型自主工具调用成功。当前没有新建云端应用实例或向真实 Agent 发送测试任务。

## 当前交付与核验（2026-10-21，范围修正后）

- 仅撤回本会话创建的 MA-V 源码/测试和公共 SDK 扩展；先保存到本仓 `.tmp/withdrawn-host-adaptation-20261021/`。原有外部插件挂载与其他未提交改动保留。
- [画布联调 manifest](verification/ma-registration/canvas.local.manifest.json) 与 [文档联调 manifest](verification/ma-registration/doc.local.manifest.json) 已生成，provider 使用完整本机 URL。
- [校验结果](verification/ma-registration/validation.json) 使用目标 `fa9475183` 的真实 `maApplicationManifestSchema` 执行：两个产物通过，Preview 的相对 baseUrl 被拒绝。校验期间只读目标 schema，没有修改其规则。
- 这些 manifest 只适合基座与 Provider 同机的联调；不代表远端可达、身份授权、组件运行或后端登记成功，生产地址必须单独配置。未编造正式登记 API、应用 ID、发布状态或已完成的 Agent 调用。
- 右上角的实例菜单取决于目标应用目录、实例与会话关联；当前目录/实例请求被 `STORAGE_ACCEPTANCE_REQUIRED` 拒绝。应用侧尚需按目标正式登记入口提交产物，不能用静态 registry 替代。
