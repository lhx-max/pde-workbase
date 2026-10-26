# DesignAI 仓库、负责人、文档与云资源目录

修订日期：2026-10-23。用途：开发定位、资源归属与权限申请。本目录保存非敏感标识，不保存账号口令、会话、token、私钥或服务写凭据。

**审批规则：仓库负责人管理并审批该仓库所属资源。跨仓使用代码、组件、接口或存储时，向资源归属仓库的负责人申请。** 不因同团队、同项目或能安装包而自动获得其他 App 的资源权限。

负责人是业务和接入的审批入口，不等同于已获得全部平台管理权限。具体授权由该负责人依实际平台能力完成；平台禁止的操作交由其协调处理，不由开发者绕过。

## 1. 仓库与责任人

统一入口：[KDev design 仓库组](https://kdev.corp.kuaishou.com/git/groups/design/-/overview?groupId=32960)。下列负责人为资源审批入口，审批归属遵循上方规则。分工变化时在本表更新，不从提交作者推测负责人。

| 仓库与角色 | repoId / 在线入口 | 负责人及审批入口 | 职责与优先文档 |
| --- | --- | --- | --- |
| Agent / DA 主产品 | 633849 · [design-ai-client](https://kdev.corp.kuaishou.com/git/design/design-ai-client/-/files?branchName=yihan-dev-ma&repoId=633849&repoName=design-ai-client) | 王一寒 | 宿主、目录、实例、会话及Agent接缝。读 AGENTS、ma-applications contracts、实际Provider调用实现 |
| App 示范 / SDK / Preview | 647255 · [design-agent-plugin-kit](https://kdev.corp.kuaishou.com/git/design/design-agent-plugin-kit/-/files?branchName=master&repoId=647255&repoName=design-agent-plugin-kit) | 王一寒 | 基于其后端的示范仓；README、packages/sdk、registry。不是DA主产品或单纯测试库 |
| 画布 / 画板 / 平台卡包 | 647299 · [designai-app-canvas](https://kdev.corp.kuaishou.com/git/design/designai-app-canvas/-/files?repoId=647299&repoName=designai-app-canvas) | 朱志恒 | 本规范、画布/布局/卡片、API/CLI、App关联和共享能力；读本Skill、白皮书及专项合同 |
| 文档 | 647337 · [designai-app-doc](https://kdev.corp.kuaishou.com/git/design/designai-app-doc/-/files?repoId=647337&repoName=designai-app-doc) | 朱志恒 | 正文、附件、版本与镜像；读 README、docs/APP_CONTRACT.md、docs/reliability-status.zh-CN.md、packages/doc-surface |
| 草图 | 647314 · [designai-app-sketch](https://kdev.corp.kuaishou.com/git/design/designai-app-sketch/-/files?repoId=647314&repoName=designai-app-sketch) | 朱志恒 | 场景、资源、导出及画布关联；读 docs/APP_CONTRACT.md、docs/cloud-loop.zh-CN.md、skills/sketch-cli/SKILL.md |
| 图片 / 生图 | 647896 · [designai-app-image](https://kdev.corp.kuaishou.com/git/design/designai-app-image/-/files?repoId=647896&repoName=designai-app-image) | 李鹏 | 根工具包、独立后端与editor分别交付；读 docs/INDEPENDENT_BACKEND.md、deployment/README.zh-CN.md、docs/INTEGRATION.md、docs/MVP_API.md、docs/PREINTEGRATION_STORAGE_AUDIT.md；editor另读其docs/APP_CONTRACT.md |
| 浏览器 | 647315 · [designai-app-browser](https://kdev.corp.kuaishou.com/git/design/designai-app-browser/-/files?repoId=647315&repoName=designai-app-browser) | 朱志恒 | 浏览器/采集能力；读 README、docs/APP_CONTRACT.md、packages/browser-surface |

`yihan-dev-ma` 是 `design-ai-client` 的宿主兼容分支，不是独立仓库。开发前核对目标仓库的实际分支、提交和发布版本；分支命名与合并规则由各仓库维护。

## 2. 文档与规则来源

| 查什么 | 入口 | 如何使用 |
| --- | --- | --- |
| 完整App架构和开发流程 | [本规范白皮书](app-development-handbook.zh-CN.md) | 新开发者首先阅读；不等同当前实现状态 |
| App/卡包/互联与可靠性合同 | [Skill入口](../SKILL.md)、[API规范](app-development-spec.zh-CN.md)、[统一交付](unified-app-delivery.zh-CN.md) | 选择适用profile，具体业务写入App合同 |
| Plugin Kit 示范与目标宿主合同区别 | [Kit接入对照](da-plugin-kit-integration.zh-CN.md) | 示范默认值、目标正式合同、我方增补分开 |
| npm 发包、上线、升级与回滚 | [App 发布与更新流程](app-release-and-npm.zh-CN.md) | App 负责人交付制品/服务，消费宿主与基座负责人接收；具体流水线和权限按各仓合同 |
| 平台接入与Agent交互讨论 | [接口讨论稿](https://docs.corp.kuaishou.com/d/home/fcACsszYx9ZQJGtALxvNvjOmB) | 讨论输入，不直接视为已发布接口 |
| 画布API/CLI交付 | [交付清单](https://docs.corp.kuaishou.com/d/home/fcADDekZlj7cYdiKoV4Jmqze-)；仓内 docs/canvas-agent-cli.md | 在线资料与当前安装CLI版本相互核对 |
| 规范修订依据（资料性） | [规范审计](../../../../docs/app-development-standards-audit.zh-CN.md) | 记录增删改理由和证据，不代替规范正文 |
| 版本化实现与验收证据（资料性） | [后端与CLI证据](../../../../docs/verification/ma-backend-local-20261022/README.md)、[宿主合同缺口](../../../../docs/ma-owner-contract-gaps-20261022.md) | fixture、真实Appwrite、真实模型、正式MA分别判断 |

本规范包直接提供仓库、资源、用途、负责人和申请规则，无需依赖开发者的个人技能库或项目笔记。外部技术文档用于补充背景；正式接入以目标环境已发布合同为准，讨论稿与历史验收报告均不是接口承诺。

## 3. Appwrite 资源：项目、库、集合和桶

当前共用数据项目的API为 `https://frontend-cloud.corp.kuaishou.com/v1`，projectId为 `grworkspace`。此ID是存储项目标识，不是MA的bizId、applicationId或用户身份。数据库保存业务元数据/版本/索引，桶保存规范文件字节；路径和fileId均不授予访问权。

资源元数据核验日期：2026-10-22。下列三套开发资源已通过只读 GET 核验存在。**桶均保留已登录用户的开发读取授权，不满足生产私有存储要求；不能把服务端新文件收窄当作已消除桶层的宽读授权。** 正式环境须另做实际私有存储预检和可信业务授权。

| App / 资源归属仓库 | 数据库 / 集合 | 桶 | 用途 | 负责人及审批 |
| --- | --- | --- | --- | --- |
| Canvas · designai-app-canvas | `canvas_app_dev`：`canvases`、`canvas_operations`、`canvas_files` | `canvas_assets_v2` | 画布状态/操作回执/文件索引；桶保存画布文件、图片、视频、导出及规范产物 | 朱志恒 |
| Canvas平台内部注册与恢复 | 同库：`card_packs`、`card_grants`、`apps`、`app_runtime_state` | 沿用上桶，按实际产物类型 | COI卡包/显隐能力登记和类型化运行恢复；不是正式MA组织/应用目录的另一真源 | 朱志恒 |
| Doc · designai-app-doc | `doc_app_dev`：`documents`、`app_runtime_state` | `doc_assets_v2` | 正文索引、业务归属/内容版本；桶保存不可变Markdown正文及文档图片等资源；运行态保存持久回执和恢复/投递信息 | 朱志恒 |
| Sketch · designai-app-sketch | `sketch_app_dev`：`sketches`、`app_runtime_state` | `sketch_assets_v2` | 场景索引、MA归属和版本；桶保存场景JSON、图片导出及持久回执对象；运行集合承载写锁等状态 | 朱志恒 |
| Image独立后端 · designai-app-image | `image_app_dev`：`app_runtime_state` | `image_assets_v2` | 独立工作区、配置、任务、回执、索引与恢复；桶保存原图、结果图、蒙版、图层、预览及工程文件。资源已私有预置；独立后端与部署制品已实现并有真实云端/容器级验收证据，正式部署、宿主登记与 Agent 调用另列验收 | 李鹏 |

`app_runtime_state` 的 namespace、slot、payload 等是持久状态合同；集合存在不证明所需字段、索引和锁已经可用。每次新环境预置仍需检查实际 schema，不能照抄旧开发库“已建好”。

Image独立资源核验日期：2026-10-23。`image_app_dev/app_runtime_state` 为 `documentSecurity:true`、集合授权为空；`image_assets_v2` 为 `fileSecurity:true`、桶授权为空，单文件上限30,000,000字节。资源存在和 schema 就绪不代表业务后端、模型执行或宿主接线已经通过。

生图独立后端的合同、部署制品与当次验收证据见生图仓 `docs/INDEPENDENT_BACKEND.md`、`deployment/README.zh-CN.md` 及 `docs/verification/`；画布侧仅保存布局、目标作用域、资源引用、投递回执与认证预览。正式 MA 登记、HTTPS 网关、运行时凭据、逐用户模型授权与 Agent 调用仍为外部输入，不因后端实现或资源私有而改为通过。

生图必须使用自己的业务存储和私有桶；画布仅维护布局、资源引用、预览与必要的绑定/投递映射。历史画布承载 profile 的数据仍在 `canvas_app_dev/canvas_assets_v2`，供兼容读取和显式迁移核验，不作为新独立生图业务的默认落点。旧数据不自动迁移、删除或改权限。其他 App 的共享服务方案仍须明确业务权威、资源归属和授权边界。

### 生图完整editor的独立来源配置

生图仓 `editor/docs/APP_CONTRACT.md` 和 `editor/server/appwrite/schema-v1.json` 仍声明独立开发项目 `designcanvasdev20261021`、库 `canvas_app_dev`、集合 `scene_revisions`、快照桶 `canvas_snapshots_dev`；该合同还记录二进制图片桶 `canvas_images_dev`。这些与 `grworkspace` 下的同名库不同。

核验等级：仅源码配置，尚无该独立项目的在线存在性、ACL 或部署验证。生图仓负责人李鹏负责确认、审批及提供适用配置；不能把原项目凭据、历史测试或根工具联调结果当作editor正式接入。历史项目名不作为新资源配置来源。

浏览器 App 云资源尚未核验，不登记推测的桶名。部署时以其App合同和负责人确认的资源为准。

### 配置与运维资料

- Canvas资源关系见 [数据模型](data-model.zh-CN.md)；运行态预置入口为仓内 `scripts/provision-app-runtime-state.ts`，租户schema入口为 `scripts/provision-tenant-schema.ts`。脚本存在不代表开发者应直接运行。
- Doc预置/迁移由文档仓的 `scripts/appwrite-provision.sh`、`scripts/provision-provider-revision.ts` 及其部署文档维护。
- Sketch私有资源预置由草图仓 `scripts/provision-private-storage.ts` 维护，包含MA归属字段、运行锁集合及ACL/schema检查。
- 所有初始化、ACL修改、写者身份或备份/回收操作，先经所属仓库负责人审批；开发者读字段不需要维护者写凭据。
- 预置前确认平台允许的清理/恢复方式。平台禁止删库或集合时，保留实际限制与资源归属记录，由资源负责人处理，不绕过平台约束。

## 4. 申请什么权限、找谁审批

| 需求 | 向谁申请 | 申请时说明 | 审批后的技术核对 |
| --- | --- | --- | --- |
| Git仓库读取/开发 | 目标仓库负责人 | 仓库、人员、角色、分支与工作范围 | 实际Git角色/保护分支；读取不等于可合并 |
| npm读取/发布 | 包归属仓库负责人 | registry、scope、包名、读取或发布、目标版本 | 实际scope授权；安装不等于后端授权 |
| 查看Appwrite开发资源 | 资源归属仓库负责人 | project/database/collection/bucket、只读范围、使用者与用途 | 当前ACL和本人登录态；已有合法默认读授权时无需重复改ACL |
| Appwrite写入/预置/维护 | 资源归属仓库负责人 | 隔离环境、具体资源与操作、身份、有效期、清理/恢复方式 | 服务身份/实际写scope；不共享个人管理员Cookie |
| 调用App业务API或跨App取源 | 被调用/资源归属仓库负责人 | 调用方、目标租户/biz/实例、动作、读写与文件范围 | 可信身份/委托、资源归属、动作与撤权；同租户不自动跨实例 |
| 宿主登记、SDK或Agent接缝 | 王一寒（相应宿主/Kit仓） | 组件版本、manifest、Provider、网络、身份和所需工具能力 | 正式合同/实际登记与调用；模拟目录不算授权 |
| 生图模型或专项处理服务 | 李鹏（生图仓）；涉及Canvas资源另找朱志恒 | 模型/能力、调用者、成本限制、测试范围、存储目标 | 授权ready、可用能力与真实结果；维护者设备授权不替代逐用户授权 |

申请信息的最小格式为：`仓库/资源归属 → 环境与资源ID → 申请人/运行身份 → 操作及数据范围 → 用途与期限 → 验证及撤销/清理方式`。工单或沟通渠道由该仓库负责人指定，不编造统一群、邮箱或平台审批API。记录授权结果的范围和时间，不保存秘密值。

## 5. 目录维护

新增仓库、负责人变化、新建/替换资源、用途变化、审批或权限边界变化，必须在同一交付中更新本目录及受影响的 App 合同。实际运行地址、namespace、制品版本和验证状态由App合同/部署清单维护；本目录保留日期与来源，不把临时测试配置写为通用默认值。

本目录的资源标识与用途来自各仓库的 App 合同、schema/预置脚本及资源元数据。元数据核验不代替完整 schema、ACL、业务读写或生产验收。维护者更新时记录核验日期、来源版本与核验等级，保留不含凭据的证据；历史记录见仓内 `docs/verification/app-standard-whitepaper-20261022/`。
