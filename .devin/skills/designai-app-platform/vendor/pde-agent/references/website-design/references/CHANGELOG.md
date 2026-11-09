# CHANGELOG.md — 版本变更记录

> 每次修改本 Skill 任何文件后，必须在本文件末尾追加一条记录。
> 格式：`| YYYY-MM-DD | 变更内容描述 | 变更文件 | 操作人 |`

## 当前版本：v2.1-general · 泛化去品牌版 — 2026-07-20

> **本副本 = web-site-beautifier 的泛化分支（无品牌绑定版）**，从 v2.1 七主题版 fork。
> 差异：① 默认主色由品牌蓝改为中性产品蓝 #3B6CF4；② 删除 F 深色霓虹（含 DataAgent/快手血统），替换为 F 极简黑（Mono Noir / MiniMax 感）；③ 全库清除快手/数平/DataAgent/天策/KwaiBI 等内部品牌术语；④ glow 由"仅 F 主题例外"改为全场景禁止。
> 内核（core/ + data-components/ + 数据硬规范）与原版保持一致，便于双版本共同维护。

> 版本命名规则：`v大版本.小版本 · 一句话代号`
> - 大版本（x.0）：设计哲学 / 能力质变时 +1
> - 小版本（2.x）：加主题、补场景、修规则等增量
>
> | 版本 | 代号 | 里程碑 |
> |------|------|--------|
> | v1.0 | 奠基版 | 5 场景 × 5 主题基础框架 |
> | v1.1 | 健壮版 | +F 主题、+响应式、+无障碍、反模式 12→20 条 |
> | **v2.0** | **意图版** | **引入意图性前置 + AI Slop Test + OKLCH 染色中性色** |
> | **v2.1** | **七主题版** | **+G 工程控制台主题（5×7）+ 图表色彩品牌泛化合并入主干（当前）** |

---

