---
name: website-design
description: |-
  网站视觉设计与生成 Skill（泛化版 · 无品牌绑定 · 全场景通用）。核心能力：从零生成专业级网站页面，或将已有页面样式收敛到设计规范内，
  解决风格随机、配色乱、层级杂乱、"AI 审美"问题，覆盖 5 大场景 × 7 套主题风格 × 任意品牌色定制。
  默认主色为中性产品蓝 #3B6CF4，不绑定任何公司品牌；用户提供品牌色时以品牌色为准。
  【职责边界】本 Skill 负责"网站视觉设计与页面生成"，不负责工程搭建 / 构建 / 部署 / 发布——
  那些能力属于独立的工程 Skill，二者互不包含。
  【典型触发场景】
  - 从零生成：说"帮我做一个官网 / Landing Page / 数据看板 / 工具后台 / 内容站 / 电商站"；
  - 显式美化：对已有 HTML 说"美化一下"、"风格太乱"、"不够高级"、"换成暗色主题"、"太丑了"；
  - 样式迭代：说"改一下风格"、"换一套主题"、"调整一下颜色"；
  - 场景路由：说"用企业风"、"用极简风"、"用深色专业风"；
  - 品牌定制：说"用我们的品牌色 / 参考某个网站的风格 / 像X但更Y"。
  【5 大场景】
  （1）Landing Page / 产品官网；（2）数据日报 / 周报；（3）数据看板 / Dashboard；
  （4）工具型应用 / 内部系统；（5）内容站 / 文档站。
  【7 套主题风格】
  A-企业亮色（中性产品蓝 #3B6CF4 / 大厂商务风）、B-深色专业（大屏 / 高管报告）、
  C-编辑排版（内容型 / 阅读优先）、D-极简轻量（Linear / Notion 感）、E-卡片网格（Bento / 强对比）、
  F-极简黑（黑作主色 + 极简点缀，MiniMax 感 / 高级克制，用户要求暗黑或极简黑时使用）、
  G-工程控制台（极客硬核 / 终端感 / 等宽字体 / Grafana·Linear 风，专业数据工具/监控台）。
  【不适用】创意自由度页面（海报/邀请函/活动页/游戏）→ frontend-design；
  流程图/架构图 → drawio-diagram；Python 图表美化 → 使用独立的图表美化能力。
---

# web-site-beautifier

> **当前版本：v2.1-general · 泛化去品牌版（Intent Edition）**　｜　基于 v2.1 七主题版 fork
> 本版核心：意图性前置 + 反 AI 味（AI Slop Test）+ OKLCH 染色中性色 + 主题混合（连续风格空间）；
> 无品牌绑定，默认中性产品蓝 #3B6CF4，自包含无外部 skill 依赖。
> 版本沿革见 `references/CHANGELOG.md`。

> **核心原则**：功能逻辑优先，样式收敛在后。  
> 对已有产物：**只动样式，不动结构和业务逻辑**。  
> 对新建产物：先确定场景与主题，再按规范生成。  
> 每次输出前必须通过 §Self-Check。

---

## 渐进式披露策略（Progressive Disclosure）

> 本 Skill 采用分层加载，**不要一次读取全部文件**。

