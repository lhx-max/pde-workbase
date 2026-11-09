# 独立工作区全量 UI 还原排查

## 范围与方法

参照冻结原代码 `319e5eee556a3641d2ee68a6111a36ddc7a1eff7`，排查独立工作区所有保留入口：画布、节点与生成输入、文件视图、资产、采集和弹层。只修独立项目，不修改原项目业务代码，不恢复聊天、账号、团队或原执行平台。

前两轮按局部截图修复，漏掉了原首页的副作用 CSS 和全局宿主挂载。本轮改用以下证据链：

1. 从页面与布局入口递归追踪 TS/TSX import、export、字面量动态 import 与 CSS `@import`，解析工作区包出口；不把“文件已复制”当成“实际加载”。
2. 比较保留组件的消费者、CSS Module、动态状态类、portal 祖先、根选择器和同等覆盖，排除被移除功能与已有替代规则。
3. 对照宿主 renderer 注入，检查是否落入原组件的 legacy fallback。
4. 在真实生产构建中操作入口，以截图、computed style、布局边界及交互结果验证。测试数据经生产 HTTP 或真实上传进入独立隔离项目；没有注入假生成结果或假模型目录。

静态图初始覆盖原版 **1313 个仓内模块／243 个 CSS**、独立版 **694 个模块／107 个 CSS**，仓内未解析导入为 0。图保守包含 barrel 导出和动态分支，**不等于实际加载顺序或视觉通过数**。差异中大量属于被排除的平台功能，不能将缺少的 CSS 文件数当成缺陷数。画布包原有 208 个源码文件全部存在、29 个 CSS 初始逐字节相同；这仍没防止应用宿主退化。

## 确认的问题与修复

| 范围 | 证据与原因 | 修复 |
|---|---|---|
| 根级 CSS 顺序 | 第一轮 UI 大部分断言通过，但逐张截图发现完整库仅 520px、标题与关闭按钮竖排；追查确认同步 App 把全局默认放在了组件 Module 之后 | 按冻结 RootLayout 顺序恢复 vendor／package → global → client 组件，避免给每个弹窗打重复宽度补丁；独立库 header 明确横排 |
| 弹窗共性回归 | 实测新建资产应 640 却为 520、删除空间应 560 却为 520、添加站点应 440 却为 520；各自 padding 也被覆盖 | 同一根级顺序修复，分别添加真实浏览器断言；完整库增加 1440／840／560 三档宽度与 padding 检查 |
| 危险操作确认框 | 原 `.modal-confirm` 整段遗漏，实测 420 退成 520，危险按钮样式缺失 | 恢复冻结确认变体及按钮状态，覆盖真实资产删除入口但取消操作、不删除测试外数据 |
| 资产库非图片列表 | 关闭图片 masonry 后，普通网格依赖未加载的首页类；浏览器实测 `display:block` | 从原混合文件提取普通网格及保留卡片契约，由资产组件直接加载 |
| 资产 HTML／幻灯片／图片封面 | 预览全族与 ready、loaded、hover 类仍来自被移除 Home；浏览器 HTML iframe 实测 `position:static` | 恢复定位、缩放、加载揭示、纸卡、图片变体及动作样式；保留原 reduced-motion 分支 |
| 资产媒体封面 | 叶组件还消费首页媒体定位、视频叠层与骨架类 | 将原媒体规则及关键帧归属到实际媒体组件 |
| 全局悬停提示 | CSS 与 `data-tooltip` 消费者还在，但原 TooltipLayer 没有组件或根挂载；浏览器没有 tooltip DOM | 恢复原层及其纯 DOM 输入模式辅助，根内单例挂载；保留 portal、碰撞处理和 title 抑制 |
| 统一资源选择器 | 原 host 未注入，实际落入旧版 picker，图片入口甚至缺资产来源 | 恢复原对话壳、来源标签、网格、上传区、预览、模板网格与类别映射，数据改接独立库 |
| HTML 演示 | body portal 的覆盖层样式留在被剔除混合文件；浏览器实测 `position:static` | 恢复固定全窗、iframe 填充、层级和 Escape 提示动画 |
| 共享加载器／忙碌图标 | 真实消费者保留，但整条 spinner 与 centered-loader 规则没进入样式图 | 按原相对顺序恢复共享规则和关键帧 |
| 部署／导出表单 | 保留字段、错误、结果和链接状态仍使用被剔除混合文件的规则 | 窄提取真实消费的字段、结果、禁用链接与窄窗布局，不整包恢复原平台 |
| 文件工具栏交接按钮 | 只有顶栏高度恢复，基础叶规则仍要求 `.app`；实测 wrapper 为 static/block | 为保留的叶选择器补独立根条件；文字按钮使用自动宽度，避免继承图标专用 32px；未配置交付能力的自有提示补齐中文，仍保留配置宿主返回的真实错误 |
| 生成菜单文案 | 生图模板／数量、网页模板／设计系统仍有英文默认文字 | 使用现有画布语言入口，补齐中英文文案 |

