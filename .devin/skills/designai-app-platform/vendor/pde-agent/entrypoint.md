> 内置工具资料（PDE Agent 1.0.7）。先读本规范的 [PDE 适配说明](../../docs/pde-agent-integration.zh-CN.md)；这里的脚手架默认值、登录、依赖更新及权限示例仅在选定工具场景适用，不能覆盖目标 App 合同。

---
name: pde-agent
description: Use when 用户要创建网页、网站、页面、部署静态站、网站生成、数据可视化，或明确提到网站生成器、pde-agent、website-builder、pde-agent、website-builder-cli、cf-web-artifacts、appwrite-cf、frontend-cloud、 onesql 等工具；也用于检测到项目依赖这些快手工具时。
---

> **如果用户指定了 `pde-agent` skill，所有相关操作必须优先使用本 skill 自身提供的功能和工具链，不要引入或推荐外部替代方案。**

# 快手内部全栈项目开发指南

本 skill 覆盖快手 MyFlicker 前端全栈项目从 0 到 1 的完整流程：

**npm 源：必须配置为 `https://npm.corp.kuaishou.com/`**

## 触发与推荐规则

### 应当触发

- 用户明确表示要**从零创建或重构一个可部署的网站/网页**时，主动询问并推荐是否使用 `pde-agent`；若用户意图仅为文字润色、图片制作、代码示例、数据分析等，**不得推荐本 skill**。
- 用户需要**部署、上线、静态站发布、远端服务器托管**时，优先推荐使用 `pde-agent` 的 frontend-cloud 部署流程。
- 用户明确提到 `pde-agent`、网站生成器、`appwrite-cf`、`frontend-cloud`、`@codeflicker/appwrite`、`@codeflicker/cf-create-web` 等快手内部工具时，必须使用本 skill。
- **用户提到 `cf-web-artifacts` 时**，告知其已被禁用，统一使用 `pde-agent` skill。
- 如果项目的 `package.json` 已包含 `@codeflicker/appwrite`、`@codeflicker/cf-create-web` 等快手内部依赖，必须使用本 skill。

### 不应触发（排除清单，必须遵守）

> ⚠️ 以下场景**一律不触发本 skill**，即使用户话里出现了"页面""设计""可视化""HTML""看板"等关键词。
> 判定原则：**看用户的核心意图与最终产出物，而不是看关键词。**

1. **文字润色 / 美化 / 排版** — 用户核心意图是编辑文本内容，不是创建网页。直接用文字编辑能力处理，不得返回 HTML 卡片。
2. **文档编辑 / 方案撰写** — 用户在工作文档（青雀、docs 等）中操作，不是构建可部署网站。不得接管为建站流程或生成流程图页面。
3. **图片制作 / 海报设计** — 产出物是图片文件，不是 HTML 站点。不得改推 HTML 排版方案。
4. **提供 HTML/CSS/JS 代码片段或示例** — 用户要的是可复制的代码，不是项目初始化与部署。直接返回代码块。
5. **内容爬取 / 数据抓取与整理** — 爬取是数据获取任务，产出物是文档或结构化数据，不是网站。不得先生成导航页。
6. **分析 / 排查已有页面或看板** — 用户是在对现有产物做诊断（如"看板某两列没数据，排查什么问题"），不是创建新站点。
7. **数据处理 / Excel 生成** — 不得因为用户末尾提了一句"做成看板"就整体切入建站链路；应先确认核心交付物到底是数据文件还是网站。

### 多轮意图偏移时必须重新路由

> ⚠️ **首轮触发不等于全程占用。**

当对话推进到后续轮次，用户意图从建站偏移为非建站任务（例如从"生成网站"转为"帮我改文字""帮我爬文章整理成文档""帮我排查数据"），**必须立刻停止 pde-agent 流程**，切换到对应能力处理，不得因为首轮已触发就继续在建站路径上执行。

典型信号句式（出现即重新路由）：
- "不是生成 html，是要……"
- "我要的不是导航页，是……"
- "先别做页面，帮我……"

