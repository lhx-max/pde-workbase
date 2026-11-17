# 原画布、资产与采集功能对照

抽取基线：Bezier/Loom `319e5eee556a3641d2ee68a6111a36ddc7a1eff7`。复用原组件、CSS、状态模型与交互，不用新设计替换原工作区。当前范围包括原“画布／资产／采集”侧栏、展开资产库和用户选择的**内建本地资产库**；初次提取时排除全部个人资产库的描述已不适用。原聊天、账号／团队平台与原 Agent 运行时仍不在范围内；新接入的 MF 开放 UI 是隔离的外部能力，并非恢复原聊天产品。

“保留实现”“组件／接口回归”“真实界面验证”是不同证据层级。源代码存在、依赖闭包或编译通过均不等于完整用户流程验收。**最新运行批次、通过数、失败与截图以 [运行验证记录](<runtime-verification.md>) 为准**；本表说明能力及证据边界，不复制会随重跑变化的总数。

## 文档 App 互联专项（2026-10-21）

[画布与文档的关系及闭环状态](<canvas-doc-relationship-and-status.zh-CN.md>)区分工作台、画布 App API 与独立文档 App。用户确认双入口同时编辑、资产使用为独立复制后，已实现正文 hash 版本/有界三方合并、冲突双方保留、双端持久投递与恢复、显式冲突解决、独立身份/文件复制、条件解绑与显式恢复。真实双进程8组 HTTP 包含两个服务分别断网重启后的恢复；真实内嵌/独立页面另外检验双向更新、脏草稿保留及用户确认链。浏览器实际揭示的页签丢失、旧广播回滚与迟到复制路径问题不能用单位测试代替复验，最终通过/失败以 [运行记录](<runtime-verification.md>)为准。当前是单写服务实例，多进程写同根、跨存储原子提交、生产团队/Appwrite、历史绑定清理未宣称完成。

## 功能与证据

