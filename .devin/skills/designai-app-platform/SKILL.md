---
name: designai-app-platform
description: DesignAI App 与卡片平台开发规范。用于新建独立 App、开发画布卡片包、适配 DA/MA 宿主、交付 CLI/Skill，以及审查租户鉴权、云端存储、组件制品和接入验收。按白皮书形成开发合同，再加载对应协议；不替代业务需求定义或授予平台访问权限。
metadata:
  version: "3.3.1"
  language: zh-CN
---

# DesignAI App 平台开发

本技能是所有 DesignAI 业务 App 的共同开发规范入口；画布是其中一个 App，卡包只是按需选择的接入方式。面向首次加入项目的开发者与 AI Agent，覆盖架构决策、实现、交付、接入和验收。业务代码与当前部署状态以实际仓库及执行证据为准。

## 阅读顺序

1. 阅读 [App 架构与开发白皮书](docs/app-development-handbook.zh-CN.md)，理解责任边界、权威数据、身份、交付物和完整开发流程。
2. 阅读 [仓库、负责人、文档与云资源目录](docs/platform-resource-catalog.zh-CN.md)，确认工作仓库、资源归属和权限审批人；[分支用途](docs/repository-branches.zh-CN.md)仅为日期快照，执行前重新核对。**谁负责仓库，谁审批该仓库资源；跨仓共享访问由资源归属方审批。**
3. 在目标仓库填写 [APP_CONTRACT 模板](templates/APP_CONTRACT.template.md)，确定本次范围、接入 profile、动作、存储和验收出口。
4. 按下表加载专项合同；只实现本次适用的部分，不为纯卡包增加独立后端，不将外部依赖未提供写为通过。

## 任务与专项合同

| 任务 | 专项合同与按需资料 | 应交付的结果 |
| --- | --- | --- |
| 新独立 App | [开发规范与 API profile](docs/app-development-spec.zh-CN.md)、[统一可靠性交付合同](docs/unified-app-delivery.zh-CN.md) | 权威业务服务、独立壳、surface、API/CLI、资源配置与证据 |
| JSON 卡片或业务卡包 | [卡片包合同](docs/canvas-card-pack.zh-CN.md) | renderer、纯服务端注册入口、JSON 数据与动作；复用画布存储 |
| 卡片与深编辑 App 互联 | [App 互联协议](docs/canvas-app-interop.zh-CN.md)、[数据模型](docs/data-model.zh-CN.md) | 同实例绑定、版本化读写、文件/镜像和生命周期 |
| 文档正文与画布双入口 | [正文与同步合同](docs/document-sync-contract.zh-CN.md) | 条件写、冲突、持久投递、复制/归档与恢复 |
| DA/MA 宿主适配 | [Kit 示范与接入合同](docs/da-plugin-kit-integration.zh-CN.md) | App 自有包装层、manifest、Provider、环境和认证配置 |
| 图片/异步处理 | [图片接入案例](docs/image-integration-cases.zh-CN.md)、[图片 CLI 合同](../../../docs/image-cli-contract.zh-CN.md) | 任务身份、产物、版本、幂等、取消及条件回填 |
| 草图与场景类 App | [草图接入案例](docs/sketch-integration-cases.zh-CN.md) | 场景权威、资源引用、同实例编辑及导出授权 |
| 首次上线、npm 发包与版本更新 | [发布、更新与 npm 操作流程](docs/app-release-and-npm.zh-CN.md) | 固定制品、registry 读回、宿主消费、后端部署、正式登记、迁移、回滚与运维交接 |
| 全面验收与规范维护 | 白皮书验收矩阵、[联调问题与规范审计](../../../docs/app-development-standards-audit.zh-CN.md) | 逐门证据、明确缺口、规范影响说明 |

专项合同按对应能力适用；图片/草图案例用于按症状查阅，不是所有新App的前置阅读要求。

## 内置 PDE Agent

需要内部项目初始化、Appwrite 运维、静态托管、OneSQL 或视觉设计资料时，读取 [PDE Agent 适配说明](docs/pde-agent-integration.zh-CN.md)，再按任务读取随包内置的原工具资料。无需另找或安装另一个 Skill。仅整理文档不安装工具、不登录、不升级依赖；已有 App 沿用自己的组件、认证与发布合同。

