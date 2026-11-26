# 画布工作区

四 App 当前部署候选与验收边界见 [2026-10-23 部署交付](deployment/DELIVERY-20261023.md)：固定四服务镜像、Image 0.9.1 组件、私有存储首次初始化和可复现证据；正式 MA/Agent/staging 的未通过项单独列明。

> 2026-10-21 网页采集最新进展：画布内浏览器入口已挂载采集 App；一个 Chrome 扩展合并划词、图片和资源批量采集，真实 Appwrite/Chrome 闭环已验收。安装物、数据归属和未上线边界见 [网页采集接入](docs/web-collector-integration.zh-CN.md)。下文原生桌面浏览器段落属于历史提取能力，不代表当前纯在线产品。

从 Bezier/Loom 原仓库独立抽取的画布创作工作区。保留原画布、组件、样式和交互，包含原 **画布／资产／采集** 三个入口及独立本地资产库，并通过隔离文档接入 **MF 开放对话 UI**；不恢复原聊天产品或原账号／团队平台。

原始版本：`319e5eee556a3641d2ee68a6111a36ddc7a1eff7`。来源与授权见 [NOTICE](NOTICE) 和 [LICENSE](LICENSE)。

本轮画布/文档/草图/生图按 [统一交付合同](docs/four-app-delivery-contract.zh-CN.md) 验收，结果与阻塞见 [统一验收记录](docs/verification/four-app-acceptance-20261021/README.md)。

启动服务必须显式配置 Appwrite；仅隔离测试允许 `CANVAS_STORAGE_MODE=local-test`。MA 写动作配置 `APP_WRITE_GRANTS_JSON`；跨 App 转发 MA 凭据必须配置精确 `CANVAS_TRUSTED_APP_ORIGINS`（逗号分隔，仅 HTTPS 或明确 loopback HTTP），否则拒绝转发。实例可见不自动授予写入权限。

## 开发规范入口

开发者和 AI Agent 开工前先读仓库内的 [App 平台开发 Skill](.devin/skills/designai-app-platform/SKILL.md)。没有项目背景时，从其中的 [App架构与开发白皮书](.devin/skills/designai-app-platform/docs/app-development-handbook.zh-CN.md) 开始；新 App 使用 [开发与接入合同模板](.devin/skills/designai-app-platform/templates/APP_CONTRACT.template.md)。规范覆盖独立前后端、卡包与深编辑、MA-V 接入、CLI/安装交付及分级验收。仓库负责人、相关文档和Appwrite桶用途/审批见[资源目录](.devin/skills/designai-app-platform/docs/platform-resource-catalog.zh-CN.md)；后续开发涉及规范边界时在同一交付同步更新。Agent 入口同时见 [AGENTS.md](AGENTS.md)。

## 项目结构与接入关系

**App 是有业务、后端和权威数据的小产品；npm 包是交付物。** 卡包安装到画布，画布/文档组件及包装层安装到宿主，CLI安装到MA执行环境，后端独立部署。

```text
卡包 → 画布组件 → MA-V画布App包装层 → 基座标签页
文档组件 → 画布详情 / 独立页面 / MA-V文档App包装层
界面 → API适配器 → App后端 → 各自权威存储
MA → CLI或正式工具 → 认证网关/Provider → 同一App后端
```