| 范围 | 保留的能力 | 证据与当前边界 |
|---|---|---|
| 默认中文 | 画布／资产／采集、编辑器、浏览器、应用自有原生弹窗和扩展浮层；不随英语系统自动切换，显式英文仍兼容 | [真实默认语言测试](<../e2e/ui/default-locale.test.ts>)和 [中文截图](<../e2e/evidence/zh-CN/22-original-local-asset-cards-and-space.png>)；用户内容、文件名、格式标识和系统／浏览器管理页面不强制翻译 |
| 画布文档 | 原 JSON、节点、图片、分组、连线、草稿、视口状态、修订及撤销重做 | [画布接口测试](<../apps/server/tests/canvas-routes.test.ts>)、[画布包测试](<../packages/canvas-workbench/tests/>)；真实画布渲染与生产样式已有验证，不声称逐像素覆盖所有状态 |
| 节点 | 图片、文本、草图、分镜、视频、剪辑、网页、演示文稿及原连接逻辑 | 原实现与包级回归保留；[工作区真实 UI 测试](<../e2e/ui/workspace.test.ts>)覆盖文本／草图／剪辑／HTML/PPT，不等于全部节点与供应商组合测试 |
| 顶部工作区 | 原标签、添加菜单、打开／切换／关闭、恢复、快捷键及 QuickSwitcher | [工作区真实 UI 测试](<../e2e/ui/workspace.test.ts>)已有创建、编辑、保存与重开成功运行 |
| 三入口侧栏 | 原画布、资产、采集页签；项目文件与本地库是不同来源；采集状态跨页签保留 | [CanvasAssetsSidebar](<../apps/web/src/components/CanvasAssetsSidebar.tsx>)、[侧栏组件回归](<../apps/web/tests/asset-library-sidebar.test.tsx>)；原生采集入口另见 [采集真实 UI 测试](<../e2e/ui/native-collector.test.ts>) |
| 项目文件 | 原筛选／搜索、列表／网格、上传、重命名／删除、预览与拖入画布 | 原文件接口与侧栏保留；真实 UI 已验证项目可见文件，内部版本与旁路元数据不混入素材列表 |
| 原资产目录与展开库 | 同一原资产面板的紧凑／完整视图；类型导航、排序／隐藏设置、搜索、筛选、面包屑、预览、评分、标签、收藏及批量管理 | [AssetLibraryPanel](<../apps/web/src/components/AssetLibraryPanel.tsx>)、[PersonalAssetLibrary](<../apps/web/src/components/PersonalAssetLibrary.tsx>)和 [组件测试](<../apps/web/tests/asset-library-ui.test.tsx>)；原设计系统等导航保留，缺少目录数据时显示真实空态，不伪造已安装内容 |
| 本地资产持久化 | 原 PersonalAsset DTO、字节内容、目录、元数据、版本替换、使用记录、上传／文件夹上传、复制／移动／删除和导出 | [资产库契约](<../packages/contracts/src/api/asset-library.ts>)、[路由回归](<../apps/server/tests/asset-library-routes.test.ts>)、[存储回归](<../apps/server/tests/asset-library-storage.test.ts>)；基础操作不要求外部供应商或原账号服务 |
| 空间管理 | 原下拉菜单与创建／重命名／删除对话框；默认移动资产及完整文件夹树，显式确认后可永久删除；默认空间受保护 | [空间组件测试](<../apps/web/tests/asset-library-spaces-ui.test.tsx>)及 [来源选择恢复测试](<../apps/web/tests/asset-library-space-selection.test.tsx>)通过；服务器确认前不冒充成功，切换来源不应用旧结果；空间删除不删除项目。完整真实 UI 最新重跑状态仍见运行记录 |
| 保存与已保存详情 | 原元数据／YAML、评分、标签、空间、可选 AI 填写；统一保存后详情生命周期、取消、失败保留和修订冲突 | [保存组件](<../apps/web/src/components/SaveAssetDialog.tsx>)、[已保存详情](<../apps/web/src/components/SavedAssetDialog.tsx>)、[组件测试](<../apps/web/tests/asset-library-ui.test.tsx>)；稳定 captureId 保护重试，打开／取消不写库，迟到读取不能启动上传；没有 AI 适配器时明确禁用 AI，不妨碍手动元数据保存 |
| 资产与项目／画布衔接 | 项目文件保存到资产、真实字节导入项目、画布接受、原参考选择与暂存托盘 | [资产库 provider](<../apps/web/src/providers/asset-library.ts>)、[工作区衔接测试](<../apps/web/tests/asset-library-workspace.test.tsx>)、[真实 HTTP／CLI 测试](<../e2e/tests/asset-library-cli.test.ts>)；参考选择本身不提交 Agent 任务 |
| 文本 | 原 Markdown／文档编辑器、保存、引用、文件名及画布同步 | 真实编辑与重开；[候选测试](<../apps/server/tests/canvas-text-candidate.test.ts>)、[隔离工作副本测试](<../apps/server/tests/canvas-generation-workspace.test.ts>) |
| 草图 | 原 Excalidraw 编辑器、模板、`.sketch.json`、自动保存、导出与重命名 | 真实选择原线框模板并验证落盘；[工作区真实 UI 测试](<../e2e/ui/workspace.test.ts>)及相关生命周期回归；不通过空白覆盖未读文件 |
| 剪辑 | 原时间线、媒体轨道、预览、设置、导出任务和取消 | 真实打开／重开编辑器；[FFmpeg 测试](<../apps/server/tests/media/clip-export.test.ts>)验证图层、裁剪、旋转、动画及音频淡入淡出 |
| HTML/PPT | 原 URL/srcDoc 预览、源码、手动编辑、版本、PPT 缩略图与翻页 | [真实 UI 测试](<../e2e/ui/workspace.test.ts>)已有交互、保存／重载、版本、翻页与源码成功运行；没有测试全部发布／外部编辑器组合 |
| Office/PDF 预览 | 原结构化文本预览与打开／下载；DOCX 段落、PPTX 幻灯片文本、XLSX 工作表文本；PDF 文本提取或明确不可用提示 | [实际 Office UI 测试](<../e2e/ui/office-previews.test.ts>)中的 DOCX/PPTX/XLSX 场景各重复两次通过，包含真实 HTTP 精确字节。原侧栏选择后从 Quick Switcher 打开；不是 Office 排版还原、编辑或公式计算。PDF 依赖可用的文本提取工具，本轮未单列真实 PDF 场景 |
| 文件与产物 | 原输入／源文件／产物布局、目录、版本、清单、候选、重命名和旁路文件 | [文件与版本测试](<../apps/server/tests/files-versions.test.ts>)、[产物工作副本测试](<../apps/server/tests/canvas-artifact-workspace.test.ts>)、真实 HTTP 版本恢复 |
| MF 开放 UI | 真实 Chat／附件、项目会话、授权上下文、受控工具、云文件预览／导入、画布任务绑定 | MF React19 独立文档与画布隔离；画布包保留 React18 约束，实际 Next 浏览器渲染器单独实测，不将依赖声明等同运行版本；[MF 接入与验收](<mf-integration.md>)说明真实本地 SDK 测试及限制。需要新对话进行画布定向生成；聊天结束不等于交付，取消不保证远端停止。真实云端账号、Origin／模型权限尚待授权配置 |
| 独立 Agent | 请求、持久回执、隔离输入、输出、取消、恢复、交付与采用 | [任务／历史测试](<../apps/server/tests/standalone-history-tasks.test.ts>)、[HTTP 适配器测试](<../apps/server/tests/http-adapters.test.ts>)；不依赖聊天消息数据库，不内置原 Agent 运行时平台 |
| 工作流与媒体 | 原图编辑、版本、运行／步骤、澄清、结果交互、媒体调度／重试／取消与画布交付 | [工作流路由测试](<../apps/server/tests/workflow-routes.test.ts>)、[媒体适配器测试](<../apps/server/tests/media/adapter-service.test.ts>)、[画布媒体交付测试](<../apps/server/tests/media/canvas-delivery.test.ts>)；执行及供应商目录由适配器提供 |
| 浏览器与偏好 | 原浏览器面板／首页、书签、参考网站、采集开关、导航与设置菜单；偏好服务端持久化 | [原生浏览器真实 UI 测试](<../e2e/ui/native-browser.test.ts>)已有成功运行；偏好 Web 场景已有真实持久化验证。普通 Web 不因此获得原生跨域资源权限 |
| 原采集器 | 原紧凑浏览器、资源面板、项目采集托盘、保存到项目／资产、展开浏览器和暂存参考 | [原生采集真实 UI 测试](<../e2e/ui/native-collector.test.ts>)已有成功运行，包含真实扩展设置菜单与鼠标打开对话框；不把仅弹出设置写成扩展安装完成 |
| 原生资源与归档 | WebView 资源观测、授权读取、真实字节保存、截图、HTML/CSS/清单归档、下载及条件式登录交接 | [原生浏览器宿主说明](<browser-host.md>)和 [真实 UI 测试](<../e2e/ui/native-browser.test.ts>)；归档不是完整网站克隆，批注／动态应用状态不因文件已保存而视为全部恢复 |
| 外部浏览器扩展 | 原扩展设置／安装引导、宿主接收、采集及已保存检查器协议 | 新鲜测试 profile 中实际选择采集写入、字节和项目关联已通过；保存后编辑链路暴露的 worker 字段丢失、能力刷新撤销会话已修复并有先红后绿回归。用户暂缓修复后的完整原生复验，因此不宣布全链路通过，也不声称普通 profile 已安装 |
| 外部来源 | 中性资源查询／字节导入端口及可替换资产库来源 | [资产 provider 测试](<../apps/web/tests/asset-library-provider.test.ts>)、[授权与资源测试](<../apps/server/tests/server-security.test.ts>)；基础本地库可独立使用，外部来源未配置则明确不可用 |
| 安全与实例隔离 | 路径／符号链接、来源、修订、迟到结果、原生导航代次／权限、预览沙箱、独立进程／数据根／端口／profile | [代理测试](<../apps/web/tests/runtime-proxy.test.ts>)、[HTTP 集成测试](<../e2e/tests/workspace.test.ts>)及原生策略测试；不靠关闭沙箱或扩大 iframe 权限通过验收 |
| 独立仓库 | 本仓库内依赖闭包、无上游运行目录链接、无原数据库依赖 | 以当前 guard、类型检查、构建与回归记录为准；源代码恢复不是所有交互均完成真实验收的证明 |

