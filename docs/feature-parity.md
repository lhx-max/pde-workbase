# 原画布功能对照与验收证据

抽取基线：Bezier/Loom `319e5eee556a3641d2ee68a6111a36ddc7a1eff7`。复用原组件、样式、状态模型与交互，不用新的设计替换原工作区。

“保留实现”“自动化验证”“真实界面验证”是不同证据层级；下表不把源代码存在或编译通过写成全场景验收。

| 范围 | 保留的能力 | 已有证据与边界 |
|---|---|---|
| 画布文档 | 原 JSON、节点、图片、分组、连线、草稿、视口、修订及撤销重做 | [画布接口测试](<../apps/server/tests/canvas-routes.test.ts>)、[画布包测试](<../packages/canvas-workbench/tests/>)；原画布真实渲染，生产样式已通过 computed-style 检查 |
| 节点 | 图片、文本、草图、分镜、视频、剪辑、网页、演示文稿及原连接逻辑 | 原实现和相关包测试保留；真实 UI 覆盖文本、草图、剪辑、HTML/PPT，不声称逐一完成全部节点与供应商组合测试 |
| 顶部工作区 | 原标签、添加菜单、打开／切换／关闭、恢复、快捷键及 QuickSwitcher | [真实 Web 场景](<../e2e/ui/workspace.test.ts>)验证入口、创建、编辑、保存与重开 |
| 项目资产 | 原侧栏、筛选／搜索、列表／网格、上传、重命名／删除、预览与拖入画布 | 原组件与文件接口保留；真实 UI 验证仅显示项目可见文件，内部版本与 sidecar 不出现在素材列表 |
| 文本 | 原 Markdown／文档编辑器、保存、引用、文件名及画布同步 | 真实编辑与重开；[候选测试](<../apps/server/tests/canvas-text-candidate.test.ts>)、[隔离工作副本](<../apps/server/tests/canvas-generation-workspace.test.ts>) |
| 草图 | 原 Excalidraw 编辑器、模板、`.sketch.json`、自动保存、导出与重命名 | 真实选择原线框模板并验证落盘；回归覆盖旧读取、排空保存、重命名、失败保存及撤销保留 |
| 剪辑 | 原时间线、媒体轨道、预览、设置、导出任务和取消 | 真实打开／重开完整编辑器；[FFmpeg 测试](<../apps/server/tests/media/clip-export.test.ts>)包含真实图层、裁剪、旋转、动画及音频淡入淡出验证 |
| HTML/PPT | 原 URL/srcDoc 双预览、源码、手动编辑、版本、PPT 缩略图与翻页 | 真实点击网页按钮、修改标题、保存、版本列表、重载、PPT 下一页与源码均通过；未声称测试全部发布／外部编辑器组合 |
| 文件与产物 | 原输入／源文件／产物布局、目录、版本、清单、候选、重命名和旁路文件 | [文件与版本](<../apps/server/tests/files-versions.test.ts>)、[产物工作副本](<../apps/server/tests/canvas-artifact-workspace.test.ts>)、真实 HTTP 版本恢复 |
| 独立 Agent | 请求、回执、隔离输入、输出、取消、恢复、交付与采用 | [任务／历史测试](<../apps/server/tests/standalone-history-tasks.test.ts>)；[真实 HTTP 适配器测试](<../apps/server/tests/http-adapters.test.ts>)验证授权输入字节与临时执行上下文，不需要聊天消息数据库 |
| 工作流 | 原图编辑、版本、运行／步骤、澄清、结果交互及自动交付 | [工作流路由测试](<../apps/server/tests/workflow-routes.test.ts>)验证托管确认后复用已有执行器，不向 UI 下发重复 Agent 任务；未托管流程保留外部宿主交接 |
| 媒体 | 原媒体请求身份、调度、重试／取消和画布交付 | [媒体适配器](<../apps/server/tests/media/adapter-service.test.ts>)、[画布媒体交付](<../apps/server/tests/media/canvas-delivery.test.ts>)；模型目录来自注入适配器，无固定供应商白名单 |
| 外部资源 | 中性来源描述、查询及真实字节导入 | [授权与资源测试](<../apps/server/tests/server-security.test.ts>)；未配置时明确不可用，不内置个人／团队资产平台或宣称不支持的来源能力 |
| 原生浏览器 | 原面板、WebView、导航、资源观测、授权读取、截图和归档 | 112 项桌面单元测试及真实 Electron 场景通过：导航／前进后退、资源发现与原始字节保存、截图、页面归档、跨项目／撤销授权、危险导航阻断 |
| 安全 | 路径／符号链接、作用域、版本、迟到结果、原生导航代次与权限、预览隔离 | 服务端安全测试、原生策略测试及 [代理测试](<../apps/web/tests/runtime-proxy.test.ts>)；不通过关闭 Electron 沙箱或放宽 iframe 权限使测试通过 |
| 实例隔离 | 独立进程、数据根、端口和浏览器 profile | [HTTP 集成](<../e2e/tests/workspace.test.ts>)已验证两个同时运行的生产 Web/Server 实例，不串项目或代理目标 |
| 独立仓库 | 本仓库内依赖闭包、无原仓库链接、无原数据库依赖 | 最终独立目录已完成冻结锁文件安装、全部构建、guard／类型检查与 1,388 项回归；HTTP 4/4、Web／Electron UI 共 3/3 再次通过，独立 Git 仓库已初始化 |