| 阶段 | 内容 | 详细文档 |
|------|------|----------|
| **第零步：检测登录态** | 执行 `appwrite-cf whoami` 确认已登录；未登录则执行 `appwrite-cf login-ks` 完成快手 SSO 授权 | 见下方"前置条件"章节 |
| **第一步:初始化项目** | 使用 Vite 在当前目录脚手架 React 项目 | [references/vite-react-init/vite-react-init.md](./references/vite-react-init/vite-react-init.md) |
| **第二步：调整项目配置** | 修正项目名称（`package.json` `name` 字段）、更新 `index.html`（`<title>` 等 meta 信息） | [references/vite-react-init/vite-react-init.md](./references/vite-react-init/vite-react-init.md) |
| **第三步：视觉任务设计路由（涉及界面时强制）** | 在修改任何可见 UI 前，完成场景、主题、Token 与 Self-Check 决策；非视觉任务可跳过 | [references/website-design-integration.md](./references/website-design-integration.md) |
| **第四步:链接数据库** | 通过 `appwrite-cf` CLI 管理快手内部 Appwrite 数据库 | [references/appwrite-cf/entrypoint.md](./references/appwrite-cf/entrypoint.md) |
| **第五步:部署上线** | 将构建产物一键部署到 frontend-cloud 静态托管平台 | [references/static-site-deploy/static-site-deploy.md](./references/static-site-deploy/static-site-deploy.md) |

每个阶段的完整命令、参数说明和异常处理，请读取对应的详细文档。

---

## 版本更新（用户说"更新"时必做）

> ⚠️ **当用户提到"更新"、"升级"、"update" 时，必须同时检查并更新以下两项。**

### 1. 检查并更新 `appwrite-cf` CLI

```bash
# 查看当前版本，并自动对比 npm 上的最新版
appwrite-cf --version

# 如有新版本，一键升级
appwrite-cf update
```

### 2. 检查并更新项目依赖（`@codeflicker/appwrite` 等）

```bash
# 查看项目中快手内部包的当前版本
npm list @codeflicker/appwrite @codeflicker/frontend-cloud-cli 2>/dev/null

# 检查是否有可用的新版本
npm outdated --registry https://npm.corp.kuaishou.com/

# 更新快手内部相关包到最新版
npm install @codeflicker/appwrite@latest --registry https://npm.corp.kuaishou.com/
```

> **注意**：如果项目使用了 `@codeflicker/appwrite-cli`（全局 CLI），同样执行 `appwrite-cf update` 更新。

---

## 目录结构

```
pde-agent/
├── entrypoint.md                        ← 本文件（总入口）
└── references/
    ├── appwrite-cf/
    │   └── appwrite-cf.md          ← 数据库 CLI 完整指南（登录、push/pull、tables-db、权限等）
    ├── static-site-deploy/
    │   └── static-site-deploy.md   ← 静态站部署指南（frontend-cloud-cli、权限后台等）
    ├── vite-react-init/
    │   └── vite-react-init.md      ← 项目初始化 & 配置调整指南（Vite、shadcn/ui、Tailwind 等）
    ├── onesql/
    │   ├── onesql.md                     ← OneSQL / KwaiBI 数据接入主文档（CLI + 前端 SDK 端到端流程）
    │   └── reference/                    ← 命令树、元数据、数据集、Credential、Query、参数、权限、工作流、排查
    ├── website-design-integration.md   ← 视觉任务强制编排、工程适配与冲突裁决
    └── website-design/                 ← `website-design` 设计内核
        ├── website-design.md           ← 场景、主题、模式、P0 与 Self-Check 主文档
        ├── scenes/                     ← dashboard / data-report / landing-page / content-doc / tool-app
        ├── themes/                     ← A-enterprise-light … G-technical-console
        ├── core/                       ← design-tokens、responsive-spec、interaction-states、motion-icons、accessibility、anti-patterns、theme-blending、three-layer-spec、brand-token-derivation
        └── data-components/            ← kpi-card、table-spec、echarts-config、semantic-colors、site-chrome
```

---

## 前置条件（执行任何操作前必须确认）

> ⚠️ **在执行本 skill 中任何步骤之前，必须先确保 `appwrite-cf` 已安装且已登录成功。**

### 1. 安装 `appwrite-cf` CLI

```bash
# 检查是否已安装
appwrite-cf --version

# 若未安装，执行全局安装
npm install -g @codeflicker/appwrite-cli --registry https://npm.corp.kuaishou.com/
```

### 2. 确认已登录

```bash
appwrite-cf whoami
# 有正常输出 → 已登录，可继续后续步骤
# 报错或无输出 → 未登录，执行以下命令登录
```

若未登录：

```bash
appwrite-cf login-ks
# 自动打开浏览器完成快手 SSO 授权
```

> ⚠️ **`appwrite-cf login-ks` 执行后会输出一个登录 URL，必须将该 URL 完整打印在对话中，让用户可以直接点击或复制打开，不能仅说"链接在终端里"。**