| 日期 | 变更内容 | 变更文件 | 操作人 |
|------|---------|---------|--------|
| 2026-06-23 | Skill 初始创建；包含 entrypoint.md 主入口 + 5 个场景文件 + 5 个主题文件 + 3 个 core 文件 + 4 个 data-components 文件 | 全部新建 | huwenji |
| 2026-06-23 | 新增 core/motion-icons.md（交互动效+图标体系）、data-components/site-chrome.md（站点框架组件）；扩展 scenes/data-report.md 和 scenes/dashboard.md 的站点交互层规范 | 多文件 | huwenji |
| 2026-06-23 | 新增 themes/F-dark-neon.md（深色霓虹主题，来源快手DataAgent暗黑版，用户说暗黑时触发）；更新 entrypoint.md 主题列表和触发规则 | themes/F-dark-neon.md, entrypoint.md | huwenji |
| 2026-06-23 | 最高标准自检与补强：① anti-patterns.md 从 12 条扩展到 20 条（新增多列对齐/按钮权重/对比度/表单/字间距/空数据/z-index/触控区域）② 新增 core/responsive-spec.md（4档断点/字号缩放/间距/移动端降级/触控）③ 新增 core/accessibility.md（WCAG AA/ARIA/键盘/色盲友好）④ entrypoint.md P0 规则补强（新增对比度P0/glow例外规则）⑤ 边界Case指南（8个常见边界场景）⑥ Self-Check 升级（新增对比度/高度对齐/按钮权重/响应式/触控检查）⑦ 兼容矩阵补充 F 主题列 | 多文件 | huwenji |
| 2026-07-17 | 吸收 frontend-design（Anthropic 官方）精华，5 处增强：① entrypoint.md 新增「Step 2.5 意图性前置动作」+ Self-Check 顶部「AI Slop Test + 眯眼测试」门控 ② anti-patterns.md 新增「AI Slop Test 金标准 + 11 条 2024-2025 AI 指纹清单」③ design-tokens.md 新增「OKLCH 色彩科学 + 染色中性色 + Alpha 设计异味」④ design-tokens.md 字号体系补「少字号大反差 + 垂直节奏 + 单字体原则」⑤ brand-token-derivation.md 新增「OKLCH 推导法」作为推荐首选（HSL 降为备选）⑥ motion-icons.md 新增「动效硬规则：只动 transform/opacity、grid 高度、退场75%、prefers-reduced-motion」 | entrypoint.md, core/anti-patterns.md, core/design-tokens.md, core/brand-token-derivation.md, core/motion-icons.md | zhuyani |
| 2026-07-20 | 合并第 7 套主题 G-technical-console（工程控制台：极客硬核/等宽字体/瑞士网格/信号橙强调，适用 tool-app★/dashboard 专业监控台），并同步登记到 entrypoint.md 描述/披露树/主题选择表/路由提示/目录树；图表色彩品牌泛化（brand-token §五 色轮均匀分布推导）已在库内确认；明确本 Skill 职责边界＝仅视觉美化，不含建站/构建/部署/发布能力 | themes/G-technical-console.md（新增）, entrypoint.md, references/CHANGELOG.md | zhuyani |
| 2026-07-20 | 修复 Step 2.5 Tone→Theme 映射断裂缺陷：① 补充显式映射桥接表（6 Tone → A/C/D/E 强制映射）② 新增组合 Tone 处理规则（主导Tone锁主题+另一Tone作Token微调，冲突时询问用户）③ 补充 B 主题的泛风格进入路径（"暗色专业感"→B vs "暗黑"→F）④ 新增 tech≠E/F 等防误选警告，解决同 prompt 不同对话产生不确定结果的问题 | entrypoint.md, references/CHANGELOG.md | zhuyani |
| 2026-07-20 | 二次吸收 frontend-design（Anthropic 官方）精华，聚焦「泛化能力」与「效果质量」双维增强（已剔除库内已有项，仅落地真增量）：【泛化】① brand-token-derivation §4.1 新增「感受关键词→字体族」映射表（补全感受映射缺失的字体维度，含禁用清单）② §4.2 新增「感受关键词→动效性格」映射表（时长/缓动/入场手法）③ 新增 §2.5「暗色品牌 Token 推导公式」（把任意品牌色泛化能力从亮色扩展到暗色，表面提亮表达层级/背景非纯黑/字重350）④ §5.1 图表色序新增「OKLCH 均匀推导法」（跨色相亮度一致，HSL 降为备选）；【质量】⑤ 新增 core/interaction-states.md（8 种交互状态清单 + UX 文案规范：按钮动词+对象/错误三段式/空状态引导/术语一致）；同步更新 entrypoint.md 披露树+目录树+Step2.5+Self-Check 引用，brand-token §六 Self-Check 补充新维度 | core/brand-token-derivation.md, core/interaction-states.md（新增）, entrypoint.md, references/CHANGELOG.md | zhuyani |
| 2026-07-20 | Fork 泛化去品牌版：① SKILL name→web-site-beautifier-general、description 去品牌化并声明中性默认主色 ② 全库主色 #2563F4→#3B6CF4，清除"数平蓝"字样 ③ 删除 themes/F-dark-neon.md，新增 themes/F-mono-noir.md（极简黑/MiniMax 感，全场景禁 glow）④ 清除 快手/数平/DataAgent/天策/KwaiBI 等内部术语（site-chrome/accessibility/brand-token-derivation/echarts-config）⑤ entrypoint.md 同步：Tier 披露树/主题选择表/暗黑路由/P0 glow 规则/Self-Check/兼容矩阵/目录树 全部指向 F 极简黑 ⑥ 数据场景与数据硬规范全部保留（KPI/ECharts/表格质感规范不动）| entrypoint.md, themes/F-mono-noir.md（新增）, themes/F-dark-neon.md（删除）, core/*, data-components/*, references/CHANGELOG.md | MyFlicker |
| 2026-07-20 | 强化泛化能力（洞1：离散主题→连续风格空间）：新增 core/theme-blending.md（5 个安全旋钮 K1-K5 圆角/留白/字重/饱和度/阴影 + 硬量程 clamp + 线性插值算法 + 7 条开箱配方 + 禁止项 + Self-Check），并接入 entrypoint.md：披露树、Step2 后新增「主题混合分支」路由、目录树、Self-Check 新增「主题混合专项」。核心约束：量程内自由插值、量程外锁死，混合只改风格气质不破 P0 铁律与场景骨架 | core/theme-blending.md（新增）, entrypoint.md, references/CHANGELOG.md | MyFlicker |
| 2026-07-20 | 深度去数据平台定制影子（分享给内部通用 agent 前的清理）：① 斩断 scenes/data-report.md 对外部 skill「独立图表美化能力」的硬依赖，改为指向库内自包含的 data-components/echarts-config|kpi-card|table-spec（修复通用 agent 走到 data-report 场景会断链的功能 bug）② data-components/ 四文件（table-spec/kpi-card/echarts-config/semantic-colors）与 B 主题的「移植自/来源于 独立图表美化能力」署名改为库内自包含表述 ③ tool-app 场景默认主色 #2563EB→#3B6CF4，与泛化版中性默认统一。保留项：entrypoint.md 第23行「Python图表美化→独立图表美化能力」为正当能力边界路由；B/G/semantic-colors/table-spec/anti-patterns 中的 #2563EB 为各自体系合理配色（深色亮蓝/热力图阶/示例对比），不动 | scenes/data-report.md, scenes/tool-app.md, data-components/*, themes/B-dark-pro.md, references/CHANGELOG.md | MyFlicker |
| 2026-07-20 | 路由逻辑自洽收尾：① entrypoint.md 版本头由「v2.0 意图版」同步为「v2.1-general 泛化去品牌版」，补充主题混合/中性默认/自包含说明 ② Step 2.5 意图性前置的 Tone 映射表接入 theme-blending——「warm 暖化 / X化 / 像X但更Y」明确路由到 core/theme-blending.md 做受控插值，避免新增的主题混合能力未接入高频入口 | entrypoint.md, references/CHANGELOG.md | MyFlicker |
| 2026-07-23 | Description 重构 + name 更新：① name 由 web-site-beautifier-general → website-design ② 定位句由「网站视觉与样式美化 Skill」→「网站设计与生成 Skill」，同时覆盖从零建站和美化优化 ③ 核心能力句由「把AI生成的网页样式收敛到设计规范内」→「从零生成专业级网站页面，或将已有页面样式收敛到设计规范内」，生成优先级提升 ④ 触发场景排序调整：从零生成提到第一，新增品牌定制触发条 ⑤ 职责边界措辞由「只负责视觉与样式美化」→「负责网站视觉设计与页面生成」，不再自我缩小 | entrypoint.md, references/CHANGELOG.md | MyFlicker |
| 2026-07-30 | 集成副本去除旧品牌命名与相关描述：Skill name 统一为 website-design，能力边界改为中性表述；仅更新 Website Builder 内嵌副本及集成文档，不回写源目录 | entrypoint.md, references/CHANGELOG.md, ../website-design-integration.md, ../../../entrypoint.md | MyFlicker |
| 2026-07-30 | 将内嵌 website-design 从子 Skill 形态改为普通参考模块：entrypoint.md 重命名为 website-design.md，并同步父入口、集成编排、目录树与检查引用 | website-design.md, references/CHANGELOG.md, ../website-design-integration.md, ../../../entrypoint.md | MyFlicker |