## 当前验证记录

- 共享 contracts：586 项；画布：180 项；服务端：270 项；桌面：112 项；Web：189 项。
- 另有 components、host、release、workbench-core、workbench-ui 的包级检查。最终统一检查结果以 [运行记录](<runtime-verification.md>) 为准。
- 真实 Web 两个场景通过，涵盖画布／标签／资产／文本／草图／剪辑及 HTML/PPT。
- 原生场景不以 Web 场景代替；其当前状态见上表及运行记录。
- 视觉验收保留原 CSS 和组件结构，并检查真实截图与交互；未进行完整逐像素 golden-image 比较。

## 有意保留的基线限制与适配器边界

1. 普通 Web iframe 不具备 Electron WebView 的跨域 DOM／资源采集权限；完整采集需要原生宿主。
2. 原浏览器当前基线未显示 inspect/edit 入口，HTML palette/tweaks 活跃 UI 也已停用。本提取不自行增加按钮。
3. 文本绑定省略 `outputKind` 时保留原自动回填；显式 `outputKind: 'text'` 保存候选并由宿主调用 adopt API。没有虚构新的 Apply 面板。
4. Agent、媒体供应商、外部资源、知识、工作流设计助手、发布／外部编辑器和参考资料选择需要适配器。保存的浏览器批注可通过工作区的 `previewAnnotations` 宿主端口接入；没有内置聊天批注数据库。
5. 旧业务 `workflowBinding` / `runArchive` 的独立业务归档需要专用宿主任务适配器；默认客户端明确拒绝，不把它悄悄当成普通任务。通用图工作流使用自己的持久执行器。
6. 原模块级 host/Agent 桥不保证同一 JS 页面内多个活动画布完全隔离；使用独立页面／窗口。服务端一进程一个实例，不保证多个进程写同一个数据根。
7. 剪辑导出进程重启后将未完成任务标记为 interrupted，不假装恢复了编码进度。多文件保存发生部分成功时返回实际已保存路径，不删除用户文件作虚假回滚。
8. 未恢复已移除的历史多槽 image-task 平台、原聊天历史迁移、原个人／团队资产平台或更新器。

## 测试基线说明

- 两个原 contracts 测试的旧期望曾在未改动的原基线上独立复现失败：任意 Agent 名应归为 `other`，旧 brief 品牌文案与当前实现不符。只修正了本仓库测试期望，未为迎合旧期望修改原业务代码。
- 十个依赖缺失历史 `gr-plan` / `example-plan` 归档样例的工作流测试未伪造夹具补齐；当前工作流实现另有真实持久化、执行与 HTTP 回归覆盖。

任何限制都不能被转换成“成功”的空操作。协议与启动方式见 [README](<../README.md>)、[架构边界](<architecture.md>) 和 [服务端适配器说明](<../apps/server/README.md>)。
