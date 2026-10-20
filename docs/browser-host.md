# 独立原生浏览器宿主

## 范围

`@canvas/desktop` 承载原工作区浏览器与采集侧栏，不另造浏览器界面，也不自行启动 Web/API 服务。范围包含导航、历史、书签、参考站点、资源采集、项目截图、页面归档、资产保存、下载、扩展采集和受条件限制的登录交接，不包含原聊天、账号／团队、sidecar 或更新平台。

来源与边界见 [工程约束](<../AGENTS.md>) 和 [NOTICE](<../NOTICE>)。独立原生桥复用原资源引擎、图片校验、采集扩展、检查器及登录连接器，使用独立应用身份与存储。

## 启动与所有权

先运行 `pnpm --filter @canvas/desktop build`，再使用 `pnpm tools-dev run desktop --data-dir "$CANVAS_DATA_DIR" --production`。数据根规则只以 [工程约束](<../AGENTS.md#safety-and-data>) 为准。启动器从桌面包解析 Electron，传入已编译入口的绝对路径并管理子进程。不要用普通 Node 执行 Electron 入口，也不要设置 `ELECTRON_RUN_AS_NODE`。

| 环境变量 | 约定 |
| --- | --- |
| `CANVAS_WEB_URL` | Web 生命周期报告的精确回环应用来源，不含凭据／查询／片段；应用内 SPA 查询和哈希导航仍可使用。 |
| `CANVAS_SERVER_URL` | 明确的后端来源，远程页面不可访问。 |
| `CANVAS_BROWSER_HOST_PORT` | 预留的原生资源传输端口。 |
| `CANVAS_DESKTOP_AUTH_TOKEN` | 每实例随机 base64url 密钥，仅与服务器共享，不进入渲染器配置、日志、元数据或 URL。 |
| `CANVAS_DESKTOP_USER_DATA` | 当前实例明确指定的独立 Electron profile 绝对路径，不使用原应用或日常浏览器 profile。 |

无密钥就绪记录格式为 `{ "app": "canvas-desktop", "ready": true, "nativePort": 12345 }`。应用关闭会撤销授权、取消读取及待处理原生操作、关闭监听器并退出。并发实例必须使用不同的数据根、profile 和传输端口。

## 中文界面与持久化

- 应用自有界面默认简体中文，不因浏览器或系统的英文环境自动切换。仍保留明确选择的英文语言偏好。
- 原浏览器可作为工作区标签打开；**画布 → 底部资产侧栏 → 采集** 打开原紧凑采集器和项目文件托盘。展开会创建浏览器标签，不离开当前项目。
- 沙箱预加载桥仅向可信应用主文档暴露原 version-2 宿主协议。应用通过 `@bezier/host` 的 `getBezierHost()` 使用它。
- 项目截图和采集图片保留来源元数据；托盘可以加入画布，或打开唯一的原资产保存对话框。
- 页面资源批次与浏览器资产采集将真实字节写入选定的资产空间／文件夹。打开或取消保存对话框不写入；幂等采集 ID 保护重试。
- 书签、参考站点和采集开关通过 `/api/browser-preferences` 持久化；只有一次性的 revision-zero 迁移读取旧 localStorage，服务器写入失败不会显示成功。
- 浏览器“加入引用”仅暂存图片；用户后续明确提交任务后，才进入 Agent 请求。
- 页面归档包含 HTML、CSS 和清单，并不等于复制整个网站及运行环境。页面提取把受限上下文、归档输入和已安装的页面重建说明交给可选 Agent 适配器；未配置时明确返回不可用。

纯 Web 模式保留原回退／首页界面，但不能提供 Electron DOM／资源采集，采集和扩展设置会说明桌面要求。外部网页、用户自有标题与内容不自动翻译；系统文件选择器和 Chrome／Edge 自己管理的权限／扩展页面仍由对应系统语言控制。

## 资源传输与 CLI

原生资源监听器仅绑定 `127.0.0.1:${CANVAS_BROWSER_HOST_PORT}`。服务器发送：

```http
POST /command
Authorization: Bearer <CANVAS_DESKTOP_AUTH_TOKEN>
Content-Type: application/json

{"sessionId":"…","accessToken":"…","projectId":"…","action":"start"}
```

固定命令为 `start`、`snapshot`、`scan`、`stop` 或 `read`；读取还需要不透明的资源／导航 ID。请求上限 64 KiB；返回 `{ok:true,result}` 或结构化 `{ok:false,error:{code,message}}`。拒绝浏览器来源请求，不提供通用 URL 读取、文件系统、代码求值或任意原生调用入口。

UI 与 `canvas-server browser resources …` 使用相同的、经项目授权的服务端 API。资源授权不能代替项目权限。资源引擎只负责读取字节，项目或资产库服务负责已确认的持久化。

## 下载与登录同意

- 原生下载必须属于受管理的 WebContents，通过 URL／重定向检查，并始终要求系统“另存为”确认。取消、导航或所有者丢失会取消待处理操作；支持同源且属于当前页面的 blob 下载。
- Electron DownloadItem API **没有可信的发起 frame 身份**，实现不宣称具备 frame 级下载归属；边界仍是 WebContents 所有权、受保护来源限制与系统“另存为”。
- Google 登录按钮／弹窗交接经过确认的来源站点普通登录页，不把 OAuth state／授权 URL 当作任意外部打开通道。
- Pinterest 保留原 **macOS + 未打包开发模式** 限制。注册连接器或修改 profile 前必须明确引导并获同意；独立原生宿主为 `com.canvas_workspace.pinterest_auth`，继续执行 cookie 范围、回滚和导航取消检查。真实账号认证需要用户自己的浏览器及同意；自动化只使用临时合成输入。

## 独立采集扩展

**浏览器菜单 → 浏览器扩展** 打开原设置区。安装先请求原生确认，再让用户选择构建 ZIP 的保存位置。用户手动解压并在兼容浏览器加载，应用不会静默修改日常 profile。

- 扩展身份：`filiogdhdejjikcnhfgdclfcnflecgpd`。
- 正常发现使用回环端口 **18373–18382**，与原应用及上述资源传输隔离。
- 同意只为当前受管理的桌面会话启用接收，不永久生效。重启后再次使用“安装扩展”启用；在确认“启用”之后取消 ZIP 导出只是不保存包，不撤销已同意的会话接收。
- 接收授权有范围、短时效且只能使用一次；继续严格检查 Host／Origin／请求头、项目上下文撤销及保存后检查器范围。worker 保留内部会话密钥，只向内容脚本暴露绑定标签页的不透明句柄。
- 同来源资产刷新会在请求期间保留先前已确认的能力；切换来源或刷新失败则关闭能力。异步保存和后续读取持有同一个适配器，不跨来源。
- 可选 Native Messaging 回退已改名为 `com.canvas_workspace.browser_bridge`，但安装器**不注册**对应中继。正常采集使用 HTTP 发现，不依赖或宣称该回退已验收。
- 打包需要系统 `zip`（macOS/Linux 基线），Windows 原生打包未验证。

另见 [扩展指南](<../apps/desktop/browser-extension/README.md>) 与 [Pinterest 连接器指南](<../apps/desktop/experiments/pinterest-auth/README.md>)。

## 安全不变量

- 继续启用沙箱、上下文隔离和 Web 安全；远程页面没有 Node 集成、特权预加载或嵌套 webview。
- 预加载与每个特权 IPC 只接受精确归属的应用主 frame；远程页面、子 frame 和同源 API／预览路径不能调用。
- 导航、重定向和弹窗只允许无凭据 HTTP(S) 或 `about:blank`，排除特权应用／API／原生来源及其回环别名；请求策略也约束程序调用的 `loadURL`，采集观察器不能替代它。
- 远程页面权限默认拒绝，不授予剪贴板读取或任意自定义协议。资源 CLI 不能绕过安装、下载或登录的原生同意。
- 授权随机、有范围和有效期，绑定项目／页面／导航，默认关闭。读取使用已观察的不透明 ID，前后验证图片文档，并检查栅格 MIME／签名；活动 SVG 和分段媒体仅保留元数据。
- 资源限制为 500 项、每次读取 25 MiB、每操作 30 秒、每授权 30 分钟。导航、重载、崩溃、关闭、授权替换和所有者丢失使代次失效并取消读取；快照不导出 cookie、秘密查询或原始原生错误。

## 验证边界

单元覆盖包含原资源／代次／图片校验、所有权／预加载／传输、扩展接收和检查器协议、原生下载生命周期及受条件限制的登录取消。真实 UI 使用受管理的生产 Web/API/Electron 生命周期，不另开替代服务。

次数、截图和未完成／人工项见 [运行记录](<runtime-verification.md>) 与 [功能对照](<feature-parity.md>)。用户已暂缓外部扩展修复后的完整原生复验，中文化不会改变这一状态。编译、模拟数据或临时 profile 结果不等于真实账号登录、普通 profile 安装或完整系统弹窗验收。原生 PDF 打印、项目目录选择器和更新器方法仍是明确不支持的兼容占位，不是浏览器下载实现。
