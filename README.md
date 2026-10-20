# 画布工作区

从 Bezier/Loom 原仓库独立抽取的画布创作工作区。保留原画布、组件、样式和交互，包含原 **画布／资产／采集** 三个入口及独立本地资产库；不包含对话产品或原账号／团队平台。

原始版本：`319e5eee556a3641d2ee68a6111a36ddc7a1eff7`。来源与授权见 [NOTICE](NOTICE) 和 [LICENSE](LICENSE)。

## 包含什么

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

桌面模式自动为后端到原生宿主的连接生成仅本次进程使用的传输密钥，并使用独立浏览器 profile。API 的可选 `CANVAS_AUTH_TOKEN` 与该原生宿主密钥相互独立。`Ctrl+C` 停止本次启动的进程。可通过 `--daemon-port`、`--web-port`、`--browser-host-port` 和 `--desktop-user-data` 配置独立实例；并发实例必须使用不同的数据根、profile 和端口。原生能力说明见 [browser-host.md](docs/browser-host.md)。

## 三个入口与本地资产库

在画布底部工具栏打开资产侧栏，然后切换 **画布／资产／采集**。资产页右上角可展开原资产库；空间菜单提供创建、重命名和删除。删除空间默认把内容移至默认空间，只有明确取消“移动资产”并确认删除时才永久删除内容，不删除项目。

资产库由当前服务的数据根独立持久化。空间、文件夹与项目是不同概念；把资产加入画布会导入指定版本的真实字节，并记录项目使用关系，不把全局资产 ID 伪装成项目文件路径。保存对话框在用户确认前不写入，失败可保留草稿重试。

浏览器菜单内的 **Browser extension／浏览器扩展** 打开原扩展设置。书签、参考站点与采集开关通过后端持久化，不再仅存于浏览器 localStorage。原生浏览器和采集需要桌面模式；Web 会明确说明能力不可用，不以普通 iframe 冒充完整浏览器。

AI 元数据分析和外部模板目录是可选适配器，默认不可用；手动编辑元数据不受影响。浏览器“加入引用”只暂存引用，**不会立即启动 Agent**；用户下一次明确提交任务后才发送。

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

CLI 是独立服务端入口，不会启动原应用：

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
- [Agent 任务和候选交付](apps/server/src/routes/tasks.ts)
- [剪辑编辑与导出](apps/server/src/routes/clip-editor.ts)
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