入口级联修复在 [根布局](<../apps/web/app/layout.tsx>)；[共用弹窗](<../apps/web/src/styles/workspace/shared-modal.css>) 仍是原声明与顺序，不改变通用 Dialog 默认值。独立展开容器的横排 header／section padding 是中立容器修复，不伪称冻结原版文件。保存资产详情走 unstyled Radix、默认新建空间／扩展设置本应 520px，不误修这几类。

实现入口：[资产共享规则](<../apps/web/src/components/asset-library/AssetCardShared.css>)、[媒体规则](<../apps/web/src/components/asset-library/AssetMediaSurface.css>)、[全局提示层](<../apps/web/src/components/TooltipLayer.tsx>)、[统一资源选择器](<../apps/web/src/components/asset-library/WorkspaceAssetPicker.tsx>)、[宿主装配](<../apps/web/src/components/workspace/CanvasWorkspace.tsx>)、[演示](<../apps/web/src/styles/viewer/presentation.css>)、[部署表单](<../apps/web/src/styles/viewer/deployment.css>)、[加载器](<../apps/web/src/styles/loading-primitives.css>)。

### 用户截图的比例／分辨率弹层

它与上一轮模式菜单使用同一个已修复宿主，并不存在第二条同形 Radix 弹层路径。本轮在修改前生产构建中已真实验证：**1440px 和 840px 窗口下，外宽 380px、外 padding 0、内 scope 透明，五个比例按钮均在可视边界内且可选**。没有再给这个弹层打重复补丁。

新增 [生成菜单回归](<../e2e/ui/canvas-generation-style.test.ts>) 保留上述检查，并增加模板和数量文案、选项切换。初稿把 Escape 后的节点失选误当成触发按钮丢失，已按真实原交互改为先验证值、再验证关闭；该导航错误不算产品缺陷。

### 资源选择器的数据与能力边界

- 使用前固定 adapter、来源身份、资产 revision 和当前版本；读取后再验证，关闭、切源、换项目和来源 tab 切换取消读取，不跨 await 使用动态代理。
- 保留真实 `onUseCanvas`、`onUseLibrary`、`onUpload`、模板 `onSelect`，不偷换成直接往画布落节点的导入动作；保留 MIME 与 2MiB 文本／200MiB 媒体限制。
- 原回调自身没有 AbortSignal 参数：可以中止读取和忽略迟到界面完成，不能撤销已经进入调用方的上传副作用。
- [设计系统选择器](<../apps/web/src/components/asset-library/DesignSystemAssetPicker.tsx>) 保留中立资源 HTTP 能力及清除选择。无 adapter 时呈现真实错误；配置真实 adapter 后可读取目录、详情和 showcase，选择前再读具体项目。
- 没有搬入依赖原账号、品牌编辑及上传分析平台的完整 DesignKitView。右侧显示真实 sandbox showcase 或设计文档，不伪造样例。因此这一预览是**中立能力适配边界，不宣称完整品牌编辑平台像素等价**。

## 全量覆盖矩阵

“静态对照”表示已检查入口、组件、样式和宿主；下表“真实界面”是最终构建实际执行的覆盖，不拿单测替代，也不扩张为每个业务状态都已验证。