```
Tier 0（本文件，必读）：
  场景识别 → 主题选择 → 执行模式路由 → P0 硬性规则 → Self-Check

Tier 1（按场景选一个，必读）：
  scenes/landing-page.md       Landing Page / 产品官网
  scenes/data-report.md        数据日报 / 周报
  scenes/dashboard.md          数据看板 / Dashboard
  scenes/tool-app.md           工具型应用 / 内部系统
  scenes/content-doc.md        内容站 / 文档站

Tier 2（按需加载）：
  themes/A-enterprise-light.md   主题 A — 企业亮色（Landing Page / 工具应用默认）
  themes/B-dark-pro.md           主题 B — 深色专业
  themes/C-editorial.md          主题 C — 编辑排版
  themes/D-minimal.md            主题 D — 极简轻量
  themes/E-bold-bento.md         主题 E — 卡片网格
  themes/F-mono-noir.md            主题 F — 极简黑（MiniMax 感，用户说暗黑/极简黑时触发）
  themes/G-technical-console.md  主题 G — 工程控制台（硬核数据工具/监控台时）
Tier 3（高级定制，特殊场景）：
  core/design-tokens.md          全局 Token 体系（色彩/字号/间距/圆角/阴影）
  core/theme-blending.md         主题混合/微调规则（"像X但更Y"、"X和Y之间"时加载）
  core/anti-patterns.md          反模式清单 20 条（BAD vs GOOD 对照）
  core/three-layer-spec.md       三层映射规范 + 品牌定制推导指南
  core/brand-token-derivation.md 从品牌色/风格描述推导完整 Token 体系（🆕）
  core/responsive-spec.md        响应式完整规范（断点/缩放/触控）
  core/accessibility.md          可访问性规范（对比度/ARIA/色盲友好）
  data-components/kpi-card.md    KPI Card + Sparkline 规范
  data-components/echarts-config.md  ECharts 标准配置
  data-components/table-spec.md  表格密度自适应规范
  data-components/semantic-colors.md 语义色使用规则
  data-components/site-chrome.md 站点框架组件（导航/Tab/筛选）
  references/CHANGELOG.md        版本变更记录
```

---

## Step 1：场景识别

> 根据用户描述和已有产物类型，选择唯一场景。

```
用户说的是什么 / 产物是什么？
│
├─ "官网" / "Landing Page" / "产品页" / "营销页"
│   → 场景：landing-page ✦ 加载 scenes/landing-page.md
│
├─ "日报" / "周报" / "月报" / "数据报告"
│   → 场景：data-report ✦ 加载 scenes/data-report.md
│
├─ "看板" / "Dashboard" / "监控大屏" / "数据驾驶舱"
│   → 场景：dashboard ✦ 加载 scenes/dashboard.md
│
├─ "后台" / "管理系统" / "工具" / "内部平台" / "B 端"
│   → 场景：tool-app ✦ 加载 scenes/tool-app.md
│
├─ "博客" / "文档" / "知识库" / "内容站"
│   → 场景：content-doc ✦ 加载 scenes/content-doc.md
│
└─ 无法识别 → 询问用户：
   "请告诉我这是哪种页面类型？
    (1) 产品官网/Landing Page
    (2) 数据日报/周报
    (3) 数据看板/Dashboard
    (4) 工具后台/内部系统
    (5) 内容站/文档站"
```

---

## Step 2：主题选择

> 场景确定后选择主题风格。**优先用用户明确指定**；用户未指定则参考下表默认推荐。

| 主题 | 关键词 | 适用场景 | 文件 |
|------|--------|---------|------|
| **A — 企业亮色** | 大厂风 / 中性产品蓝设计系统 / 专业商务 | landing-page ★ / tool-app ★ / **data-report ★ / dashboard ★** | `themes/A-enterprise-light.md` |
| **B — 深色专业** | 暗色大屏 / 高管汇报 / 简洁深色 | dashboard / data-report | `themes/B-dark-pro.md` |
| **C — 编辑排版** | 杂志感 / 高端阅读 / 内容优先 / 排版讲究 | content-doc ★ / landing-page | `themes/C-editorial.md` |
| **D — 极简轻量** | Notion / Linear / 干净 / 无装饰 | tool-app / content-doc | `themes/D-minimal.md` |
| **E — 卡片网格** | Bento / 强对比 / 大字 / 现代感 | landing-page / dashboard | `themes/E-bold-bento.md` |
| **F — 极简黑** | MiniMax 感 / 黑作主色 / 极简点缀 / 高级克制 | landing-page / content-doc / tool-app（暗黑极简版）| `themes/F-mono-noir.md` |
| **G — 工程控制台** | 极客硬核 / 终端感 / 等宽字体 / Grafana·Datadog·Linear 风 | tool-app ★ / dashboard（专业监控台）| `themes/G-technical-console.md` |

