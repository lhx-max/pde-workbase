# 四 App 统一交付与验收 · 2026-10-22

本批由 Root 定义合同、派发并监管 Devin，只用 SWE2；最终结论按 Root 独立复验。范围是画布、文档、草图和画布承载的生图能力，浏览器 App 不在本轮。原分支、原 Git index 与用户未提交工作保留，交付代码位于公司 `codex/app-acceptance-20261021` 验收分支，不合 main、不部署生产。

## 已落地内容

- 统一 MA 身份和服务端动作授权边界；Canvas 项目、Doc/Sketch 资源、绑定和回执核对完整应用/实例/Provider 元组。同实例获准成员可以协作，不把 createdBy 当读锁；旧缺映射资源不自动认领。列表、文件、正文、回执重放与长连接均检查当前访问。
- 云端保存业务头、正文/场景、规范文件字节、版本、恢复意图、回执与治理记录；严格 JSON 状态口和实际单写者锁。生产入口拒绝不完整配置及非私有存储，不能用维护 Cookie 运行共享生产。
- Doc/Sketch 保留不确定请求的原键、输入及版本，提供显式重放/查看/确认；普通重渲染保留草稿，换实例拒绝旧请求与保存回调。配置工厂收到不可变身份快照，不依赖 MA 必定传 providerClient。
- Canvas 补云文件/目录/搜索/受限预览/ZIP/版本恢复、产物守卫与跨 manifest 引用重命名；HTML 手动版本标签和说明真实云保存、重建读回。Doc 补私有附件字节、整数 Provider 版本与持久回执；Sketch 补完整归属和持久恢复。生图回执/请求按当前已验证调用人分域，缺稳定请求 ID 时在执行前拒绝，失败/重启不自动再次调用模型。
- Node 24 服务容器及独立组件包；一套共同合同和 Skill 仓库索引。Kit 提供 SDK/静态 Preview，yihan-dev-ma 是另一个仓库中的 MA 基座分支；不修改对方 SDK、菜单、Agent 编排来让验收通过。

## 当前独立证据

| 项目 | 当前通过结果 |
| --- | --- |
| Canvas 后端 | 596 通过、1 跳过；服务及测试类型检查通过 |
| Canvas Web | 512 通过；类型检查通过，使用本批 Doc/Sketch 包重新验证通过 |
| Doc | 后端 179；挂载行为 7；组件、服务和独立页面构建通过 |
| Sketch | 后端 51；前端 34；组件、服务和独立页面构建通过 |
| Image | 15 项；类型与构建通过，任务后台由 Canvas 承载 |
| 组件/契约等包级检查 | 16 个 in-scope 包类型检查通过；10 个含测试的包共 932 项通过；canvas-core 无独立用例，删除空 test 脚本，其语义由契约与服务测试覆盖 |
| 共用基础 | 云状态 35；authority 8；真实原子 writer lock 5 |
| 真实 Appwrite | 跨 Canvas/Doc 74 项，Sketch 18 项；均清理本次创建对象 |
| 生产存储预检 | 三套现有开发库均被拒绝；只读检查，没有改旧 ACL |
| 干净检出 | 四仓干净检出、冻结锁安装和构建通过；四包独立消费者安装、类型、浏览器打包和纯 Node 出口验证通过 |

三个最终服务镜像的 16 项真实运行检查通过：非 root、缺生产配置拒绝、read-only/cap-drop 隔离 local-test 的实际 HTTP 启停及原生 PDF/视频工具。这仍不算云端生产部署。

实际输出在 [证据目录](verification/four-app-completion-20261022/README.md)。自有 MA/模型/镜像 fixture 不能替代正式 MA、真实 Agent 或上线。付费生图调用为零。

## 版本与位置

验收分支统一为 `codex/app-acceptance-20261021`；四仓代码均已推送并核对公司远端。下表固定本批已验代码提交；画布后续汇总提交更新交付记录、制品与包级检查入口，不改变已验运行源码。

| App | 代码提交 |
| --- | --- |
| canvas | `d3e94ea65d02ba065e0f3cdb51afcacc70120c56` |
| doc | `b6ac73127d5e3a86b8efc5f0bed2821b76669ead` |
| sketch | `af351a7e2570d8dfc0265bba4550de31c1bb8d3b` |
| image | `92084c9f578962af5bc1dc005ec8c728d82d39fd` |

组件待发布制品：Canvas 0.1.4、Doc 0.1.3、Sketch 0.1.4、Image 0.3.1；未冒充已发布到 npm。本批本地 vendor 用内容哈希文件名，冻结锁需和真实 tgz 字节一致，不沿用同名包的旧缓存校验值。

## 真实 MA 与部署门

正式目录、业务用户 SSO、实例关联、动作授权结果、资源鉴权桥、真实 Agent 工具调用及 staging 尚未通过。后续已通过既有浏览器会话找到本地 MA 宿主，侧栏显示用户，但真实应用管理提示「后端尚未完成该业务的存储验收」。因此当前阻塞已定位到应用目录相关后端门禁，不能继续概括为缺测试站入口；页面身份显示也不代表业务身份验收通过。详见 [实站复查与交接条件](verification/four-app-completion-20261022/ma-live-storage-gate.md)及截图。未改对方宿主、开关或已有实例。

现有开发 collection/bucket 的 users-read 不满足生产隔离；完整 Node 运行身份、私有存储和稳定 HTTPS 网关仍需平台提供并实测。旧 Canvas Function 只提供部分健康/声明接口，不是本版完整业务服务。具体交付入口见 [部署说明](../deployment/README.zh-CN.md)；App 自有工厂必须配置正式凭据 getter 和资源桥，不能把 factory 函数或未配置的裸编辑器当已接入组件。

## 有意保留的边界

- 全工作区类型检查仍因浏览器范围外两个缺失 E2E fixture 失败：extension-fixture.js 与 browser-fixture；未为本轮改浏览器。in-scope 包级检查另列通过。
- cloud 的高级 powered preview 和包含全部内部状态的归档明确不可用；普通文件/ZIP、受限 HTML/Office/PDF 预览与 Canvas JSON 状态分开提供。不能把旧本地文件路由当云端成功。
- Sketch 的权威读取投影是主通道，旧兼容镜像没有持久重试队列；跨独立 MA 实例的关联/委托需要正式 MA 合同，不因同租户就互开数据。
- 容器 local-test 只证明可运行与负向门禁；实际 MA 宿主、资源桥、React renderer、逐用户模型授权与真实 Agent 要在正式环境独立记录。

本批 App 自有交付、代码修复和上述独立验收已完成；正式 MA、真实 Agent 和生产/staging 仍未完成，不能合并成“全部已打通”。

## 复现入口

使用 Node 24、pnpm 10.33.2，在各自验收分支的干净检出执行 `pnpm install --frozen-lockfile --ignore-scripts`，再执行该 App 的包级 typecheck/test/build。服务与组件分开构建，Root 的统一包消费者工具是 `scripts/verify-four-app-packages.ts`；本次通过的 tgz 与 SHA 在证据目录 packages/ 和 final-package-consumer.json。Canvas 包 build-report.json 指向上表代码提交并记录源文件哈希。

实际云探针是 `e2e/cloud-runtime-recovery.ts`、`e2e/sketch-cloud-scope-probe.ts` 与 `e2e/verify-production-storage-gate.ts`。它们需要明确的本机维护配置路径，仅供开发验收；不在聊天/仓库/镜像保存票据。默认单测里旧 `canvas-appwrite-service` live suite 因未注入 APPWRITE_SESSION_COOKIE 跳过，本批真实云证据来自显式探针，不冒称该旧 suite 已执行。