规范适用范围及本次修订见 [规范审查记录](docs/standards-review-20261023.zh-CN.md)。

## 共同约束

- 画布保存卡片、布局与关联；业务 App 保存自身权威内容。组织、项目和正式实例目录沿用基座，不建立第二套身份或权限真源。
- 正常开发与验收使用 Appwrite 云端权威存储。缺配置、授权或 schema 时明确不可用；本地文件模式只用于显式隔离测试。
- 所有读取、写入、文件、回执和异步投递均校验适用的完整资源作用域。客户端 actor、菜单显隐和代码读取权限都不代表业务授权。
- 一次逻辑变更保留原输入、版本、身份作用域和幂等键。结果不确定时先查回执或按合同重放；不得自动重新执行有成本任务。
- UI、CLI、Provider 调用同一业务服务。surface 通过注入的 transport/API 工作，不引入另一套存储或服务端实现。
- 应用方适配宿主已发布合同。宿主、共享 SDK、菜单或 Agent 调度的缺口提交给其负责人，不通过修改对方实现掩盖。
- 独立业务、云端持久化、可安装制品、模拟接入、正式接入、Agent 自主调用和 staging 分别验收。

## 卡包开发的特定边界

信封字段由画布维护；卡包业务内容使用可序列化 `node.data`，修改通过公开 `onPatch`，资源通过注入文件端口。卡种与动作命名、数据大小及 `dataVersion` 以卡包合同为准。

前端 renderer 与纯服务端注册入口均须安装。`card.*` 未在服务端注册时不能创建；卡种 grants 仅控制能力范围，不替代用户、租户和实例授权。通用卡 renderer 覆盖与业务卡新增按各自合同实施，不修改冻结区规避注册。

## 工程与制品

- 本画布仓使用 Node 24、pnpm 10.33.2，新源码与工具使用 TypeScript。其他仓以其 `AGENTS.md`、package 与锁文件为准，并在合同中登记差异。
- 画布组件的约束为 React 18；宿主实际 renderer、peer 与 SDK 版本分别核对。不得仅凭安装包版本判断浏览器兼容性。
- 前后端私有实现不得互相导入；共享 DTO 保持运行时无关。服务数据路径由显式配置提供。
- 测试位于包级 `tests/`；页面自动化位于 `e2e/ui/`。依赖变化后更新锁文件并安装；执行本仓 guard/typecheck、相关包测试/构建及真实运行。根目录不新增 build/test 别名。
- 交付使用固定版本或内容哈希制品，包含 CSS、Worker、字体等运行资源。制品字节变化后重新安装并在实际消费宿主验收。
- 分支、合并与发布遵守目标仓库规则；从维护者指定的兼容基线开发，并在 App 合同记录分支与提交版本。

## 仓库与资源检索

<a id="仓库快速索引2026-10-21-核对"></a>

统一目录：[仓库、负责人、文档与云资源](docs/platform-resource-catalog.zh-CN.md)。其中区分 Agent 主仓、Kit 示范仓、画布、文档、草图、生图和浏览器；记录资源所在 project/database/bucket、用途、审批归属与核对来源。

开发者的本机目录不能成为发布包的依赖。仓库分支、制品版本、ACL 和运行地址在执行前重新核对；历史验收不自动适用于当前版本。

## 执行与维护出口

提交前必须能回答：该功能在哪个 profile 生效；谁拥有数据及授权；如何复现成功、失败和重启恢复；哪些外部条件尚未提供。

开发中发现影响规范的变化时，在同一交付中更新对应合同、模板、资源目录或案例，并附证据。仅涉及某个业务实现的问题留在该 App；不将临时端口、测试模型、一次自动化故障或某次测试数量固化为平台规则。具体流程见白皮书“规范维护与兼容变更”。

规范仓检查命令：`pnpm exec tsx scripts/verify-app-standard-docs.ts`；附加交付文档可用重复的 `--extra-md` 参数传入绝对路径。Skill frontmatter与目标Agent发现能力另验。