> ★ = 该场景默认推荐主题（用户未指定时选此）  
> **所有场景未指定主题时默认 A — 企业亮色（蓝色）**  
> **用户说「暗黑」/「暗色」/「深色」/「dark」/「极简黑」→ 使用 F — 极简黑**  
> 用户说「大屏」/「简洁暗色」→ 使用 B — 深色专业
> 用户说「极客」/「硬核」/「终端感」/「工程感」/「像 Grafana・Datadog・Linear」/「专业数据工具」→ 使用 G — 工程控制台

> **🎚️ 主题混合分支**：当用户需求不是单一主题，而是「像 X 但更 Y」「介于 X 和 Y 之间」「X 风格，只是[圆角/留白/字重/饱和度/阴影]调一下」时
> → 以最贴近的主题为 base，加载 `core/theme-blending.md`，按其旋钮规则做**受控插值**（量程内自由，量程外锁死），不要强行吸附到单一主题。

---

## Step 2.5：意图性前置动作（Intentionality First）

> **核心信条**：Bold（大胆极繁）和 refined（克制极简）都能成功——**关键是"意图性"，不是强度**。
> 平庸的根源是"没做设计决策"，而非"做得不够多"。生成前先 commit 一个清晰方向，避免落回通用模板。

```
数据场景（data-report / dashboard / tool-app）：
  意图性已由「场景规范 + 主题 Token」锁定 → 直接执行，无需额外决策
  （这些场景的"方向"就是：克制、专业、信息密度优先）

泛风格化场景（landing-page / content-doc）：
  ⚠️ 禁止"安全的平庸"——不要让 AI 自由发挥落回通用 AI 模板
  Mode C（从零生成）前必须先明确一句话方向（写进设计说明）：
    · Purpose：这个页面解决什么问题？谁在看？
    · Tone：从下列中选定一个极端并执行到底，并按映射表锁定主题——

        ┌─────────────────┬──────────────────────────────────────────┬───────────────┐
        │ Tone 关键词     │ 含义（注意区分！）                       │ → 锁定主题    │
        ├─────────────────┼──────────────────────────────────────────┼───────────────┤
        │ editorial 杂志感│ 高端阅读、大图文、版式讲究               │ → 主题 C      │
        │ minimal 极简克制│ Notion/Linear 感、无装饰、大留白         │ → 主题 D      │
        │ bold-bento 强对比│ 大字 Bento 卡片、高饱和对比、视觉冲击  │ → 主题 E      │
        │ warm 温暖亲切   │ 柔和色调、圆润、强调情感连接             │ → 主题 A（暖化）│
        │ luxury 奢华留白 │ 极度留白、细线、高级感、克制奢华         │ → 主题 C 或 A │
        │ tech 冷峻科技   │ 克制商务、企业感，≠ 炫酷/花哨           │ → 主题 A      │
        └─────────────────┴──────────────────────────────────────────┴───────────────┘

        ⚠️ 重要：Tone 与主题的映射是强制的，不得因为"看起来有科技感"就选 E/F/G
           · "tech 冷峻科技" → 主题 A（克制企业商务），不是 E（Bento 强对比）
           · "luxury 奢华留白" → 主题 C 或 A，不是 E/F
           · 只有用户明确说 "暗黑/dark" 才走 F；明确说 "Grafana/终端/硬核" 才走 G

        组合 Tone 处理规则（如用户同时说两个方向）：
           · 取最具差异化的 Tone 作为主导，锁定对应主题
           · 另一个 Tone 作为 Token 微调方向（字重/留白/圆角），不切换主题
           · 示例："tech + luxury" → tech 主导 → 主题 A，luxury 作为大留白/细线的 Token 微调
           · 示例："minimal + bold-bento" → 两者冲突，询问用户："克制留白"还是"强对比大字"？

        暗色泛风格路径（B / F 主题的进入方式）：
           · 用户说"暗色专业感"/ "暗色但不炫" / "深色商务" → 主题 B（深色专业）
           · 用户说"暗黑/dark/极简黑/黑金/性冷淡黑" → 主题 F（极简黑）
           · B 与 F 的区别：B 是「克制深色·高对比·工程感」，F 是「黑作主色·极简点缀·MiniMax 高级克制」

    · Differentiation：别人记住的"那一个点"是什么？
  → 选定 Tone 后：按上表锁定主题，再加载对应主题文件 + core/brand-token-derivation.md 的感受关键词表
    （§四 圆角/阴影/间距/字重、§4.1 字体族、§4.2 动效性格 —— 三维一起定，别只定颜色）
  → 若映射结果带"（暖化）/（X化）"或用户要"像X但更Y"：加载 core/theme-blending.md，
    以锁定主题为 base、按旋钮做受控插值（如 warm→A 暖化 = base A + K1圆角/K4暖色相偏移），不要硬吸附成纯主题

Mode A（显式优化已有产物）：
  不改方向，只把现有风格收敛到最近的场景+主题规范内（保持业务结构不变）
```