| 位置 | 责任 / 入口 |
| --- | --- |
| `apps/web` | 独立画布工作台、页面和本宿主适配 |
| `apps/server` | 业务、文件、操作回执、COI/Provider与存储；[服务端说明](apps/server/README.md) |
| `packages/canvas-surface` | 对外画布组件；[安装、props、CSS与限制](packages/canvas-surface/README.md) |
| `packages/canvas-cli` | 独立HTTP客户端与Skill；[安装与使用](packages/canvas-cli/README.md) |
| `packages/canvas-card-sdk` / `packages/canvas-pack-*` | 卡包类型、渲染器、纯服务端kind/动作入口；[卡包合同](.devin/skills/designai-app-platform/docs/canvas-card-pack.zh-CN.md) |
| `packages/contracts` | 共享纯类型/协议；前后端不互相导入私有实现 |
| [独立文档仓 `design/designai-app-doc`](https://git.corp.kuaishou.com/design/designai-app-doc) | 公司Git私有仓，默认main；文档后端、权威正文和 `@ks-designai/doc-surface`。Git权限与npm/数据权限分开；本机未提交改动不等于线上已有 |
| [独立草图仓 `design/designai-app-sketch`](https://git.corp.kuaishou.com/design/designai-app-sketch) | 草图场景归 `sketch_app_dev` / `sketch_assets_v2`；开发云端闭环及私有存储27项外部CLI/HTTP Provider检查通过，后者身份使用合同fixture；断网恢复及本机卡片/详情同实例读回已验。最新边界见该仓 `docs/readiness-fixes-20261021.zh-CN.md`；`@ks-designai/sketch-surface@0.1.2`已发布内网npm并经registry下载、仓外构建验证；[实时快照与重复打开补验](docs/verification/sketch-live-preview/README.md)，正式MA/staging未验 |
| 外部MA-V / Plugin Kit | 身份、目录/实例、会话、宿主和MA调度；我们适配已有合同，不修改其内部机制 |
| `e2e` / `docs/verification` | 集成验收与运行证据 |

画布保存卡片/连线/布局；绑定文档的权威正文归文档App，画布保留可编辑镜像。正文保存与镜像同步分别确认。卡片详情打开原绑定，使用资产则创建独立副本。详见 [架构](docs/architecture.md)、[双App关系与状态](docs/canvas-doc-relationship-and-status.zh-CN.md)。

## 后端数据与开发者只读访问

租户/团队与卡片权限的实际接入见 [团队云端接入](docs/tenant-cloud-integration.zh-CN.md)：画布/文档归属字段已补入开发云库，App侧支持MA身份验证、团队卡种规则、后端越权拒绝及空缓存恢复。真实MA登录/部署与npm发布尚须另验，不能由隔离身份fixture或旧安装包推断通过。

**开发方向（2026-10-21）**：后续以 Appwrite 云端为默认存储与真实验收环境，缺少云端配置须明确报错，不静默回退本地。本地仅用于显式隔离测试或可丢弃缓存；项目目录和身份沿用基座合同。历史本地路径的启动示例不代表推荐的正式云端运行方式，现有云端缺口见 [本地/云端核对](docs/local-cloud-data-audit-20261021.zh-CN.md)。桌面旧 `canvas-data` 已清理，不重新创建。

文档源码从上面的公司Git仓获取；业务接口由对应App服务提供。Appwrite API `https://frontend-cloud.corp.kuaishou.com/v1`，项目 `grworkspace`；画布库/桶 `canvas_app_dev` / `canvas_assets_v2`，文档库/桶 `doc_app_dev` / `doc_assets_v2`。这些资源已在2026-10-21完成默认只读配置与真实账号验证。

**默认已登录用户可读上述Appwrite资源，无需逐人申请；不能新增、实际修改、删除或上传。匿名不可读，写入只给明确维护者/服务身份。** 普通读者也不能执行两条带写权限的云函数。使用自己的平台用户会话读取，不发维护者cookie、函数key或通用 `CANVAS_AUTH_TOKEN`；写入联调用自己的隔离测试环境。Appwrite读取不等于向所有COI/Provider业务接口发放通用token，也不代表其他库/管理员权限被改变。

实际读取路径见 [开发者访问说明](docs/developer-read-only-access.zh-CN.md)，7个集合/2个桶/2条写函数的配置及25项真实验证见 [只读验收](docs/verification/developer-readonly/README.md)。保护已在云端生效；通用HTTP业务token的细粒度reader角色仍需另接，不能只靠README写“不要修改”。

## 内网 npm 安装与交付状态

2026-10-21 已从快手内网 `https://npm.corp.kuaishou.com/` 查询到画布/文档/CLI三个固定版本；草图0.1.2另已发布并从registry读回验证。安装需要公司网络和读取权限；升级以实际发布记录为准。

| 包 | 版本 | 安装位置 / 作用 |
| --- | --- | --- |
| `@ks-designai/canvas-surface` | `0.1.2` | 宿主前端项目，画布组件与CSS |
| `@ks-designai/doc-surface` | `0.1.2` | 宿主前端项目，文档编辑器与CSS |
| `@ks-designai/sketch-surface` | `0.1.2` | 草图编辑器、`/da`包装与纯Node `/manifest`；后端独立部署 |
| `@ks-designai/canvas-cli` | `0.1.1` | MA容器/工作区或开发者环境，调用真实App后端 |

前端消费方在自己的项目中安装：

```sh
npm install @ks-designai/canvas-surface@0.1.2 @ks-designai/doc-surface@0.1.2 \
  react@18.3.1 react-dom@18.3.1 @xyflow/react@12.8.5 \
  --registry=https://npm.corp.kuaishou.com/
```

命名导出、CSS和API注入按包说明接入；安装依赖不会自动出现宿主菜单。还需要包装层、manifest、Provider配置与实例映射。当前画布组件共用宿主的一份React renderer，不捆绑第二份React。

CLI安装到实际执行命令的环境（Node 24），不另启服务或另存一份画布：

```sh
npm install -g @ks-designai/canvas-cli@0.1.1 --registry=https://npm.corp.kuaishou.com/
canvas-cli --version
canvas-cli --help
export CANVAS_SERVER_URL='https://<当前执行环境可达的画布API地址>'
canvas-cli apps list
```

地址占位符要替换；远端MA的loopback不指向开发者电脑。认证凭据按部署合同通过环境/密钥管理注入，不写进提示词或仓库；`CANVAS_TEAM_ID/CANVAS_USER_ID`只是上下文。实例参数使用解析后的业务画布ID。包内 `skills/canvas-cli/SKILL.md` 需按MA正式加载机制安装，npm安装不会自动注册工具或授予执行权限。

[干净安装与真实读写记录](docs/verification/npm-distribution/local-install.json) 已覆盖三个包、CLI发现画布/文档、创建/读写/读回、重放、旧版本冲突与错误非零退出；另有 [浏览器渲染截图](docs/verification/npm-distribution/installed-components.png)。本地 tarball 与内网按包名下载均已复验，见 [内网安装记录](docs/verification/npm-distribution/registry-install.json)；不代表正式 MA 或 staging 通过。

## 开发、联调与验收导航

| 你要做什么 | 入口 |
| --- | --- |
| 零背景开发独立App | [白皮书](.devin/skills/designai-app-platform/docs/app-development-handbook.zh-CN.md) → [合同模板](.devin/skills/designai-app-platform/templates/APP_CONTRACT.template.md) → [API与接入规范](.devin/skills/designai-app-platform/docs/app-development-spec.zh-CN.md) |
| 开发卡包、嵌卡与深编辑 | [卡包合同](.devin/skills/designai-app-platform/docs/canvas-card-pack.zh-CN.md)、[互联协议](.devin/skills/designai-app-platform/docs/canvas-app-interop.zh-CN.md)、[卡种能力矩阵](.devin/skills/designai-app-platform/docs/canvas-card-capability-matrix.zh-CN.md) |
| 查数据、版本、复制和恢复 | [数据模型](.devin/skills/designai-app-platform/docs/data-model.zh-CN.md)、[正文增补合同](.devin/skills/designai-app-platform/docs/document-sync-contract.zh-CN.md) |
| 接一涵MA-V基座 | [接入与验收记录](docs/ma-base-integration-acceptance.zh-CN.md) |
| 看本地模拟登记效果 | [启动与复现](docs/verification/ma-registration-simulation/README.md)：18581代理原宿主18580；只模拟登记相关数据，组件使用真实本地服务，不改云端登记 |
| 查规范修正与工程缺口 | [规范审计](docs/app-development-standards-audit.zh-CN.md)；包分发部分是审计时快照，最新可发现版本见上表 |
| 查草图排障、云端深编辑与交付陷阱 | [Skill内草图案例](.devin/skills/designai-app-platform/docs/sketch-integration-cases.zh-CN.md)：规范覆盖核对、根因、解决方案及失败验收 |
| 查实际通过范围 | [功能对照](docs/feature-parity.md)、[运行记录](docs/runtime-verification.md)、[双App状态](docs/canvas-doc-relationship-and-status.zh-CN.md) |

**验收分开报告**：独立业务 → 卡片互联（适用时）→ 可安装交付 → 模拟宿主 → 正式登记与认证 → MA自主调用 → staging。npm可发现和本地读写不能证明后面各门已通过。以下原独立工作区的能力概览应结合部署profile与最新状态阅读，不代表每个嵌入包都包含整套工作台/原生能力。

### 草图当前交付边界（2026-10-21）

草图源码已推送功能分支，见[草稿MR !1](https://git.corp.kuaishou.com/design/designai-app-sketch/-/merge_requests/1)，不代表已合入main。本机草图服务17612使用云端开发库；私有staging资源为 `grworkspace/sketch_app_staging_v2/sketches` + `sketch_assets_staging`，仅完成资源准备和测试，服务未部署远端。正式MA登记/真实Agent调用、容器实建与staging验收仍待接入。画布侧本轮绑定/权限适配尚在当前工作区，不属于该草图MR；各仓Git状态独立核对。详细配置/复现从[草图仓README](https://git.corp.kuaishou.com/design/designai-app-sketch/-/blob/feat/zhuzhiheng-sketch-cloud-app/README.md)进入，不把本机端口写成生产配置。

## 原独立工作区的能力概览

下面保留原提取范围的说明；当前App拆分、可用入口与各部署限制以顶部导航和功能对照为准，已删除的历史能力不能据此恢复。

- 原画布及图片、文本、草图、分镜、视频、剪辑、网页、演示文稿节点。
- 原顶部标签及浏览器、草图、文本、剪辑入口。
- **画布**侧栏：项目文件、上传、预览、搜索、筛选、引用计数、定位、重命名、删除及拖入画布。
- **资产**侧栏与展开资产库：本地空间、文件夹、文本／文件创建、上传、元数据、收藏、批量管理、版本、导出、导入画布及从画布保存。复用原卡片、筛选器和检查器；数据不依赖原账号。
- **采集**侧栏：原内嵌浏览器、项目采集托盘、来源记录、加入画布、保存到资产库及展开到浏览器标签。
- 原 Markdown／文档编辑器、Excalidraw 草图编辑器、HTML/PPT 查看器与手动编辑、媒体预览和剪辑导出；DOCX/PPTX/XLSX/PDF 保留原结构化文本预览及下载，不是完整 Office 排版或编辑器。
- 独立后端：画布 JSON、修订冲突、文件／目录、版本、产物清单、候选交付、任务回执和工作流执行。
- 原生 Electron 浏览器宿主：WebView 导航、历史、书签、参考站点、资源观测与授权读取、页面／图片捕获、页面归档和经系统 Save As 确认的下载。浏览器批量资源与外部扩展采集进入资产库；采集托盘保留项目文件。
- 独立网页采集扩展、原保存后检查器及受条件限制的登录接续；安装须由用户确认并手动加载导出的扩展包，不会静默修改真实浏览器配置。
- 可替换的 Agent、媒体、目录、外部资产来源与宿主接口。没有配置的外部能力会明确报错，不会模拟成功。

**验证状态与限制见 [功能对照表](<docs/feature-parity.md>) 和 [运行记录](<docs/runtime-verification.md>)。** 复制代码、类型检查通过与真实交互验收是不同层次。三入口、资产／空间、原生浏览器／采集和 Office 文本预览已有真实验证；外部扩展实际采集写入已通过，但保存后编辑问题修复后的完整原生复验由用户选择暂缓，不能记为全链路验收通过。

最新[全量 UI 排查报告](<docs/full-ui-audit.md>)补齐根级样式顺序、资产卡片、提示层、统一资源选择器及演示等遗漏；27 个自动 UI 场景连续两轮通过。报告附[原始截图索引](<e2e/evidence/full-ui-audit/README.md>)与未验范围，扩展复验仍未完成。

## 界面语言

默认使用**简体中文**，包括画布／资产／采集、浏览器、编辑与保存提示、桌面自有弹窗和扩展浮层；首次打开不再随英语浏览器或系统自动显示英文，旧的自动检测语言也不会覆盖中文默认值。明确保存的英文偏好及嵌入时的显式语言选项仍受尊重。

应用显示名为“画布工作区”；包名、命令、API、文件格式和协议标识保持不变。用户自有文件名、内容与工作表名称不自动翻译；外部网页、操作系统和浏览器自己管理的权限页面仍使用各自语言。中文界面验收见 [运行记录](<docs/runtime-verification.md>)。

## 安装与构建

要求 Node **24.x**、pnpm **10.33.2**。视频导出需要 `ffmpeg` 与 `ffprobe` 可执行文件；桌面扩展打包需要系统 `zip`。Electron 为桌面浏览器模式所需；纯 Web 模式不具备跨域页面的原生 DOM／资源采集能力。

```sh
node --version
corepack enable
corepack prepare pnpm@10.33.2 --activate
pnpm install

pnpm --filter @bezier/release --filter @bezier/contracts --filter @bezier/host --filter @bezier/components -r run build
pnpm --filter @bezier/workbench-core --filter @bezier/workbench-ui --filter @bezier/canvas-workbench -r run build
pnpm --filter @canvas/mf-bridge build
pnpm --filter @canvas/mf-ui build
pnpm --filter @canvas/server build
pnpm --filter @canvas/desktop build
pnpm --filter @canvas-workspace/web build
```

`@bezier/*` 是保留的本仓库内部包名，均通过 workspace 解析，不需要原仓库、原 daemon 或原应用数据库。

## 启动

先提供**明确的绝对数据根路径**；数据规则见 [AGENTS.md](AGENTS.md#safety-and-data)。启动器不会查找或复用原应用数据。

```sh
export CANVAS_DATA_DIR='<你明确选择的绝对路径>'
pnpm tools-dev run web --data-dir "$CANVAS_DATA_DIR" --production
```

默认 Web 地址 `http://127.0.0.1:17573`，API 地址 `http://127.0.0.1:17456`。端口由启动器统一传入；端口被占用会失败，不会杀死或接管其他应用。省略 `--production` 使用 Next 开发模式。

需要完整的原生浏览器功能时：

```sh
pnpm tools-dev run desktop --data-dir "$CANVAS_DATA_DIR" --production
```

桌面模式自动为后端到原生宿主的连接生成仅本次进程使用的传输密钥，并使用独立浏览器 profile。API 的可选 `CANVAS_AUTH_TOKEN` 与该原生宿主密钥相互独立。`Ctrl+C` 停止本次启动的进程。可通过 `--daemon-port`、`--web-port`、`--browser-host-port` 和 `--desktop-user-data` 配置独立实例；并发实例必须使用不同的数据根、profile 和端口。原生能力说明见 [架构中的原生宿主边界](docs/architecture.md)。

## 三个入口与本地资产库

在画布底部工具栏打开资产侧栏，然后切换 **画布／资产／采集**。资产页右上角可展开原资产库；空间菜单提供创建、重命名和删除。删除空间默认把内容移至默认空间，只有明确取消“移动资产”并确认删除时才永久删除内容，不删除项目。

资产库由当前服务的数据根独立持久化。空间、文件夹与项目是不同概念；把资产加入画布会导入指定版本的真实字节，并记录项目使用关系，不把全局资产 ID 伪装成项目文件路径。保存对话框在用户确认前不写入，失败可保留草稿重试。

浏览器菜单内的 **Browser extension／浏览器扩展** 打开原扩展设置。书签、参考站点与采集开关通过后端持久化，不再仅存于浏览器 localStorage。原生浏览器和采集需要桌面模式；Web 会明确说明能力不可用，不以普通 iframe 冒充完整浏览器。

AI 元数据分析和外部模板目录是可选适配器，默认不可用；手动编辑元数据不受影响。浏览器“加入引用”只暂存引用，**不会立即启动 Agent**；用户下一次明确提交任务后才发送。

## MF 开放对话 UI

顶部 **MF 对话** 打开独立侧栏，不替换画布／资产／采集。实际使用锁定版本 `@ks-kp/agent-ui@0.1.5-beta.18`；安装需要有权访问公司 npm 源，仓库不保存 npm 或 MF 登录凭据。

- 画布组件包保留 React 18.3.1 的依赖／类型约束；Next 16 App Router 浏览器实际采用其自带的 React DOM `19.3.0-canary-3f0b9e61-20260317`，不能把安装声明当实际渲染器版本。MF 独立使用 React／ReactDOM 19.2.3，在同一监听端口的保留域名 `mf.localhost` 中运行；实测两个文档各一份 DOM 渲染器。该域名避开 SDK 的 localhost 开发令牌提取分支，不代理 `/sso-health`，不向浏览器暴露 SSO 令牌。版本化消息桥校验来源、窗口、项目、实例、请求及响应；MF 域名不能直接访问普通画布 API。
- 未配置时明确显示不可用，不加载完整 MF SDK、不发起 MF 模型请求，也不伪造会话。后端配置方式及同源／鉴权限制见 [MF 服务端说明](<apps/server/README.md>)，UI 能力和限制见 [MF 集成说明](<docs/mf-integration.md>)。
- 显式勾选 MF 作为画布执行方后，只有 MF 发起生成；本地 Agent 适配器不再重复执行。同一画布任务登记、消息发送、模型结束和实际交付是不同阶段。
- **画布定向生成要求新建 MF 对话**。当前 SDK 对已有会话复用客户端 run ID，无法可靠关联每次新提交；不会自动切换会话或清除草稿。普通历史对话和引用暂存不因此禁用。
- 只有受控交付工具通过任务、输入、修订及取消检查后，才写入画布。取消操作保证阻止本地晚到交付，不等于确认远程 MF 已停止或不再计费；远程停止使用 MF 原生停止入口。
- MF 云资源与本地资产库保持不同来源，必须显式导入真实字节。云端文件管理未开放；原生树可能仍显示相关 SDK 菜单，界面已有明确说明。可选 Office/PDF 云预览未部署其运行资产，明确不可用；原本地 Office 文本预览不受影响。

此凭据模式**仅支持单用户环回部署**，不支持共享公网或改写来源的反向代理。真实 MF 登录、云端 Origin 放行、模型与 WebMCP 端到端验收仍需后续提供授权配置；本地 HTTPS/SSE/WebSocket 测试服务不是云端登录成功的证据。完整边界、证据与后续清单见 [MF 接入与验收](<docs/mf-integration.md>)。

## 接入 Agent

### HTTP 适配器

无需添加对话系统。将服务端配置指向自己的 Agent HTTP 端点：

```sh
export CANVAS_AGENT_ADAPTER_URL='https://your-agent.example/execute'
export CANVAS_AGENT_ADAPTER_TOKEN='<可选，仅服务端持有>'
pnpm tools-dev run web --data-dir "$CANVAS_DATA_DIR" --production
```

适配器接收独立任务、请求及隔离工作区信息，返回文本与可选多文件产物。远程调用只携带已授权输入的校验字节，不会打包整个项目。准确协议见 [服务端适配器说明](<apps/server/README.md>)，共享 DTO 见 [canvas-workspace.ts](<packages/contracts/src/api/canvas-workspace.ts>)。不要把凭据写进画布 JSON、项目文件或浏览器本地存储。

一个最小交付结构：

```json
{
  "content": "生成结果正文，或者与绑定输出格式一致的内容",
  "files": [
    { "path": "outputs/example/data.json", "content": "{\"value\":1}", "encoding": "utf8" }
  ]
}
```

文件路径是项目相对路径，不允许绝对路径、越界和符号链接逃逸。原文本节点的普通生成仍自动回填；显式 `outputKind: 'text'` 才进入候选模式，由宿主调用 adopt API。没有新增原界面不存在的 Apply 面板。迟到结果不能覆盖后来的编辑；执行成功、候选保存和应用成功是不同状态。

### 进程内／自定义服务接入

使用 [server.ts](apps/server/src/server.ts) 的 `createCanvasServer`，注入自己的 Agent、媒体、能力目录和外部资产适配器。后端与 CLI 共用 HTTP 协议，调用端不需要导入后端私有实现。

嵌入前端时使用 [canvas-workbench 公共出口](packages/canvas-workbench/src/index.ts) 的 `CanvasWorkbenchSurface` 与 `createCanvasTaskSubmitter`。`transport` 支持独立 API 地址、请求函数、身份头和浏览器资源 URL；[工作区组合层](apps/web/src/components/FileWorkspace.tsx) 接入原标签、编辑器和项目资产侧栏。

**实例边界：** 原画布仍有宿主／Agent 模块级桥接状态。同一 JS 页面同时挂载多个活动画布尚不具备完整隔离保证；使用独立页面／窗口承载不同工作区。独立任务客户端与后端请求显式绑定项目，不意味着全部原 UI 单例已被改造成多实例。

## CLI 与 API

给MA安装的独立 `canvas-cli` 见上方“内网 npm 安装与交付状态”。下面是仓内 `canvas-server` 的源码/服务端兼容入口，不是独立CLI安装方式：

```sh
pnpm --filter @canvas/server exec node dist/cli.js --help

CANVAS_SERVER_URL=http://127.0.0.1:17456 \
  pnpm --filter @canvas/server exec node dist/cli.js request GET /api/projects --json
```

通用 `request METHOD /api/path --body-file FILE|- --prompt-file FILE|- --json` 可以调用同一套画布、文件、版本、任务和工作流接口。长提示可从文件或标准输入读取。

`assets` 提供 `info/list/get/create/upload/patch/batch/versions/content/export/spaces/uses/metadata/analysis/prompt/import/save`；`browser preferences` 读写书签、参考站点与采集开关。它们与 UI 调用同一套 HTTP API，不另开数据库。二进制内容用 `--output FILE` 输出，文件必须不存在；上传用 `--file FILE --mime MIME`，元数据和修订参数用 `--body-file FILE|-`。协议与示例见 [服务端说明](<apps/server/README.md>)。

浏览器资源命令使用原生宿主签发的会话授权；不能凭项目 ID 自行铸造读取权限。系统 Save As、扩展安装及真实账号登录的同意操作只在 GUI 中完成，CLI 不提供绕过确认的通道。

主要协议实现：

- [画布状态与修订](apps/server/src/routes/canvas.ts)
- [项目文件、目录、预览、标签和事件](apps/server/src/routes/files.ts)
- [Agent 任务和候选交付说明](apps/server/README.md)
- [浏览器资源授权协议](<apps/server/src/routes/browser-resources.ts>)
- [本地资产库、空间、版本、导入与保存](<apps/server/src/routes/asset-library.ts>)
- [浏览器偏好设置](<packages/contracts/src/api/browser-preferences.ts>)
- [共享项目内容布局](packages/contracts/src/project-layout.ts)

## 验证

```sh
pnpm guard
pnpm typecheck
pnpm --filter @bezier/canvas-workbench test
pnpm --filter @canvas/server test
pnpm --filter @canvas/desktop test
pnpm --filter @canvas-workspace/web test
pnpm --filter @canvas/e2e test
pnpm --filter @canvas/e2e exec playwright install chromium
pnpm --filter @canvas/e2e test:ui
```

测试使用隔离数据根及显式适配器，不需要真实 Agent 密钥。若使用本机已安装的 Chrome，可通过 `CANVAS_E2E_BROWSER_CHANNEL=chrome pnpm --filter @canvas/e2e test:ui` 选择它，测试仍使用临时 profile，不访问日常浏览数据。原生 Electron 验证需要图形会话以及允许其自身沙箱启动的系统环境；不要使用 `--no-sandbox` 绕过失败。原生验证与 Web 验证不能互相替代。完整状态见 [功能对照表](<docs/feature-parity.md>)。

## 明确不包含

- 原对话产品、聊天历史数据库、内置模型进程管理平台。
- 原账号／团队资产平台和团队协作权限后台。这里的本地资产库独立运行，不需要这些平台。
- 原产品更新器、发布控制台或托管账号登录服务。

独立采集扩展与原浏览器登录接续已经纳入；Pinterest 接续保留原 macOS、未打包开发模式限制，并须用户明确同意。真实账号登录、日常浏览器安装与系统弹窗人工确认不会由自动化验收擅自执行。

项目资产、本地资产库、画布产物和项目版本均属于本工作区的核心能力。

## 公司 npm 交付

画布组件、文档组件与独立 Agent CLI 的固定版本、安装方式、联调证据及验收边界见 [npm 交付记录](docs/verification/npm-distribution/README.md)。

### 浏览器 App 组件接入（2026-10-21）

浏览器通过 `@ks-designai/browser-surface@0.1.1` 组件挂载在画布 App 标签页中，不创建浏览器卡片；数据请求通过 `/api/browser-app` 到浏览器自己的后端与 Appwrite。当前已本地安装 tarball，真实菜单创建、组件渲染及云端实例读回通过；Web 原生采集、正式 MA 授权、registry 发布与 staging 另验。[接入与验收记录](docs/verification/browser-embed-20261021/README.md)。

浏览器重复打开复用本画布已有标签；重复顶栏已移除，采集入口在浏览器菜单中按需加载。[性能与界面验收](docs/verification/browser-open-performance/README.md)。

### 站点级 Agent 对话侧栏（2026-11-22，已按用户要求移除）

站点级 Agent 对话侧栏（左侧「唤醒我的 Agent」入口与面板）上线后经用户验收判定无用，已整体移除；画布上的 Agent 冒烟测试卡亦已删除。`/api/ma-v/agent/run` 后端为仓库既有实现，保留不动。当前 Agent 能力集中在卡片内助手与受控动作通道（见下）。

### 卡片 Agent 受控动作通道（2026-11-22）

卡片内 Agent 不再只回建议：`myflicker` CLI 保持只读决策，但在回答末尾输出 ```canvas-actions 动作块，由服务端校验后代为执行并附动作回执。每次询问自动附带当前卡片清单，Agent 因此能按真实卡片操作；409 冲突不自动重试。UI 侧 1.5 秒轮询自动刷新；`apps/web/tests/canvas-actions.test.ts` 覆盖解析、校验、冲突与回执。

### 卡片 Agent 直接执行：platform operations 全动作集（2026-11-22）

动作通道升级为平台 operation 批量（不再手动覆盖画布状态）：`create_card / update_card`、`card_op`（直接调 `card.drama.audio.<op>`——attach 双轨导入视频+音频、script 台词、upsert 分段、gap/gain/mute/trim 剪辑、align 对齐、rebind 换源、span 区间、analyze 画面理解、compose 配音稿、rewrite 台词改写、export/export-srt，以及本轮新增的确定性 op `voice`（整卡/逐句音色覆盖）和 `speed`（变速 0.5–2 / fitSpeed））、`import_media`（自动建卡并绑定工程内真实媒体文件，路径先经存在性校验）。执行统一走 `POST /api/apps/canvas/instances/:projectId/operations`（幂等凭条 + baseRevision + 卡片类型门禁），回执逐条展示。E2E 冒烟（CLI 绑定 outputs/voice/test-tone.wav → seg-0 变速 0.9 → 音色「温柔清晰女声」）全部落画布真实状态。诚实边界：真实 TTS 音频合成未接入（本地 VoxCPM 未部署，显式 TTS_UNAVAILABLE）；analyze/compose/rewrite 需配置 WQ_API_KEY。改卡包 op 后需重建 `packages/canvas-pack-drama-audio/dist/server.mjs` 并重启 canvas server（本地 dev：`CANVAS_STORAGE_MODE=local-test node apps/server/dist/cli.js run --port 17456 --data-dir /tmp/canvas-data-dev`，需 Node ≥22.13）。

### import_media v3：本机文件导入（2026-11-22）

导入通道按用户实测补全：`import_media` 支持纯音频（attach）、**纯视频**（`card.drama.audio.video`）与双轨（attach）三种绑定，并新增 `src` 本机绝对路径导入——服务端校验扩展名白名单与 512MB 上限后，把文件复制上传进工程（音频 `outputs/voice`、视频 `inputs`），时长自动探测（mp4/mov 的 moov/mvhd、wav 的 fmt+data；无 ffprobe 环境的自研解析，mkv/webm 需显式提供时长）。真实 E2E：`packages/canvas-pack-drama-audio/demo/materials/念念有回响_*.mp4`（11MB）导入为 `inputs/念念有回响_*.mp4`，自动探测 173477ms 并建卡绑定。