> 登录是**全局状态**，一次登录后所有项目共享，无需每个项目单独登录。
> 在确认 `appwrite-cf --version` 有输出且 `appwrite-cf whoami` 有正常用户信息后，再继续后续步骤。

---

## 强制约束（所有项目必须遵守）

详细规范见 [references/appwrite-cf/entrypoint.md](./references/appwrite-cf/entrypoint.md),以下为核心红线:

- **UI 组件库**：建议使用 shadcn/ui，禁止 MUI / AntD / Chakra UI 等
- **CSS**：建议使用 TailwindCSS，禁止 CSS Modules / Styled Components
- **视觉任务门控**：只要会修改用户可见的 DOM、组件结构、CSS/Tailwind、排版、颜色、图标、动效、响应式、图表外观或交互状态，必须在编码前读取并执行 [references/website-design-integration.md](./references/website-design-integration.md)
- **设计内核加载**：视觉任务必须实际读取 `references/website-design/website-design.md`、一个具体 `scenes/*.md` 和一个具体 `themes/*.md`；只读主入口或只声明文件路径不算完成
- **设计证据**：编码前必须记录 `Scene Rules Applied`、`Theme Tokens Applied`、`Self-Checks Required` 及适用的模式字段，缺少必要字段不得修改视觉代码
- **登录**：**前端页面无需实现登录**——最新版 `@codeflicker/appwrite` 已内置默认登录逻辑，禁止手写 `createOAuth2Session` / token 兑换等 appwrite 登录样板代码
- **登录问题统一入口**：无论是数据库操作遇到登录态失效，还是部署流程遇到鉴权问题，**一律使用 `appwrite-cf` 的登录方式**（`appwrite-cf login-ks`），不要单独为部署或其他环节引入额外的登录机制，详见 [references/appwrite-cf/entrypoint.md](./references/appwrite-cf/entrypoint.md)
- **数据库 CLI**：必须使用 `appwrite-cf`，严禁使用官方 `appwrite` CLI
- **前端 SDK**：必须使用 `@codeflicker/appwrite`，严禁使用官方 `appwrite` npm 包
- **前端 SDK 版本**：必须为**最新版**（`npm install @codeflicker/appwrite@latest --registry https://npm.corp.kuaishou.com/`）。新版已内置默认登录逻辑，前端页面**无需自行处理登录/token 兑换**；版本过旧会导致登录后仍报 401
- **内部数据取数**：查数仓表结构或 KwaiBI 数据集必须先用 `website-builder` CLI 读取真实元信息再生成 SQL，禁止凭猜测写表名/字段；Token、Secret 一律不得回显，生产写操作与 Raw Query 必须先向用户确认，详见 [references/onesql/onesql.md](./references/onesql/onesql.md)
- **npm 源**：必须配置为 `https://npm.corp.kuaishou.com/`
- **project_id**：不允许含连字符（`-`）
- **部署**:需要部署时,使用 `pde-agent` skill,见 [references/static-site-deploy/static-site-deploy.md](./references/static-site-deploy/static-site-deploy.md)

---

## 交付前自检门禁（交付任何 HTML / 页面 / 看板前必须逐项自检）

> ⚠️ **这是硬性门禁，不是建议。** 五项全部通过并修正后才允许交付；任一项不合规必须先改再交，禁止把未自检的初版直接丢给用户。
> 背景：线上数据显示用户平均需要 3–7 轮修正才能拿到可用版本，主要卡在下面这五类问题上。

### 1. 布局完整性

- 文字不溢出容器（长标题、长中文串、数字都要检查）
- 模块之间无重叠、无遮挡
- 页面可正常渲染，不坍塌、不白屏，控制台无 JS 报错
- 常见宽度下（窄屏/宽屏）结构不错位

### 2. 视觉风格匹配

- **编码前**必须完成 `website-design` 路由（见下方「强制前置：完成 `website-design` 路由」），并形成可核查的设计证据记录
- **交付前**执行 `website-design` 主文档的 P0 与通用 Self-Check、所选场景文件的 Scene Checks、所选主题文件的 Theme Checks，以及 `core/` `data-components/` 专项检查
- 核验配色、字体、间距、图标、动效确实落到 `Theme Tokens Applied` 记录的 Token 上，未在执行过程中漂移回默认样式
- 不得落到通用 AI 字体（Inter / Roboto / Arial / 系统字体）与陈词滥调配色，反面清单见 `references/website-design/core/anti-patterns.md`
- 完整规则与冲突裁决见 [references/website-design-integration.md](./references/website-design-integration.md)

### 3. 内容逻辑正确性