---

## Step 3：执行模式选择

```
已有 HTML / 产物？
├─ 是 → Mode A（显式优化）
│       核心：只动样式，不动结构 / JS / 业务逻辑
│
├─ 否 → 用户明确说"帮我做一个 XX"？
│        ├─ 是 → Mode C（从零生成）
│        │       核心：按场景叙事节奏 + 主题 Token 生成
│        └─ 否 → Mode B（隐式自检）
│                核心：Agent 输出 HTML 前自动执行 P0 Lint
│
└─ 部分已有（"扩展/改进"）→ Mode A
```

### Mode A — 显式优化（最常用）

```
1. 读取并分析已有 HTML
   → 识别当前色调（亮色/暗色）、主色、字体、组件结构
   
2. 加载对应 Tier 1 场景文件（按 Step 1 识别结果）

3. 加载对应 Tier 2 主题文件（按 Step 2 选择结果）
   → 提取主题 CSS Token 覆盖块

4. Token 注入（不重写 HTML）
   → 在原 :root 之后追加新 :root 覆盖块
   → 在 </head> 之前追加 <style> 精准修正块

5. 样式对齐执行
   → 对照场景规范修正间距、字阶、颜色、圆角
   → 清除反模式（emoji / 彩色顶条 / 过大圆角 / 渐变背景卡片）

6. 执行 §Self-Check → 全部通过后输出
```

⚠️ **Mode A 红线（违反视为破坏业务能力）**：
```
✗ 禁止修改 <script> 内容
✗ 禁止修改 ECharts/Chart.js options
✗ 禁止修改交互逻辑（筛选器/Tab/弹窗）
✗ 禁止重写原 :root（只能追加，利用层叠覆盖）
✗ 禁止修改 HTML 结构（只做样式层操作）
```

### Mode B — 隐式自检

```
1. Agent 输出 HTML 前自动执行 P0 Lint
2. 全部通过 → 直接交付
3. 存在违规 → 执行 Token 注入修复
4. 交付时简要说明："已自动修复 N 项样式违规：[列表]"
```

### Mode C — 从零生成

```
1. 加载场景文件（Tier 1）→ 获取叙事节奏和模块结构
2. 加载主题文件（Tier 2）→ 获取完整 CSS Token
3. 按场景骨架生成 HTML（含 Page Shell）
4. 填充真实数据（禁止捏造）
5. 执行 §Self-Check → 全部通过后输出
```

---

## P0 Hard Rules（违反即返工，无例外）

> 所有场景、所有主题均强制执行。