## 当前验收状态如何解读

- 最近已有成功真实运行覆盖原工作区及 HTML/PPT、Web 偏好持久化、原生浏览器和原采集器。真实 HTTP／CLI 集成也已有成功结果；具体次数、批次和最新状态只在 [运行验证记录](<runtime-verification.md>)维护。
- 资产／空间真实 UI 的复选框测试名称已经纠正；创建、收藏、导入、展开库、删除空间默认转移和重载的完整测试场景最终重复两次通过。这仍不等于所有资产类型和交互组合均已穷举。
- 外部扩展新鲜 profile 的真实采集写入已经实际通过；修复后的“保存 → 编辑 → YAML → 库内展示”完整原生复验由用户选择暂缓。详见 [运行记录](<runtime-verification.md>)，不得把协议回归或部分通过写成整条链路通过。
- [组件级资产回归](<../apps/web/tests/asset-library-ui.test.tsx>)、[空间 CRUD 回归](<../apps/web/tests/asset-library-spaces-ui.test.tsx>)与 [空间恢复回归](<../apps/web/tests/asset-library-space-selection.test.tsx>)验证了生命周期、失败、取消与来源切换；这些测试不替代真实浏览器布局、持久化和原生权限验收。
- 视觉保留原 CSS 和结构，真实截图／交互另行验收；未进行完整逐像素 golden-image 比较。