| 保留界面 | 静态对照 | 真实界面已执行覆盖 |
|---|---|---|
| 画布外壳、工具栏、增加／模式／素材菜单 | 完成 | 原回归＋本轮截图和模式／菜单检查 |
| 生图节点、参数和数量、参考来源 | 完成 | 宽窄窗口、边界检查、真实本地素材选择 |
| 上传图片裁剪、调色、标注 | 完成 | 真实 PNG 上传后打开原编辑面和字体／画笔菜单 |
| 视频 | 完成 | 无模型目录时的真实不可用状态；不冒称验证了隐藏的生成控件 |
| 分镜 | 完成 | 自由编辑、字段、运镜、窄窗／缩放、真实图片帧与伴随节点 |
| 文本／网页／PPT 节点 | 完成 | 新增、选择、输入与长度／模板／设计系统入口 |
| 草图 | 完成 | 既有真实原生与 Web 编辑、模板保存回归 |
| 剪辑与音频相关面 | 完成 | 真实 PNG 与 4 秒 WAV 上传、两种轨道、声音属性；监视器音频已解码且 currentTime 推进；PNG／MP4 参数弹层，不宣称完成编码 |
| HTML／Markdown／文件预览 | 完成 | 既有源码、编辑、版本回归＋本轮提示层及双模式演示 |
| Office／PDF | 完成 | 原版就是提取预览，既有支持回归；不把它宣称为原生 Office 排版 |
| 资产侧栏、完整库、详情、空间、筛选、网格和缩略图 | 完成 | 增删改／导入；完整库 1440／840／560；非图片网格与 HTML 封面；统一 picker 真素材选择、详情预览、关闭保持选择、应用引用 |
| 采集、浏览器、书签和设置 | 完成 | 既有 Web 能力边界及原生浏览／采集回归；外部扩展仍人工暂缓 |
| 全局提示、通用弹窗、加载、部署表单 | 完成 | 提示、确认、新资产、删空间、加站点均真实打开及尺寸检查；加载／部署规则为静态和单测闭包，未冒称完整异步／部署状态已实测 |

## 不混为拆分缺陷的事项

- 原版参数 portal 没有继承节点局部的 `--mm-canvas-controls-text*` token，这是上游已有行为，本轮未凭空改色。
- 已有图片“继续生成”和视频生成使用原生 select，并非用户截图那条合并参数弹层。视频在目录为空时根本不渲染生成面；不能伪造模型列表来报通过。
- PromptCard 只有遗留注册、plan 已退役，当前没有独立音频生成节点；不把这些计为可达新建界面。
- 真实执行中的工作流阶段、问题与结果历史需要真实执行适配器或合法既有记录。未配置时保持明确 unavailable，不生成假成功状态。
- 外部扩展授权／完整原生复验仍遵照用户决定暂缓，没有重新发起授权。

## 验证结果与证据

- `pnpm guard`、全仓 `pnpm typecheck` 通过。
- Web 单测 **51 文件／380 项通过**；画布包 **14 文件／182 项通过**；Web 生产构建通过。
- 最终生产构建完整 Web／Electron UI 套件连续两轮：**54 通过、2 跳过**，即 27 个自动场景各执行两次；两次跳过均为用户暂缓的同一人工扩展确认场景，不算通过。
- 同一生产构建补强：素材详情预览及关闭后应用 **2 次通过**；文本／网页／PPT 入口及稳定态篇幅菜单 **6 次通过**；确认框等待原菜单退出后 **2 次通过**。没有在运行中的预览上重建产物。
- [证据索引](<../e2e/evidence/full-ui-audit/README.md>) 归档 **97 张原始 PNG**（7 张红测、90 张最终构建实测及补证）和 **28 份节点／viewport／zoom 清单**；[机器清单](<../e2e/evidence/full-ui-audit/manifest.json>) 含逐文件 SHA-256、生产 build ID 与真实测试输出。不是用合成图冒充浏览器截图，也不是逐像素 golden 判定。

### 关键对照