```
── 通用 ──────────────────────────────────────────────────────────────
[P0] 禁止在标题、按钮、标签、正文中使用 Emoji
[P0] 数据/内容不得裁剪 — 标签、气泡、图例、文字均不得截断或溢出
[P0] 正向 delta = 绿（见主题色彩），负向 delta = 红，不得反向
[P0] border-radius ≤ 12px（landing page 可放宽到 16px，其余场景 ≤ 8px）
[P0] 非灰色彩色 ≤ 3 种（primary + success + danger）；多分类语义场景最多 10 色
[P0] 发光效果（glow/box-shadow 彩色阴影）全场景禁止（本泛化版无霓虹主题）

── 版式 ──────────────────────────────────────────────────────────────
[P0] 禁止 float 布局（必须用 grid / flex）
[P0] 字号使用 5 级体系，禁止自造第 6 级（见 core/design-tokens.md）
[P0] font-weight 禁止使用 100 / 300（中文下过细，糊）
[P0] 正文颜色对比度 ≥ 4.5:1（WCAG AA 标准）

── 数据场景专属（data-report / dashboard）─────────────────────────────
[P0] 禁止彩色卡片顶条（card colored top bar）
[P0] KPI 数字 ≥ 28px，且必须是区域内最大字号
[P0] ECharts grid.top ≥ 48px（含 markPoint 时）；含 2 行标题时 ≥ 56px
[P0] ECharts 容器禁止设固定 px 高度，必须用 flex:1;min-height:0 撑满父卡片
```

---

## 边界 Case 处理指南

> **以下情况均有明确处理规则，不得随意判断。**

### Case 1：用户提供了品牌色（如"主色用 #FF5C00"）

```
品牌色的正确用法：
  ✅ CTA 按钮（Primary Button）背景色
  ✅ Active 导航项、Tab 指示线
  ✅ 链接颜色
  ✅ 数据图表的第一个系列色
  ✅ Section 编号方块背景

  ❌ 禁止：整个 header/hero 背景用品牌色（除非是深色浓郁品牌）
  ❌ 禁止：卡片背景用品牌色（变成彩色卡片）
  ❌ 禁止：用品牌色替代 --color-success/danger（语义色不可替换）
  
  处理：将品牌色注入 --color-primary，其余 Token 保持主题默认。
```

### Case 2：页面已经有深色背景（暗色代码存在）

```
判断是否匹配已有主题：
  a) 背景接近 #060C1A / #0F172A 等深海军蓝 → 匹配 F 或 B 主题
  b) 背景是 #18181B / #111 等近黑 → 匹配 B 主题
  c) 其他深色 → 提取现有 bg 色，注入 --bg 覆盖默认值

  不得强制切换到亮色主题，应在原有暗色体系内对齐规范。
```

### Case 3：混合场景（如"报告里有一个工具型筛选器"）

```
原则：以内容主场景为准，组件级可跨场景借用。
  
  示例：data-report 页面中有一个复杂的 FilterBar
  → 主场景仍是 data-report，加载 scenes/data-report.md
  → FilterBar 组件直接借用 data-components/site-chrome.md §七、FilterBar
  → 不需要额外加载 tool-app.md
```

### Case 4：用户提供了截图/参考图，要求"做成这个风格"

```
处理步骤：
  1. 识别参考图的主场景（是 Landing Page 还是 Dashboard？）
  2. 提取参考图的色调（亮/暗）
  3. 识别最接近的主题（A/B/C/D/E/F）
  4. 加载对应场景 + 主题文件
  5. 使用 core/three-layer-spec.md 的三层框架，将参考图的每个视觉决策
     映射到 User→Design→Tech 三层
  6. 不得"像素级复刻"参考图（违法版权），而是提炼设计原则后重新生成
```

### Case 5：代码已有多套 CSS（有 BEM / 有 Tailwind / 有 inline style 混用）

```
Mode A 处理策略（显式优化）：
  a) Tailwind：在 className 末尾追加覆盖类，或在 <style> 中用 !important 覆盖关键 Token
  b) BEM + CSS Module：追加 :root Token，让 CSS 变量全局生效
  c) Inline style：保留 inline style（业务数据计算型），只修改 class-based 样式
  d) 三者混用：优先级策略 inline > class > :root，追加 :root 对 inline 无效时，
     评估是否修改 inline（仅限纯视觉参数，如颜色/圆角）
```