## 有意保留的上游限制与适配器边界

1. 普通 Web iframe 不具备 Electron WebView 的跨域 DOM／资源采集权限；完整原生采集需要宿主与对应授权。不能用伪造 bridge 或放宽 iframe 沙箱冒充实现。
2. 原浏览器基线没有可达的 inspect/edit/comment 工具栏调用入口；浏览器 viewport 尺寸控制也没有可达 UI。内部处理器或状态存在不等于用户可用功能。原 HTML palette/tweaks 活跃 UI 也已停用，不因提取而自行新增按钮。
3. 文本绑定省略 `outputKind` 时保留原自动回填；显式 `outputKind: 'text'` 保存候选并由宿主调用 adopt API。没有虚构新的 Apply 面板。
4. Agent、媒体供应商、外部资源／目录、知识、工作流设计助手和发布／外部编辑器仍需要适配器。内建本地资产文件／元数据／版本／空间 CRUD 不受此限制；AI 分析及 Prompt 提取不能因本地保存成功而假装完成。
5. 批注相关原结构与 `previewAnnotations` 宿主端口保留，但没有原聊天批注数据库，也未声称全部批注采集／保存／重开链路闭环。页面归档只承诺实际保存的 HTML、CSS、清单等内容，不是完整网页应用或其运行时状态克隆。
6. 扩展安装与权限同意属于用户手动操作。Pinterest 登录交接仅在受支持的 macOS 未打包条件下可用，不是跨平台真实账号自动登录保证；系统对话框、普通浏览器 profile 安装及真实账号结果需要单独人工验收，参见 [原生浏览器宿主边界](<browser-host.md>)。
7. 旧业务 `workflowBinding` / `runArchive` 需要专用宿主任务适配器；默认客户端明确拒绝，不悄悄当成普通任务。通用图工作流使用自己的持久执行器。
8. 原模块级 host/Agent 桥不保证同一 JS 页面多个活动画布完全隔离；使用独立页面／窗口。服务端一进程一个实例，不保证多个进程写同一数据根。
9. 剪辑导出进程重启后将未完成任务标记为 interrupted，不假装恢复编码进度。多文件部分保存返回实际已保存路径，不删除用户文件作虚假回滚。资产空间永久删除也不是可撤销回收站操作。
10. 未恢复原聊天／账号／团队平台、原 Agent 运行时、已移除的历史多槽 image-task 平台、聊天历史迁移或更新器。当前独立本地资产库不应再被混写为“个人资产一律未恢复”。

