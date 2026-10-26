# Plugin Kit App 示范仓库：接入规则与规范对照

负责人及资源审批入口见[资源目录](platform-resource-catalog.zh-CN.md)：目标宿主/Kit由王一寒负责，业务App按各仓负责人审批。当前兼容基线与实际props分别核对，不将示范默认值当作生产授权。

复核：2026-10-23。用于新 App 开发前对齐，以及已有 App 的规范审查。本页解释示范和正式合同的边界，不要求先打通 MA 才能开发内部业务。实现/发布状态另查各 App 的证据，不从规范推断已经接通。

## 版本核对补充（2026-10-23）

目标 `design-ai-client/yihan-dev-ma` 远端已核到 `367127668da7e35daf0fa7393040e920a339d069`；原本地联调基线为 `fa9475183`，不覆盖原检出或运行数据。新版把 Kit 的 `794be21a` 源码快照纳入宿主，取代开发者绝对软链，要求在宿主中保持单一 SDK 身份；业务方仍只按公开 context/文件/对话/Provider 合同适配，不修改宿主 registry、SDK 或调度使测试通过。新增的直播设计中心是另一业务 Tab 的集成，不自动代表本批四 App 已登记或安装。

两版本的应用目录、对话动作规划、run handler、动态工具支持及 Managed Agent 桥关键文件已按 Git blob 核对一致；因此本地规则预执行与正式自主工具调用仍分别验收。此补充记录版本事实，不将某个永久固定 SHA 当成通用规范；后续接手须重新核对目标版本。

## 1. 仓库与证据基线

`design/design-agent-plugin-kit` 是基于目标宿主后端的 **App 示范仓库**，包含 SDK、静态 registry、两个示范插件和 Preview。它同时展示接入形状，不能简化为“只用来测试”，也不能当成完整后端部署仓。