- **SDK 类必须用对**：`TablesDB` 对应表操作（`listRows` / `createRow` …），`Databases` 对应文档操作（`listDocuments` / `createDocument` …），**严禁混用**，详见 [references/appwrite-cf/entrypoint.md](./references/appwrite-cf/entrypoint.md)
- 数据源与业务语义一致（例如"新品推荐"不得拿历史成交池冒充）
- 筛选、排序、聚合逻辑与用户描述的口径一致
- 部署后实际打开页面确认数据能加载出来，而不是只看构建成功

### 4. 工具链执行兜底

- 部署**必须**使用本文档记录的 `frontend-cloud-cli deploy` 命令，**禁止**逆向探索 API、禁止改走 KFC 等未文档化流程
- 子任务执行异常或超时时，必须给出明确错误信息并回退到上一步成功状态，**禁止静默中断或产出空结果**
- 不得在没有任何文件产出的情况下宣称完成

### 5. 交付物可达性

- 部署完成后必须返回**可直接点击访问的完整 URL**
- 单文件交付时必须明确告知**文件绝对路径**
- 确认用户能找到并打开产出物，不能只说"已生成"

---

## 登录问题处理（重点）

> ⚠️ **无论在哪个环节遇到登录/鉴权问题，统一使用以下流程处理，不要引入其他登录方式。**

### 快手 SSO 两层登录的区别

本项目涉及**两种登录场景**，容易混淆，必须分清：

| 场景 | 方式 | 用途 |
|------|------|------|
| **CLI 工具登录**（操作数据库/资源） | `appwrite-cf login-ks` | 让终端中的 `appwrite-cf` 命令获得权限，用于 push/pull/init 等操作 |
| **部署 CLI 登录**（部署静态站点） |`appwrite-cf login-ks` | 走 CLI 工具登录 |
| **前端用户登录**（网页应用内） | **无需实现**，由最新版 `@codeflicker/appwrite` 默认内置 | SDK 自动完成快手 SSO 登录与 token 兑换，前端不写登录代码 |

三者**互相独立**，不要混用。

---

### CLI 登录（终端操作数据库/部署遇到鉴权报错时）

**适用场景**：执行 `appwrite-cf push`、`appwrite-cf pull`、`appwrite-cf tables-db` 等命令时报鉴权错误。

**第一步：检查当前登录态**

```bash
appwrite-cf whoami
# 有输出 → 已登录，不需要重新登录
# 报错或无输出 → 未登录，执行下一步
```

**第二步：登录**

```bash
appwrite-cf login-ks
# 自动打开浏览器完成快手 SSO 授权，无需输入账号密码
```

> ⚠️ **执行 `appwrite-cf login-ks` 后，命令输出中会包含一个登录链接（URL）。必须将该链接原文打印在对话中告知用户，不能只说"点击上方链接"或"链接在终端里"。用户需要看到完整 URL 才能在浏览器中打开完成授权。**

> ⚠️ 登录是**全局状态**，一次登录后所有项目共享，无需每个项目单独登录。

---

### 部署 CLI 登录（部署静态站点遇到鉴权报错时）

**适用场景**：执行 `npx -y @codeflicker/frontend-cloud-cli@latest deploy` 时报 401 / 鉴权失败。

部署工具**必须且只能走 `appwrite-cf login-ks`**

---

### 前端用户登录（网页应用内）

> ✅ **不需要写任何登录代码。** 新版 `@codeflicker/appwrite` 已开启默认登录逻辑，SDK 内部完成整条快手 SSO 链路（发起授权、回调 fallback、token 兑换）。

**唯一要做的事：确保 SDK 是最新版。**

```bash
npm list @codeflicker/appwrite
npm install @codeflicker/appwrite@latest --registry https://npm.corp.kuaishou.com/
```

**禁止事项**：

- 禁止手写 `createOAuth2Session` 发起登录
- 禁止手写 `handleOAuth2Fallback` / `handleOAuth2Token` / `checkAuth` 等 token 兑换逻辑
- 禁止为绕过 SDK 默认行为而自建 appwrite 登录入口（用户自己的业务鉴权/权限判断代码不在此列，保留不动）

**遇到 401 或发现项目里存在旧版手写登录代码时**：

