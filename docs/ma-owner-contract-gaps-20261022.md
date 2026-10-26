# MA 本地联调：外部合同与下一段验收

## 2026-10-23 生图独立后端进展与剩余外部缺口

生图拥有独立业务库与私有桶，画布只保留布局、完整目标作用域、工作区/资产/哈希/尺寸引用、自身投递回执和经认证的预览代理，不复制生图字节、配置、任务或编辑工程。`grworkspace/image_app_dev/app_runtime_state` 与 `image_assets_v2` 已实际私有预置并通过真实云端验收（集合/桶授权为空），资源与访问审批归生图仓负责人李鹏。合同与部署见生图仓 `docs/INDEPENDENT_BACKEND.md` 与 `deployment/README.zh-CN.md`。

独立后端已实现并有实际证据：生图仓 244 项测试通过；两个真实模型在 2048 输出下各完成真实生成，高清档另核对 GPT 方图 2880×2880、Gemini 方图 4096×4096；浏览器内 Gemini 生成→旋转→刷新读回通过；画布经公开 API 的引用接缝在真实云端通过当前真实云端断言；生产形态的 Linux amd64 只读/非 root 容器 9 项检查（含真实 VTracer Worker）使用 HTTPS 协议 fixture 通过（非真实云端/生产凭据）。本仓验收 compose 已含四个服务，生图服务按生图仓 `Dockerfile.backend` 构建并逐个只读挂载密钥/授权/模型适配文件；compose 校验和镜像构建不宣称部署成功。实现位于生图仓 `codex/image-independent-backend` 隔离工作树，详细增量证据见本仓 `docs/verification/independent-image-release-20261023/`。

仍待外部负责人提供或确认的正式输入：正式 MA 登记与应用 ID 签发、画布可达的 HTTPS 网关、服务端运行时凭据/API Key、逐已验证调用者的模型凭据 broker（`IMAGE_MODELS=disabled` 仅覆盖 CPU/矢量部署）、以及 Agent 工具桥的实际安装/发现/调用合同。真实用户设备授权只存在于显式本地维护测试，不是生产凭据；页面规则预读取不是 MA 自主 Agent 调用。实际 Devin SWE2 使用已安装 CLI 完成旋转、云端保存、下载、同键重放与拒绝越权；另已从画布读取完整资源引用，再通过 Image CLI 下载原资源并校验哈希。此为外部 Agent 的真实 CLI 验收，仍非 MA 执行环境工具桥；以上内容不累计为四 App 正式 MA 或生产通过。

原 18582 历史 local-test 入口及数据保留不动；旧 69 动作矩阵适用于原画布承载 profile，不作为独立后端的验收依据。

当前目标仍进行中。App自有后端、CLI、组件和制品问题继续由本项目修复；以下未提供的宿主能力不能靠App放松权限或改动作schema补齐。

## 2026-10-23 首次部署与原始 MA 复核

已补齐独立的私有存储首次部署工具，覆盖四 App 的完整业务/运行集合、索引、桶及适用 namespace。它从 TypeScript 打包为独立 Node 24 制品，默认计划无凭据/云端 I/O；只读核查、显式创建分开，未知归属、宽 ACL、schema 差异和已有写者均拒绝，不迁移旧业务数据。28 项源级检查、全新目录下 20 项实际进程/HTTPS 协议 fixture 检查及类型/guard 已通过；这些不是正式资源已经获批或创建的证据。工具与交付说明见 [私有存储初始化](../deployment/private-storage-bootstrap.zh-CN.md)。

原始 MA 页面当前可正常登录，应用管理仍显示“后端尚未完成该业务的存储验收，暂时无法执行此操作”。远端已更新到 `367127668da7e35daf0fa7393040e920a339d069`，目录/Agent 桥 8 处关键文件与本地 `fa9475183` 的 Git blob 一致，已只读复核：Managed Agent 定义没有 `externalMcpInjection`，run-scoped toolBundle 校验拒绝该运行时，ma-bridge 的本轮输入为 `user.message` 文本，没有已验证的 App Provider/CLI 工具登记通道；远端是否预装其他工具另需负责人确认。没有修改宿主、SDK 或 Agent 编排来规避这些缺口。目录、工具桥、逐用户模型 broker 与正式测试身份仍由对应负责人提供；外部 Devin SWE2 的 CLI 成功不替代它们。

## Agent 自主调用与宿主预执行

本机原宿主 `yihan-dev-ma@fa9475183ee91b4e4ba948eee7f86312db4022f4`：

- `ma-v/src/api.ts:258–284` 在发模型消息前取应用说明，调用 `planApplicationConversationAction` 并可先执行一次动作，再把executedAction交给模型。
- `ma-v/src/session-apps/conversation-action.ts:40` 选择读/写意图及无需必填参数的动作，不做LLM参数生成或多步规划。
- `packages/contracts/src/api/ma-v.ts:79` 明确结果来自宿主已执行动作，没执行则不能声称已读/已写。
- `apps/daemon/src/routes/runs.ts:1208` 当前仅在入参处校验applicationInstanceId格式；本次在该文件未找到把该字段变成App工具注册的后续处理。

本轮页面已经证明“规则预读取→Provider真实结果→真实Managed Agent总结”，不能将其命名为Agent自主选择/参数化多步调用。后续需要宿主Owner明确并提供受控工具桥的实际接入合同/环境：工具发现、目标实例、可信调用身份、动作参数、写前版本、幂等和回执/取消。App继续保持严格必填参数与资源归属；不能为凑现有关键词规则而把必填nodeId等删掉，不能给Agent浏览器票据或让它直连Provider冒充宿主。

## 正式权限与跨App数据

本地身份/目录fixture只用于隔离验收，四App业务数据互通必须是有声明的导出/引用/投递，不共享业务数据库或另建一套MA权限表。相同租户并不自动获得其他App实例权限。跨App调用需明确目标实例授权或委托凭据合同；测试actor与维护者设备模型授权都不是生产逐用户授权。

草图本地bind当前返回unbound、文档持久mirror queue未配置，已测明确拒绝及正文/版本不变。正式环境需要业务绑定/投递配置及目标作用域验证，然后补实际写入、回读、冲突/重试与撤权检查。

## 下一段：云端权威存储的页面验收

当前18582为显式local-test，不改它的数据根或覆盖其中5张测试图。下一步先核对现有Appwrite配置/私有schema与运行锁，优先复用本轮拥有的空测试库或现有测试集合的独立namespace，不再盲建无法删除的新数据库。

若建立云端拼装页，应使用另一个显式隔离入口/目录/namespace，服务端私有凭据、loopback、醒目的“模拟身份＋真实Appwrite”标记；缺配置即拒绝。验证页面创建/编辑/文件/重启读回，和受控MA租户/实例/动作拒绝。既有local-test页面和数据保留。真实MA身份、登记、逐用户模型授权及staging仍分开验收。