## 音频工作台专业交互：本地隔离验收

本批变更限 `/session-apps`，沿用画布内配音卡的数据与保存接口。新增真实波形、面板拖动和尺寸记忆、三种布局预设、轨道属性、片段分割/复制/粘贴/删除、源区间裁剪、吸附、右键菜单和快捷键。界面与实现由本仓库编写；仅参考 Fairlight、Descript 的工作流，不引入其代码或视觉资产。

- `pnpm guard`、Web 类型检查和生产构建通过。
- Web 全量测试 73 文件、531 项通过；最后一次元数据调整后，剪辑与波形专项 2 文件、6 项复测通过。
- Chrome 独立验收工程：分割后 2 句变 3 句；拖边同时改变画面与音频入点；粘贴到空白位置保持其他句的位置；删除、按钮撤销及键盘撤销正常，页面显示已保存。
- 面板拖动后刷新保留尺寸；选中轨道显示 dB 属性并禁用片段删除；深浅模式与真实视频、配音、音乐波形已检查。

限制：文字分句位置需要人工核对，未实现词级自动对齐、交叉淡化、多轨任意重叠、自动降噪或后台导出。本轮未重新执行 AI 生成或完整成片导出。

规范影响：新增前端编辑元数据 `directorTrimBounds`，用于恢复裁剪范围，复用现有画布版本与保存路径；身份、租户、资源权限及部署合同未变。证据仅来自用户授权的本地隔离环境，不代表 Appwrite、正式宿主、Agent 调用或 staging 验收通过。

## 音频工作台使用帮助：本地隔离验收（2026-11-17）

工作台顶部新增「使用帮助」，按 8 个任务主题提供目录、全文关键词检索、步骤与结果说明、常见问题和 Word 下载。平台文案与下载手册以 `manual-content.json` 内容为依据，Markdown 阅读版见 [使用手册](audio-workbench-user-guide.zh-CN.md)。

- Web 类型检查、独立目录生产构建和 `pnpm guard` 通过。
- Chrome 已验证目录阅读、裁剪关键词排序、无结果与清空搜索、Esc 关闭后的焦点恢复，以及关闭帮助不改变所选台词与播放位置。
- 深浅主题居中显示和步骤编号已检查；点击下载成功，下载字节与仓库 Word 文件一致。Word 渲染共 8 页，已逐页检查。

此变更只新增前端只读帮助与静态下载文件；不新增服务端、存储、权限或部署合同。证据来自本地隔离 demo，本轮不重复声明 AI 生成或成片导出验收。

## 历史测试基线说明

- 两个原 contracts 测试的旧期望曾在未改动基线上独立复现失败：任意 Agent 名归为 `other`，旧 brief 品牌文案与当前实现不符。修正了本仓库测试期望，未为迎合旧期望改变原业务代码。
- 十个依赖缺失历史 `gr-plan` / `example-plan` 归档样例的工作流测试未伪造夹具补齐；当前工作流实现另有持久化、执行与 HTTP 回归覆盖。这不构成完整历史归档平台恢复的证据。

任何限制都不能转换成“成功”的空操作。协议与启动方式见 [README](<../README.md>)、[架构边界](<architecture.md>)、[服务端适配器说明](<../apps/server/README.md>)及 [运行验证](<runtime-verification.md>)。
