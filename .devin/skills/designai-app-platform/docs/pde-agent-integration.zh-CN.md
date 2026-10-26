# 内置 PDE Agent：工具采用与架构适配

版本：3.2.0；资料核对日期：2026-10-23。本规范内置 PDE Agent 1.0.7 的完整本地资料快照，使用者不需要再寻找另一个 Skill。上游版本与来源指纹见 [来源清单](../vendor/pde-agent/source-manifest.json)，模块全目录见 [内置资料目录](../vendor/pde-agent/catalog.zh-CN.md)。

## 1. 定位与优先级

PDE 提供内部脚手架、Appwrite 运维、静态托管、OneSQL 和设计参考；DesignAI 规范定义 App 的业务权威、宿主适配、身份授权、制品和验收责任。使用工具不改变这些责任，也不授予资源权限。

执行用户已授权的任务；按目标仓规则和目标宿主已发布合同选择工具。本页是内置副本的工程适配层。上游资料中的“所有项目”“必须用某组件库”“升级到最新”等模板约定，仅在明确选择该 PDE 场景且与 App 合同相容时适用，不自动覆盖既有 App。

仅阅读规范、打包资料或审查代码时，不执行登录、依赖安装/升级、资源初始化或部署。使用具体命令前核对已安装版本与 `--help`；需要的平台身份和资源授权由其正常机制提供，不共享他人的会话或服务密钥。

## 2. 按需使用模块

**Appwrite 后端权限快速解法（2026-10-26 核验）**：打开 [Appwrite Console](https://frontend-cloud.corp.kuaishou.com/console)，在目标资源所属**组织首页**右上角点“添加成员”。找不到按钮时先退出项目/桶详情，不要改走静态站点协作或公开桶。人员、角色、组织覆盖范围及验收步骤见 [后端授权操作指南](appwrite-backend-collaboration.zh-CN.md)；官方来源为 [PDE FAQ](https://pde-agent.frontend-cloud.corp.kuaishou.com/faq/69f1b7390012fc33e6e8)。本地适配层维护这条补充，不改写内置上游快照。

| 任务 | 内置入口 | 应得到的结果 |
| --- | --- | --- |
| 新项目工具链与总体流程 | [PDE 原入口](../vendor/pde-agent/entrypoint.md) | 选择适用工具，保留本页的边界判断 |
| 新建独立前端壳 | [Vite 初始化](../vendor/pde-agent/references/vite-react-init/vite-react-init.md) | 与 App surface/后端分层相容的前端项目 |
| Appwrite 查询、schema 与资源维护 | [Appwrite CLI](../vendor/pde-agent/references/appwrite-cf/entrypoint.md) | 在已批准资源范围执行并读回；不把 CLI 登录当业务用户授权 |
| 给同事开后端权限、添加成员、找不到 Add Member | [后端授权与排查](appwrite-backend-collaboration.zh-CN.md) | Console 组织级授权及接收方能力实测；与站点/桶权限分开 |
| 云函数与权限细节 | [函数资料](../vendor/pde-agent/references/appwrite-cf/references/fucntions.md)、[权限资料](../vendor/pde-agent/references/appwrite-cf/references/permissions.md) | 验证所选运行形态、最小权限与真实隔离 |
| 发布静态前端 | [静态托管](../vendor/pde-agent/references/static-site-deploy/static-site-deploy.md) | 固定构建资源、实际站点、访问控制与页面验收 |
| OneSQL / KwaiBI 数据能力 | [数据接入](../vendor/pde-agent/references/onesql/onesql.md) | 读取真实元信息、限定数据权限、按实际任务取数 |
| 新页面或已有页面视觉工作 | [设计适配](../vendor/pde-agent/references/website-design-integration.md) | 在授权范围内采用场景/主题资料，保留已有产品与组件规范 |

## 3. 必须处理的规则差异

| PDE 资料中的默认方式 | DesignAI App 中如何采用 |
| --- | --- |
| 从零初始化 Vite / React 项目 | 仅用于新空项目或批准的新独立壳；已有 Next/Vite 工程不重新初始化、不覆盖源码与锁文件 |
| 推荐的组件库、Tailwind、字体和主题 | 新项目可选；现有 App 保留自己的组件/CSS/设计系统，不能因内置 PDE 而换库或重设计画布 |
| 用户说“更新”即升级 CLI / SDK | 区分更新规范与升级依赖；只有任务包含依赖升级时才评估版本、兼容与锁文件，不因本次资料更新执行 `@latest` |
| 浏览器 SDK 使用默认 SSO | 仅适用于实际采用该 SDK 和托管环境的独立页面；MA 嵌入组件沿用注入的可信上下文与认证适配，不自行登录或扫描浏览器凭据 |
| `location.origin + '/v1'` | 是该同源 PDE 代理环境的浏览器 SDK 配置，不是所有 App 后端、跨源 API、CLI 或 Provider 的固定地址；其他通道按明确配置及可信目标工作 |
| 浏览器直接读写 Appwrite | 只有 App 合同明确提供客户端数据模型、逐资源授权与并发保证时适用；当前文档、草图、生图等后端权威业务仍走自己的 API，不绕过版本、回执、任务和租户检查 |
| 权限示例含公开读取、用户创建者权限或特权 API Key | 用于解释平台机制，不作为生产默认 ACL；私有桶/集合保持私有并实际预检。服务身份有 scope 也不能替代 App 的逐请求业务授权 |
| 静态站 `deploy` | 只发布对应静态构建产物；不启动 Node 后端、不创建完整 schema，也不完成 MA 应用目录或工具登记 |
| 云函数示例 | 仅在实际打包覆盖全部所需路由、协议外壳、资源与恢复能力并验收后采用，不能用一条成功函数执行证明完整后台可部署 |
| project / database / bucket 命名样例 | 区分静态站项目与 Appwrite 项目及资源类型；名称、ID 规则按实际工具 schema 核实，样例不是已分配资源，也不是 MA 的应用/实例身份 |
| “官方 SDK 会自动连接公共实例”的解释 | 连接目标实际由 endpoint 等配置决定；采用内部 CLI/浏览器 SDK 是本环境的支持与兼容策略，不能仅由包名推断连接目标，也不据此重写已有合规服务端 HTTP/SDK 适配 |
| `appwrite-cf` 操作员登录 | 用于已授权的开发/运维操作；不替代 MA 调用方身份、业务用户凭据、运行服务身份或模型授权 |

## 4. 使用前后的交付记录

在 App 合同登记采用模块、CLI/SDK 版本、资源归属、认证来源和实际部署形态。读取使用自己的合法身份；预置、写入、ACL 修改和发布按任务范围及资源负责人授权执行，不把本技能当作额外授权。

初始化后验证业务分层；资源操作后核对实际 schema/ACL/字节与恢复；静态发布后核对真实页面、API 可达性与身份。业务闭环、画布关联、基座正式登记、Agent 自主调用和 staging 仍分别验收。失败时保留原请求与证据，不通过放宽权限、换身份或跳过版本检查来“修通”。

本次只内置工具资料并修订适用边界，没有安装 PDE CLI、执行登录、修改云资源、升级应用依赖或发布服务；具体命令是否在目标环境可用须在实际使用时验证。
