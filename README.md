# Canvas Workspace

从 Bezier/Loom 原仓库独立抽取的画布创作工作区。保留原画布、组件、样式和交互，不包含对话产品，也不内置个人／团队全局资产平台。

原始版本：`319e5eee556a3641d2ee68a6111a36ddc7a1eff7`。来源与授权见 [NOTICE](NOTICE) 和 [LICENSE](LICENSE)。

## 包含什么

- 原画布及图片、文本、草图、分镜、视频、剪辑、网页、演示文稿节点。
- 原顶部标签及浏览器、草图、文本、剪辑入口。
- 项目资产侧栏：文件、上传、预览、搜索、筛选、重命名、删除及拖入画布。
- 原 Markdown／文档编辑器、Excalidraw 草图编辑器、HTML/PPT 查看器与手动编辑、媒体预览和剪辑导出。
- 独立后端：画布 JSON、修订冲突、文件／目录、版本、产物清单、候选交付、任务回执和工作流执行。
- 原生 Electron 浏览器宿主：WebView 导航、资源观测与授权读取、页面／图片捕获；采集结果进入项目文件。
- 可替换的 Agent、媒体、目录、外部资产来源与宿主接口。没有配置的外部能力会明确报错，不会模拟成功。

**验证状态与限制以 [功能对照表](docs/feature-parity.md) 为准。** 复制代码、类型检查通过与真实交互验收是不同层次。

## 安装与构建

要求 Node **24.x**、pnpm **10.33.2**。视频导出需要 `ffmpeg` 与 `ffprobe` 可执行文件。Electron 为桌面浏览器模式所需；纯 Web 模式不具备跨域页面的原生 DOM／资源采集能力。

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

通用 `request METHOD /api/path --body-file FILE|- --json` 可以调用同一套画布、文件、版本、任务和工作流接口。浏览器资源命令使用原生宿主签发的会话授权；不能凭项目 ID 自行铸造读取权限。

主要协议实现：

- [画布状态与修订](apps/server/src/routes/canvas.ts)
- [项目文件、目录、预览、标签和事件](apps/server/src/routes/files.ts)
- [Agent 任务和候选交付](apps/server/src/routes/tasks.ts)
- [剪辑编辑与导出](apps/server/src/routes/clip-editor.ts)
- [浏览器资源授权协议](apps/server/src/routes/browser-resources.ts)
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
- 原个人／团队全局资产管理平台、团队协作权限后台。
- 原产品更新器、发布控制台、Pinterest／外部浏览器扩展登录平台。

项目资产、画布产物和项目版本是本工作区的核心能力，不属于上述被排除的平台功能。