### Case 6：响应式已有但断点与本规范不一致

```
不强制重写已有断点，而是：
  a) 读取已有断点值
  b) 检查移动端是否有基础适配（主要检查 3 点：
     - 单列 / 多列降级
     - 字号是否过大
     - tap 区域是否 ≥ 44px）
  c) 只修改严重影响可用性的断点，其余保留
```

### Case 7：图表数据由用户提供但量很少（只有 1-2 个数据点）

```
1 个数据点：不生成折线图（无意义），用大 KPI 数字 + 文字说明代替
2 个数据点：可生成柱状图做对比（Bar），但不生成折线图
3+ 个数据点：可生成折线图
如果 Sparkline 数据 < 3 个点：不生成 canvas/sparkline，不捏造数据
```

### Case 8：既有 ECharts 图表，主题切换时图表配色不跟随

```
Mode A 处理：
  1. 找到 echarts.init(el) 所在代码
  2. 不修改 options 数据逻辑
  3. 在 setOption 之后追加样式覆盖：
     chart.setOption({
       color: NEON_PALETTE,  // 仅追加颜色配置
       ...ECHARTS_DARK_NEON, // 追加主题基础配置
     }, { replaceMerge: ['color'] });
  4. 如果无法访问 chart 实例，在 data-components/echarts-config.md 
     中找对应主题的 CSS 变量覆盖方案
```

---

## Self-Check（输出前全部通过）

> 场景文件中可能包含额外的专项检查，本清单为通用基础项。

```
★ 顶层门控：AI Slop Test（先过这一关，再看细项）
[ ] 若把产物给别人看并说"这是 AI 做的"，对方会立刻相信吗？
    → 会相信 = 有问题，回到细项排查（见 core/anti-patterns.md §AI 指纹清单）
    → 好的产物让人问"这怎么做的？"，而非"这哪个 AI 生成的？"
[ ] 眯眼测试（Squint Test）：把页面模糊看，主次层级是否依然清晰？
    → 一片均匀灰 = 层级不足，需拉开 尺寸/字重/留白 的对比

通用基础项
[ ] P0 规则全部通过
[ ] 无 Emoji（标题/按钮/标签/正文）
[ ] 配色使用主题 Token，未随意自造颜色
[ ] 字号使用 5 级体系，未出现第 6 级
[ ] border-radius 符合场景限制
[ ] 布局使用 grid/flex，无 float
[ ] 无渐变背景卡片（卡片背景为纯白或浅灰平色）
[ ] 无装饰性 radial-gradient 光晕（landing-page header 除外）
[ ] delta 仅用颜色区分，不用 ▲▼ 字符；同时有箭头图标（色盲双重编码）
[ ] 正文颜色对比度 ≥ 4.5:1（辅助文字 ≥ 3:1）
[ ] 多列卡片使用 grid + align-items:stretch（高度对齐）
[ ] 按钮有权重层级（primary/secondary/ghost，一屏 primary ≤ 2）
[ ] 响应式：核心断点 768px/480px 已覆盖
[ ] 移动端可点击元素 min-height ≥ 44px

场景专项（加载对应场景文件后补充）
[ ] → 见 scenes/{scene-name}.md § Self-Check 补充项

主题专项（加载对应主题文件后补充）
[ ] → 见 themes/{theme-name}.md § Self-Check 补充项

主题混合专项（发生主题混合时补充）
[ ] → 见 core/theme-blending.md § 七：Blend 配方已写明 + 旋钮全部量程内 + 未破 P0

交互与文案专项（产物含表单/按钮/可交互组件时补充）
[ ] → 见 core/interaction-states.md：8 态是否想全 + 按钮/错误/空状态文案是否像人写的
```

---

## 场景 × 主题 兼容矩阵