| 来源 | 仓库 / 位置 | 本次用途 |
| --- | --- | --- |
| App 示范仓 | [KDev master 文件页](https://kdev.corp.kuaishou.com/git/design/design-agent-plugin-kit/-/files?branchName=master&repoId=647255&repoName=design-agent-plugin-kit)；[Git master](https://git.corp.kuaishou.com/design/design-agent-plugin-kit/-/tree/master) | SDK、示范前端、registry、Preview |
| 确定示范基线 | [794be21a58f846ae3b5e959a8fd7eed680d476cc](https://git.corp.kuaishou.com/design/design-agent-plugin-kit/-/tree/794be21a58f846ae3b5e959a8fd7eed680d476cc)；SDK 1.0.0 | 已提交文件的兼容参考；采用前重新核对目标版本 |
| MA 基座 | [design/design-ai-client · yihan-dev-ma](https://git.corp.kuaishou.com/design/design-ai-client/-/tree/yihan-dev-ma)；兼容基线 fa9475183ee91b4e4ba948eee7f86312db4022f4 | MA manifest schema、静态组件解析、实际 props；不是示范仓里的后端实现 |
| App 规范 | [主规范](app-development-spec.zh-CN.md)、[手册](app-development-handbook.zh-CN.md)、[合同模板](../templates/APP_CONTRACT.template.md) | 我们的开发责任、适配和验收规则 |
| 各业务仓 | [Skill 仓库索引](../SKILL.md#仓库快速索引2026-10-21-核对) | 画布、草图、文档、生图及其他 App 的领域实现 |

**该示范基线已提交 registry 只有 design-canvas 与 asset-collection。** 开发者工作区新增的插件与实验适配不构成上游发布或正式登记。接入前须核对已提交版本、实际安装来源与应用目录。

## 2. 合同逐项对照

“示范/基座合同”决定外部兼容形状；“本项目增补”是我们对云端、交付和可靠性的要求，不冒充示范源码已经实现。纯卡包不因此被要求另建 App 后端。

| 面 | 已提交示范 / 基座的实际依据 | 我们的规范要求与适用范围 |
| --- | --- | --- |
| 前端交付 | README、registry/index.ts：构建时静态导入，宿主不执行远端前端代码 | App 交付 surface 和自有包装层；本项目要求独立 npm/tgz 依赖闭包。源码软链是示范安装方式，不是唯一正式分发方式，也不代替可移植包验收 |
| React | README：React 是 peer，宿主提供唯一实例，Preview dedupe | 不捆绑第二份 React；本项目 React 18/Node 24/pnpm 10.33.2 是自己的工具链约束，示范 README 的 Node 20+ 不改变它。实际宿主 renderer 另测 |
| registry | manifest.frontend 的 moduleId/exportName，registry 导出真实组件 | 配置 factory 创建的组件要真实命名导出；不能将 factory 本身或未配置的裸编辑器当可运行 App |
| 应用版本 | MA resolver.ts 比较静态 manifest.version、currentVersion、目录 manifest.version、instance.applicationVersion，以及 exportName | 对齐该应用发布版本；surface、SDK、CLI 的包版本可各自不同，用兼容清单关联 |
| manifest | SDK types.ts：schemaVersion:1；slug/version/name/description/instanceMode/frontend/provider/permissions/actions | MA schema 与 COI manifest 分别生成；MA action 用 id/effect/inputSchema/requiredPermissions，不能直接提交 COI 的 actionId/mode/async |
| 实例策略 | instance-policy.ts 支持 single/multiple；Preview 只按传入数组选实例 | 在 App 合同声明策略，复用 MA 的正式创建/关联合同；不能从 Preview 数组推断“全公司只能一个实例”或数据库唯一约束 |
| context | ApplicationContextValue：applicationId/applicationVersion/applicationInstanceId/providerInstanceId/bizId/sessionId/actor，locale 可选 | 记录完整映射和身份来源；bizId 不是内部画布 ID，providerInstanceId 不必等于业务主键；可验证业务归属不能只靠 actor 有值 |
| 实际 props | SDK PluginComponentProps 均可选；目标 SessionAppSurface 实际传 context/fileClient/conversation | providerClient、保存钩子与私有 transport 不是目标宿主保证项；必需认证/API 接缝由 App 包装层的正式配置提供，缺配置明确不可用 |
| Provider 读 | SDK snapshot：GET /open-platform/v1/instances/:pid；形状 protocolVersion/providerInstanceId/revision/summary/content/availableActions；示范画布也用 list_content 动作读取 | 声明采用 snapshot 还是已公开 read action；消费 snapshot 时实现该合同和鉴权。MA 网关动作响应的 data 与 snapshot 的 content 不可混用，不伪造未实现 GET |
| Provider 动作 | SDK action：POST /open-platform/v1/instances/:pid/actions/:actionId；body 含协议、身份、请求键、版本、input | 按合同逐字段构造信封，不能整体展开含 locale 或宿主私有字段的 context；路径/body/action/实例一致。响应直接返回 protocolVersion/actionId/providerInstanceId/revision/summary/data，不套 COI 外壳 |
| 网关两跳 | MA maProviderActionRequestSchema 仅接受调用方 applicationInstanceId/sessionId/actionId/expectedRevision?/input；ProviderClient 展示另一跳的完整信封 | 区分调用者→MA 与 MA→Provider，不能把完整 Provider 信封直接提交给 strict 的 MA 调用入口；也不能假造登记 API |
| revision | SDK 用 number；MA expectedRevision schema 为正安全整数 | 保留 Provider 正安全整数与业务版本/hash 的映射；读动作返回当前版本，写冲突明确。不能拿 Date.now 或“刚读最新基线”替代并发保护 |
| 幂等 | SDK 每次 action 生成新的 UUID，同时放 header/requestId/idempotencyKey | 这只展示单次调用，不保证逻辑重试或重启去重。本项目要求同一逻辑请求保留原键/输入/基线，服务端在当前权限下查持久回执；不要原样重调 SDK action 代替安全重放 |
| 身份与授权 | SDK action 复制 context.actor，但该客户端代码不提供正式认证保证 | 按正式可信通道验证，检查当前实例/动作权限；requiredPermissions 是声明，不是票据。生产不信任自报头，不把本项目临时写授权策略称为 MA 官方权限协议 |
| 业务后端 | README：插件后端保有业务数据，列出所需 HTTP 接口；示范仓不因此包含完整后端运行环境 | 复用同一领域服务供 UI/Provider/CLI 使用；独立服务部署与前端安装分别交付。本项目云端默认与私有存储是增补，不要求为了目录命名强拆已有共享服务 |
| File API | file-api.ts：FileClient.list/get/upload；HostFileAdapter 走 bridge，HttpFileAdapter 用 /file-api/v1/bizs/:bizId/files | 业务只依赖注入文件能力；未消费 HTTP adapter 的 App 不必复制全部示范后端路由。FileRecord 的 fileId/bizId/name/mimeType/size/createdAt?/contentUrl 不能替换为自有文件 DTO |
| 文件地址 | HttpFileAdapter 规范化相对 contentUrl；README 列 content 字节入口 | 确认图片/下载的真实认证与可达性；规范化 URL 不等于已获得权限，MA 文件与 App 自有资产不天然同库，不向客户端发桶密钥 |
| 对话 | ConversationBridge 有 insertContext/sendMessage；Preview 只是事件提示 | 在真实桥里验证语义；目标 MA insertContext 当前关联的是应用实例，不能假定任意 payload 都会原样写入模型上下文。事件提示不算 Agent 已执行 |
| 打开/保存 | SDK 没有 registerBeforeLeave 等强制保存合同 | 读与创建分离，打开已有实例不隐式创建/覆盖；草稿、切换和失败由 App 自有适配处理，缺宿主钩子说明强关限制 |
| Preview | 固定测试 actor、app_/ai_ 示例 ID、localhost 和模拟会话事件 | 仅作演示/合同测试，不能当正式 ID、生产登录、登记或 Agent 证据。示范 localhost 不得成为我们的默认生产服务 |
| 可靠性与验收 | 示范测试覆盖 adapter、registry、实例策略等 | 本项目另验云数据、持久幂等、撤权、恢复、包安装及部署；示范通过或规范写完不证明这些已实现 |

## 3. 新 App 编码前填写的内容

在自己的 docs/APP_CONTRACT.md（使用[模板](../templates/APP_CONTRACT.template.md)）填写以下项目。正式 MA 未纳入当前阶段时，对应验收门记“未纳入”，架构对齐仍要完成。

1. 示范仓及目标宿主的 branch/commit、SDK 版本、dirty 状态；每条约束来自示范、目标宿主还是本项目增补。
2. surface、包装层、静态 moduleId/exportName、应用发布版本与依赖版本；安装/发布由哪方执行。
3. instanceMode、完整 context 的来源与业务映射；创建、打开、复制、归档和恢复语义。
4. 采用的 snapshot/read action、写动作及精确 schema；COI、自有 API、MA 调用入口、Provider 四种信封的明确映射。
5. 真实认证/API/资源桥的注入方式，浏览器/网关/执行环境各自可达地址；缺配置的行为。
6. Provider 与内层业务版本，稳定幂等键、持久回执、撤权和不确定结果恢复；对话/文件/生命周期能力的实际支持范围。

不要求每个 App 全量实现 P1–P24、另建组织项目表、照抄矩形示范业务或文档合并算法。字段够用就复用现有合同，不扩写另一套通用协议。

## 4. 文档 App 参考与当前限制

历史 2026-10-21 Kit 本机适配以隔离 MA fixture 验证过文档编辑、真实 Appwrite 保存、刷新、A/B 切换、恢复和冲突；证据在文档仓 docs/verification/kit-cloud-20261021/。该结果不等于远端 Kit 已包含 doc 插件，也不等于真实 MA/Agent 通过。

本批包装层由 **App 自己的仓库**维护：画布 createCanvasApp、文档 createDocEditorApp、草图 createSketchEditorApp、生图 createIndependentImageMaApp。这些是应用方 factory，不是 Kit SDK 公共 API。生图已迁为拥有独立数据库、私有桶、工作区和任务的业务服务；旧画布承载生图 profile 不作为本批部署方案。生图 surface、MA 包装层、正式宿主静态登记与可信请求通道仍须分别验收，不能从图片包名或独立页面可用推导正式 MA 接入。

实际代码锚点、制品与验收边界见 [交付记录](../../../../docs/four-app-completion-20261022.md)。本页只确立对齐规则，不宣称所有业务实现、正式目录、SSO、Agent 或 staging 已通过。规范评审、业务实现与外部接入的验收状态分别记录。

## 5. 六类结果分开记

组件安装与构建、App 自身云端闭环、Kit/合同 fixture 联调、正式 MA 登记与实例调用、真实 Agent、staging 分别记录。还需卡片互联时按对应合同验同实例和复制隔离。源码软链能运行、目录里可见、Preview 提示已发送、模型文字回复成功都不能互相替代。

## 6. 认证请求与私有资源的交付门

前端组件合同必须列出实际收到的 props 和部署时注入的可信能力。SDK 声明某个可选属性不代表宿主已经提供；actor、租户和实例字段只描述上下文，不构成认证凭据。组件缺少必需通道时应明确不可用；不得读取宿主私有认证实现、维护者浏览器状态或另建客户端身份真源。包装层创建时保留不可变的完整上下文，应用版本或身份作用域变化时重新绑定，旧请求结果不得写入新实例。

按每一跳分别记录浏览器→网关→Provider→业务服务的身份来源、精确请求/响应合同、字节上限与超时。验证调用方原幂等键、输入和基线能抵达最终业务服务，并在响应丢失后按原键显式重放；某一跳自行生成新键，不能记为支持安全重试。付费动作尤其不得以重新派发替代查回执。

为元数据、任务状态、原件下载、结果预览和上传逐项列出公开路径及认证方法。通用 FileClient 若指向 MA 会话盘，不自动拥有 App 私有资产的访问权；不能为绕过资源桥缺口，将独立 App 原件迁回画布、MA 文件盘或公开桶。上传上限按原始字节及 base64/JSON 开销分别核算，在实际消费入口测试合同上限、超限拒绝、撤权和完整字节哈希；独立 API 上限通过不代表网关也支持该上限。

应用方交付可配置的组件、领域 API/Provider、manifest 和安装说明；宿主方提供其正式发布的认证请求/资源桥及静态注册环境。依赖未提供时保留精确缺口，不修改他人 SDK、宿主或 Agent 编排来制造验收通过。

存储验收还须记录实际运行身份。维护会话与服务身份可能产生不同的文件默认授权；核对新建对象最终 ACL，不能仅凭“私有桶”或一份配置声明通过。维护模式真实云端通过不代表生产密钥 profile 已验收；上游返回额外授权时，业务按明确合同拒绝，或仅缩窄本次可证明新建的对象，不批量修复既有对象、不伪造存储响应。生产协议 fixture、真实云端维护验证和正式运行身份分别留证。