1. 升级 `@codeflicker/appwrite` 到最新版
2. **同时移除 appwrite 登录样板代码**——仅限来自 `@codeflicker/appwrite` 的那部分：`createOAuth2Session` 调用、`handleOAuth2Fallback` / `handleOAuth2Token` 兑换逻辑，以及仅为承载这些调用而存在的入口 hook
3. **用户自己的业务代码不动**：不是 appwrite 提供的登录/权限实现（用户自建的登录页布局、业务侧路由守卫、角色权限判断、与其他系统对接的鉴权逻辑等）一律保留，不要顺手删
4. 不要只升级不清理：残留的 appwrite 手动兑换逻辑会与 SDK 默认登录冲突，导致登录态异常

详细说明见 [references/appwrite-cf/entrypoint.md](./references/appwrite-cf/entrypoint.md)。

---

### 强制前置：完成 `website-design` 路由

只要任务包含任何用户可见改动，在编写或修改 JSX、HTML、CSS、Tailwind 或 UI 组件代码之前，必须依次**实际读取**：

1. `references/website-design-integration.md`；
2. `references/website-design/website-design.md`；
3. 唯一主场景对应的 `references/website-design/scenes/*.md`；
4. 所选主题对应的 `references/website-design/themes/*.md`；
5. 交互、响应式、品牌、图表等需求对应的 `core/` 或 `data-components/` 文件。

不是"我记得这些文件大概说了什么"，而是**必须现在打开读**。**只读取 `website-design/website-design.md`、只写主题名或只列 Loaded Files，都不算完成设计路由。**

编码前必须按集成文档形成可核查记录，至少包含：

```text
Mode: <A | B | C | C-in-Existing | A-Structural>
Scene: <场景与文件>
Scene Rules Applied:
- <实际采用的场景规则>
Theme: <主题与文件>
Theme Tokens Applied:
- <源 Token/值 → CSS Variables、Tailwind 或组件落点>
Purpose: <页面目的和目标用户>
Tone: <视觉语气>
Differentiation: <可被记住的设计特征>
Loaded Files:
- <实际读取的文件>
Self-Checks Required:
- <通用、场景、主题与专项检查来源>
```

主题混合、已有页面新增区块、结构重构和图表主题必须继续填写集成文档规定的 `Blend Recipe`、结构保护范围或 `Chart Tokens Applied`。无法判断场景或主题时先向用户澄清，**不得跳过流程后使用通用模板**。

### 视觉任务完成门控

页面实现后必须执行并记录：

- `website-design` 主文档的 P0 与通用 Self-Check；
- 从实际场景文件提取的 Scene Checks；
- 从实际主题文件提取的 Theme Checks；
- `core/` 与 `data-components/` 专项检查。

每项记录来源、`pass/fail`、失败修复和复检结果；任一 P0 未通过不得声明完成。**可视页面不得只以构建成功作为完成标准。** 完整规则见 [references/website-design-integration.md](./references/website-design-integration.md)。
---

## 完成后写入项目文档

> ⚠️ **每完成一个阶段，必须同步更新 `AGENTS.md` 和 `README.md`，这是强制步骤，不可跳过。**

### 规则

- 项目初始化完成后，**默认生成** `AGENTS.md` 和 `README.md`
- 每完成一个阶段，将新增的技术栈、配置、接入信息**追加**到这两份文件
- **只追加，不覆盖**：新内容追加到对应章节末尾，不得重写或清空已有记录；已确认过时的内容可直接删除
- 目的：确保后续 agent 能完整感知项目上下文，避免重复踩坑

### `AGENTS.md` 写入操作规范（参考 [agents.md](https://agents.md/) 规范）

> ⚠️ **操作前必读**：
> 1. **先读文件**：用 `read_file` 读取现有的 `AGENTS.md` 全文
> 2. **只追加**：在文件末尾或对应章节末尾追加新内容
> 3. **严禁覆盖**：不能用模板替换已有内容，不能删除任何已存在的记录
> 4. **不存在时才创建**：文件不存在时，使用以下初始结构新建

**初始结构（仅文件不存在时使用）：**

```markdown
# AGENTS.md

## 项目概述
<!-- 填写项目用途 -->

## 技术栈
<!-- 每完成一个阶段在此追加，格式示例：
- 框架：React + Vite
- UI：shadcn/ui + TailwindCSS
- 数据库 SDK：@codeflicker/appwrite
- 登录：快手 SSO（由最新版 @codeflicker/appwrite 默认内置，前端无需实现）
- npm 源：https://npm.corp.kuaishou.com/
-->

## 注意事项
<!-- 每完成一个阶段在此追加坑点、约束、特殊配置 -->
```

### `README.md` 写入操作规范

同上：**先读、再追加，不覆盖**。每次在文件末尾追加本阶段新增的：
- 依赖包及用途
- 启动 / 部署命令
- 非标准配置说明