| 场景 \ 主题 | A 企业亮色 | B 深色专业 | C 编辑排版 | D 极简 | E 卡片网格 | F 极简黑 |
|-----------|-----------|-----------|-----------|--------|-----------|-----------|
| Landing Page | ✅ ★推荐 | ⚠️ 慎用 | ✅ 可用 | ✅ 可用 | ✅ 可用 | ✅ 可用 |
| 数据日报 | ✅ **★默认** | ✅ 可用 | ❌ 不适合 | ✅ 可用 | ❌ 不适合 | ⚠️ 慎用 |
| 数据看板 | ✅ **★默认** | ✅ 可用 | ❌ 不适合 | ✅ 可用 | ✅ 可用 | ⚠️ 慎用 |
| 工具应用 | ✅ 可用 | ✅ 可用 | ❌ 不适合 | ✅ ★推荐 | ❌ 不适合 | ✅ 可用（暗黑时）|
| 内容站 | ⚠️ 可用 | ❌ 不适合 | ✅ ★推荐 | ✅ 可用 | ❌ 不适合 | ✅ 可用 |

> ✅ = 完全兼容 / ⚠️ = 可用但需调整 / ❌ = 不推荐，视觉逻辑冲突

---

## 版本管理约束（⚠️ 强制执行）

每次修改本 Skill 任何文件后，必须在 `references/CHANGELOG.md` 末尾追加一条记录：

```
| YYYY-MM-DD | 变更内容描述 | 变更文件 | 操作人 |
```

---

## 文件结构总览

```
web-site-beautifier/
├── website-design.md             ← 本文件：主文档、场景路由、P0 规则
│
├── scenes/                       ← Tier 1：每次必读一个
│   ├── landing-page.md           Landing Page / 产品官网
│   ├── data-report.md            数据日报 / 周报（含站点交互层规范）
│   ├── dashboard.md              数据看板 / Dashboard（含站点交互层规范）
│   ├── tool-app.md               工具型应用 / 内部系统
│   └── content-doc.md            内容站 / 文档站
│
├── themes/                       ← Tier 2：按主题选一个
│   ├── A-enterprise-light.md     企业亮色（Landing Page / 工具应用默认）
│   ├── B-dark-pro.md             深色专业（大屏 / 高管）
│   ├── C-editorial.md            编辑排版（杂志 / 内容）
│   ├── D-minimal.md              极简轻量（Linear / Notion）
│   ├── E-bold-bento.md           卡片网格（Bento / 强对比）
│   ├── F-mono-noir.md            极简黑（MiniMax 感 / 黑作主色 / 暗黑极简）
│   └── G-technical-console.md    工程控制台（tool-app/dashboard 硬核监控台 ★）
│
├── core/                         ← Tier 3：高级定制时按需读
│   ├── design-tokens.md          全局 Token：色/字/距/角/影
│   ├── theme-blending.md         主题混合/微调规则（连续风格空间，"像X但更Y"时读）
│   ├── anti-patterns.md          反模式清单 20 条（BAD vs GOOD）
│   ├── three-layer-spec.md       User→Design→Tech 三层映射规范
│   ├── motion-icons.md           交互动效规范 + 图标引用体系
│   ├── responsive-spec.md        响应式完整规范（断点/缩放/触控）
│   ├── accessibility.md          可访问性规范（对比度/ARIA/色盲）
│   └── interaction-states.md     交互 8 态清单 + UX 文案规范（🆕）
│
├── data-components/              ← Tier 3：数据场景专用组件
│   ├── kpi-card.md               KPI 卡片 + Sparkline（零依赖 JS）
│   ├── echarts-config.md         ECharts 标准配置与辅助函数
│   ├── table-spec.md             表格密度自适应规范
│   ├── semantic-colors.md        语义色：正/负/中性/状态
│   └── site-chrome.md            站点框架：导航/Tab/筛选/Section标题（🆕）
│
└── references/
    └── CHANGELOG.md              版本变更记录（每次修改必填）
```