| 界面 | 修复前真实红测 | 修复后真实界面 |
|---|---|---|
| 完整资产库／1440px | [被压成 520px、标题竖排](<../e2e/evidence/full-ui-audit/before/asset-expanded-1440.png>) | [1376px、横排标题](<../e2e/evidence/full-ui-audit/after/viewer-visual-audit--P0-fu-42d48-d-and-HTML-preview-geometry-web/asset-expanded-1440.png>) |
| 资产删除确认 | [默认 520px](<../e2e/evidence/full-ui-audit/before/asset-delete-confirmation.png>) | [420px 与原危险按钮](<../e2e/evidence/full-ui-audit/after/viewer-visual-audit--P0-fu-42d48-d-and-HTML-preview-geometry-web/asset-delete-confirmation.png>) |
| 新建资产 | [默认 520px](<../e2e/evidence/full-ui-audit/before/asset-create-form.png>) | [原表单 640px](<../e2e/evidence/full-ui-audit/after/viewer-visual-audit--P0-fu-42d48-d-and-HTML-preview-geometry-web/asset-create-form.png>) |
| 添加站点 | [默认 520px／22px](<../e2e/evidence/full-ui-audit/before/browser-site-dialog.png>) | [440px／24px](<../e2e/evidence/full-ui-audit/after/asset-library--P0-browser--84cbc-ngs-remain-reachable-on-Web-web/browser-site-dialog.png>) |
| 网页资产封面 | [缺失预览样式](<../e2e/evidence/full-ui-audit/before/asset-html-thumbnails.png>) | [恢复缩略预览](<../e2e/evidence/full-ui-audit/after/viewer-visual-audit--P0-fu-42d48-d-and-HTML-preview-geometry-web/asset-html-thumbnails.png>) |

窄窗补证：[840px 比例／分辨率](<../e2e/evidence/full-ui-audit/after/canvas-generation-style--P-e6388-ery-option-without-clipping-web/image-params-840.png>)、[560px 完整库](<../e2e/evidence/full-ui-audit/after/viewer-visual-audit--P0-fu-42d48-d-and-HTML-preview-geometry-web/asset-expanded-560.png>)、[840px／50% 运镜](<../e2e/evidence/full-ui-audit/after/canvas-node-visual-audit---7a35f-d-and-preview-are-reachable-web/storyboard-camera-840-50pct.png>)。

### 人眼复核与采样纠正

节点组 28 张原图逐张复核，并对照冻结源码；另复核比例、完整库、选择器、工具栏与演示等代表图。没有用绿色用例数量替代截图检查。

- 剪辑在 00:00 选中淡入淡出时黑屏，是原动画在起点透明度为零；后续实际播放时间推进后恢复，未当缺陷乱改。
- 第一轮 PPT 篇幅截图截到入场透明度中间态，不能作为稳定态对比度通过证据。测试增加 `opacity:1` 完成信号并重跑；归档使用[稳定态截图](<../e2e/evidence/full-ui-audit/after/canvas-node-visual-audit---ca154-emplate-entry-are-reachable-web/PPT-length-menu.png>)，没有删除原过渡动画。
- 删除确认图也曾截到来源菜单的退出残影；等待该菜单真正移出 DOM 后补测两次并换用原始稳定态截图，没有裁图或修改原退出动画。
- 测试编写中发生的 `.ok()`／`.ok` 混用、错误角色名称、未指定活动文件 tab、flex-item 的 `inline-flex` blockification、错误 overflow 预期等已修正，不计入产品缺陷。

## 当前预览与未验范围

[预览工作区](<http://127.0.0.1:17673>) 已用原用户数据重启。Web 与项目文件 HTTP 均 200，9 个当前 CSS 产物可取；确认变体在根级样式，统一 picker 在延迟客户端样式中。既有画板经 HTTP 读取的 SHA-256 与排查前相同：

`fb15a495fcc49ab19d3e64be599fb759150259be703ff3013df843de2892a1f1`

仍明确未完成：

1. **外部扩展授权及完整原生扩展复验**：用户暂缓；未触发授权，未报通过。
2. 真实模型生成、代理执行、外部部署／发布／交接成功，以及配置了外部资源适配器的完整目录：当前无配置，只有真实不可用反馈和适配器单测，不是外部服务端到端验收。
3. 剪辑完整编码／导出媒体品质、音频听音质量；本轮验证真实上传、解码、时间推进和原参数界面，未据此声称完成上述质量验收。
4. 所有长耗时 loading／busy／错误恢复排列组合、任意数量资产下的滚动极限、所有窗口尺寸和缩放组合。共享规则已审计，已执行的宽窄与缩放档位见上表；不以“全量排查”冒称穷举所有运行状态。
