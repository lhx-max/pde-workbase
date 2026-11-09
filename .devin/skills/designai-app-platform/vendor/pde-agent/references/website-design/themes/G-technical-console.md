# themes/G-technical-console.md — 工程控制台主题（Technical Console）

> **版本归属**：`v1.1.0-exp` 实验内容（第 7 套主题）。吸收自 `frontend-craft / minimal-developer`
> （Technical Brutalism × Swiss Modernism），针对 data B 端场景改造。回退 exp 时本文件整体移除。
>
> **定位**：极客硬核的"精密工程控制台"——锐利线条、模块化边框、等宽字体、零装饰，强调效率与数据秩序感。
> **气质**：像 Bloomberg 终端 / Grafana / Datadog / Linear 那种专业工具感，冷、硬、精密、可信。
> **用户印象**："像专业的工程控制台"、"数据很硬核很密"、"像终端/IDE，一看就是给专业人用的"。
> **适用场景**：`tool-app` ★（工具型应用）/ `dashboard` ★（专业监控台）/ `data-report` ⚠️（偏硬，慎用）/ `landing-page` ❌
> **与现有主题区别**：A 是商务亲和亮色、D 是 Notion 柔和无装饰，而 G 是**硬核工程秩序感 + 瑞士网格 + 等宽字体**，气质"冷硬精密"，填补"专业数据工具"空白。
> **字体组合**：标题 Inter/Grotesque Sans + 标签/数字/代码 **等宽字体（JetBrains Mono / SF Mono）**（灵魂）+ PingFang SC 中文补字。

---

## 一、CSS Token 变量（复制至 `:root`）

```css
:root {
  /* ── 品牌 / 信号强调色（唯一 CTA 色，模拟代码高亮）── */
  --color-primary:       #FF4D00;   /* 信号橙：仅用于 CTA/激活/标记，不用于数据涨跌 */
  --color-primary-light: rgba(255,77,0,0.10);
  --color-primary-dark:  #E64500;
  --color-on-primary:    #FFFFFF;

  /* ── 数据语义色（严格独立于强调色）── */
  --color-success:  #16A34A;   /* 上涨/正向：绿 */
  --color-danger:   #DC2626;   /* 下跌/负向：红 */
  --color-warning:  #CA8A04;   /* 警告：琥珀 */
  --color-positive: #16A34A;
  --color-negative: #DC2626;
  --color-neutral:  #71717A;

  /* ── 背景层级（工程图纸：纸灰 + 白卡）── */
  --color-bg-page:   #F7F7F8;   /* 纸灰底 */
  --color-bg-card:   #FFFFFF;   /* 白卡 */
  --color-bg-subtle: #F4F4F5;   /* 次级区块/表头 */
  --color-bg-hover:  #FAFAFA;   /* hover 底 */
  --color-bg-inverse:#111113;   /* 反色区块（图解/终端窗口）*/

  /* ── 文字层级（高对比消色差）── */
  --color-text-primary:   #111113;   /* 近黑：标题/主数据 */
  --color-text-body:      #3F3F46;   /* 正文 */
  --color-text-secondary: #71717A;   /* 辅助/标签 */
  --color-text-disabled:  #A1A1AA;
  --color-text-code:      #52525B;   /* mono 标签色 */

  /* ── 边框与分隔（模块化细线，锐利）── */
  --color-border:        #E4E4E7;   /* 默认 1px 细线 */
  --color-border-strong: #111113;   /* hover/激活：硬切黑 */
  --color-divider:       #EFEFF1;
  --color-grid-line:     rgba(17,17,19,0.04);  /* 背景工程网格 */

  /* ── 圆角（锐利，工程感；P0 上限 12px，此主题刻意取极小）── */
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 6px;

  /* ── 阴影：无！工程粗野主义放弃投影，改用边框分割 ── */
  --shadow-none: none;

  /* ── 等宽字体标签间距 ── */
  --mono-tracking: 0.08em;
}
```

### 深色终端变体（可选，`data-theme="console-dark"` 时覆盖）

```css
[data-theme="console-dark"] {
  --color-bg-page:   #0A0A0B;   /* 终端黑 */
  --color-bg-card:   #141416;
  --color-bg-subtle: #1C1C1F;
  --color-bg-hover:  #1A1A1D;
  --color-bg-inverse:#F7F7F8;
  --color-text-primary:   #F4F4F5;
  --color-text-body:      #D4D4D8;
  --color-text-secondary: #A1A1AA;
  --color-text-code:      #E4E4E7;
  --color-border:        #27272A;
  --color-border-strong: #F4F4F5;
  --color-divider:       #1F1F22;
  --color-grid-line:     rgba(255,255,255,0.04);
  --color-primary:       #FF6A2B;   /* 深色下橙提亮 */
  --color-success:       #22C55E;   /* 深色下绿提亮 */
  --color-danger:        #F87171;   /* 深色下红提亮 */
}
```

---

## 二、字体配置（双字体策略 · 灵魂）

```css
body {
  font-family: "Inter", -apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif;
  background: var(--color-bg-page);
  color: var(--color-text-body);
  -webkit-font-smoothing: antialiased;
  font-size: 14px;
}
/* 标签 / 数字 / 代码 / 表头 —— 等宽字体，工程属性的核心标识 */
.mono, .kpi-value, .data-table td.num, .label-tag, .metric-code, code {
  font-family: "JetBrains Mono", "SF Mono", "Roboto Mono", ui-monospace, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
/* 功能性标签：小号 + 大写 + 宽字距（终端标签感）*/
.label-tag {
  font-size: 11px; text-transform: uppercase; letter-spacing: var(--mono-tracking);
  color: var(--color-text-secondary);
}
/* 标题：紧凑字距，力量感 */
h1, h2, .display { font-weight: 700; letter-spacing: -0.02em; color: var(--color-text-primary); }
```

---

## 三、核心设计规范（感受 → 原理 → 技术）

### 3-1　视觉一致性：显性化网格 + 模块化边框

- **[用户感受]**：整个页面像一张工程图纸，到处是细细的线和方格，方方正正，非常规整严谨，没有多余装饰。
- **[设计原理]**：采用**瑞士国际主义排版**，把**网格系统显性化**，用**模块化边框（Modular Borders）** 替代投影分层——放弃伪 3D 的 Drop Shadow，回归平面分割，用 1px 细线和 Bento 网格承载高密度数据。
- **[技术实现]**：

```css
.card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-none);       /* 无阴影 */
  padding: 16px 18px;
  transition: border-color 120ms linear; /* 机械硬切 */
}
.card:hover { border-color: var(--color-border-strong); }  /* 边框瞬间变黑 */

/* 背景工程网格（极低对比，营造图纸感）*/
.grid-backdrop {
  background-color: var(--color-bg-page);
  background-image:
    linear-gradient(var(--color-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--color-grid-line) 1px, transparent 1px);
  background-size: 40px 40px;
}
```

### 3-2　色彩系统：功能性单色强调

- **[用户感受]**：几乎全是黑白灰，只有重要按钮/激活项是刺眼的信号橙，一眼锁定重点；数据涨跌另有绿红，不会和橙混。
- **[设计原理]**：**功能性单色强调（Functional Monochromatic Accent）**——以消色差环境为主体，唯一 CTA 色模拟代码编辑器的高亮逻辑。**强调色与数据语义色严格分离**：橙=交互，绿红=涨跌，避免语义污染。
- **[技术实现]**：

```css
.btn-primary {
  background: var(--color-primary); color: var(--color-on-primary);
  border: none; padding: 8px 16px; border-radius: var(--radius-sm);
  font-family: "JetBrains Mono", monospace; font-size: 13px;
  text-transform: uppercase; letter-spacing: var(--mono-tracking);
  transition: background 120ms linear;
}
.btn-primary:hover { background: var(--color-primary-dark); }
/* 次按钮：描边 + hover 黑底反转（机械感）*/
.btn-secondary {
  background: transparent; color: var(--color-text-primary);
  border: 1px solid var(--color-border-strong); padding: 7px 16px; border-radius: var(--radius-sm);
  font-family: "JetBrains Mono", monospace; text-transform: uppercase; letter-spacing: var(--mono-tracking);
  transition: all 120ms linear;
}
.btn-secondary:hover { background: var(--color-text-primary); color: var(--color-bg-card); } /* 颜色反转 */
```

> ⚠️ [P0 对齐] 非灰彩色恰为 3 个（橙强调 + 绿涨 + 红跌），卡在上限内。**禁止**再引入第 4 个彩色。

### 3-3　图标系统：工程制图风

- **[用户感受]**：图标都是细线勾的轮廓，像电路图/说明书上的符号，不花哨。
- **[设计原理]**：**工程制图风格（Technical Drawing）**，统一 1px/1.5px 细线描边、无填充，强调符号学意义而非装饰。
- **[技术实现]**：Lucide / Remix 线性图标，`stroke-width: 1.5`，`w-4 h-4`~`w-5 h-5`，色随文字（currentColor）。**禁止 emoji**（守 P0）。

### 3-4　交互与动效：机械式，无拖泥带水

- **[用户感受]**：鼠标放上去，边框"啪"地变黑，箭头往右挪一格，像敲代码一样干脆，没有任何弹跳或渐隐拖尾。
- **[设计原理]**：**方向性微交互 + 机械式显现**——用位移（而非缩放/透明度渐变）暗示"执行/前进"；进场用短时程强缓动模拟机器启动瞬态。**动效以 linear / 强 ease-out 为主，时长极短**。
- **[技术实现]**：

```css
/* hover 方向性位移 */
.link-arrow:hover .arrow { transform: translateX(3px); transition: transform 120ms linear; }

/* 机械式进场（短促、无回弹）*/
@keyframes console-in { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: translateY(0); } }
.reveal { animation: console-in 300ms cubic-bezier(0.2,0.8,0.2,1) both; }

/* 终端光标闪烁（仅用于终端窗口标题/代码块，克制）*/
@keyframes blink { 50% { opacity: 0; } }
.terminal-cursor { animation: blink 1s step-end infinite; }
```

> [P0 对齐] 禁止 bounce/elastic；时长遵循 100/300 档；闪烁仅限终端组件，不用于数据区。

### 3-5　排版：字号极差 + 功能性留白

- **[用户感受]**：最大的标题/核心数字巨大，标签是小小的灰色等宽字，对比强烈；模块之间留白很宽，不拥挤。
- **[设计原理]**：**字号极差（Scale Contrast）** 制造视觉张力（跳过中间号，直接对比 Display 与 Mono Caption）；**功能性留白**用宽间距分隔认知模块。仍收敛在本 skill 5 级字号体系内。
- **[技术实现]**：

```css
.display     { font-size: clamp(32px, 4vw, 56px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; }
.kpi-value   { font-size: 30px; font-weight: 700; color: var(--color-text-primary); }  /* ≥28px 守 P0 */
.label-tag   { font-size: 11px; }  /* 极小 mono 标签 */
.section-gap { margin-top: 32px; }  /* 宽间距分隔模块 */
```

---

## 四、主题专属组件样式

### KPI 卡片（等宽数字 + mono 标签）

```css
.kpi-card { background: var(--color-bg-card); border: 1px solid var(--color-border);
            border-radius: var(--radius-md); padding: 16px 18px; transition: border-color 120ms linear; }
.kpi-card:hover { border-color: var(--color-border-strong); }
.kpi-label { font-family: "JetBrains Mono", monospace; font-size: 11px; text-transform: uppercase;
             letter-spacing: var(--mono-tracking); color: var(--color-text-secondary); margin-bottom: 8px; }
.kpi-value { font-family: "JetBrains Mono", monospace; font-size: 30px; font-weight: 700;
             color: var(--color-text-primary); font-variant-numeric: tabular-nums; line-height: 1.1; }
.kpi-delta { font-family: "JetBrains Mono", monospace; font-size: 12px; margin-top: 6px; display: flex; gap: 10px; }
.delta.pos { color: var(--color-positive); }   /* 绿 */
.delta.neg { color: var(--color-negative); }   /* 红 */
.delta.neu { color: var(--color-neutral); }
```

### 状态标签 / Chip（终端标签感）

```css
.label-tag.new    { color: var(--color-primary); border: 1px solid var(--color-primary); padding: 1px 6px; border-radius: var(--radius-sm); }
.status-chip      { font-family: "JetBrains Mono", monospace; font-size: 11px; padding: 2px 8px;
                    border-radius: var(--radius-sm); text-transform: uppercase; letter-spacing: var(--mono-tracking); }
.status-chip.ok   { background: rgba(22,163,74,0.10);  color: var(--color-success); }
.status-chip.warn { background: rgba(202,138,4,0.10);  color: var(--color-warning); }
.status-chip.err  { background: rgba(220,38,38,0.10);  color: var(--color-danger); }
```

### 表格（工程表格：细线、等宽数字、hover 硬切）

```css
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { font-family: "JetBrains Mono", monospace; color: var(--color-text-secondary);
                 border-bottom: 1px solid var(--color-border-strong); text-align: left; padding: 9px 12px;
                 font-size: 11px; text-transform: uppercase; letter-spacing: var(--mono-tracking); font-weight: 600; }
.data-table th.num, .data-table td.num { text-align: right; font-family: "JetBrains Mono", monospace; font-variant-numeric: tabular-nums; }
.data-table td { color: var(--color-text-body); border-bottom: 1px solid var(--color-divider); padding: 10px 12px; }
.data-table tr:hover td { background: var(--color-bg-subtle); }
```

### 导航 / Sidebar（工具布局）

```css
.sidebar    { background: var(--color-bg-card); border-right: 1px solid var(--color-border); }
.nav-group  { font-family: "JetBrains Mono", monospace; font-size: 11px; text-transform: uppercase;
              letter-spacing: var(--mono-tracking); color: var(--color-text-secondary); padding: 12px 16px 6px; }
.nav-item   { padding: 8px 16px; color: var(--color-text-body); border-left: 2px solid transparent; cursor: pointer;
              transition: all 120ms linear; }
.nav-item:hover  { background: var(--color-bg-subtle); }
.nav-item.active { background: var(--color-primary-light); color: var(--color-primary); border-left-color: var(--color-primary); }
.topbar { background: var(--color-bg-card); border-bottom: 1px solid var(--color-border); }
```

### Bento 网格 + 终端窗口（工具箱展示）

```css
.bento { display: grid; grid-template-columns: repeat(12, 1fr); gap: 12px; }
.bento .span-4 { grid-column: span 4; } .bento .span-8 { grid-column: span 8; } .bento .span-6 { grid-column: span 6; }
/* 反色终端窗口（用于代码/示意图，"黑盒"技术感）*/
.terminal { background: var(--color-bg-inverse); color: #F4F4F5; border-radius: var(--radius-md);
            font-family: "JetBrains Mono", monospace; font-size: 12px; padding: 14px 16px; }
.terminal-bar { display: flex; gap: 6px; margin-bottom: 10px; }
.terminal-bar i { width: 10px; height: 10px; border-radius: 50%; background: #3F3F46; }
```

---

## 五、ECharts 配色（工程控制台专用）

```css
/* 亮色控制台图表 token（供 buildEChartsBase 桥接）*/
:root {
  --chart-1: #FF4D00;  /* 信号橙（主序列，可与强调色一致）*/
  --chart-2: #2563EB;  /* 工程蓝 */
  --chart-3: #16A34A;  /* 绿 */
  --chart-4: #CA8A04;  /* 琥珀 */
  --chart-5: #7C3AED;  /* 紫 */
  --chart-6: #0891B2;  /* 青 */
  --chart-7: #71717A;  /* 灰 */
  --chart-axis:  #71717A;
  --chart-split: #EFEFF1;
  --chart-label: #52525B;
}
```

```javascript
// 工程控制台图表风格：细线、无光晕、极简网格、mono 轴标签
const THEME_G_ECHARTS = {
  color: ['#FF4D00','#2563EB','#16A34A','#CA8A04','#7C3AED','#0891B2','#71717A'],
  backgroundColor: 'transparent',
  textStyle: { fontFamily: 'JetBrains Mono, SF Mono, monospace', color: '#52525B' },
  grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
  xAxis: { axisLine: { lineStyle: { color: '#111113' } },   // 轴线用近黑，工程感
           axisTick: { show: false }, axisLabel: { color: '#52525B', fontSize: 11 },
           splitLine: { show: false } },
  yAxis: { axisLine: { show: false }, axisTick: { show: false },
           axisLabel: { color: '#52525B', fontSize: 11 },
           splitLine: { lineStyle: { color: '#EFEFF1', type: 'solid' } } },  // 实线细网格
  tooltip: { backgroundColor: '#111113', borderWidth: 0,
             textStyle: { color: '#F4F4F5', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 } }
};
// 折线：直线/细线优先（少用平滑曲线），无面积渐变或极淡
// series: { type:'line', smooth:false, symbol:'none', lineStyle:{ width:1.5 } }
// 柱状：直角或 2px 微圆角 itemStyle:{ borderRadius:[2,2,0,0] }
```

> ⚠️ [P0 对齐] 图表多序列色**刻意区别于数据语义色**（避免与涨绿跌红混淆）；深色终端模式下切换 `--chart-*` 提亮版本。

---

## 六、P0 硬规则对齐检查（主题 G）

| P0 规则 | G 主题落实 |
|---|---|
| 无 emoji | ✅ 全线性图标 |
| 涨绿跌红 | ✅ `--color-positive/negative` 独立于强调橙 |
| 圆角 ≤12px | ✅ 刻意取 2/4/6px 极小值 |
| 非灰彩色 ≤3 | ✅ 橙+绿+红=3，卡上限 |
| glow 全场景禁止 | ✅ G **无 glow**（工程粗野主义无阴影无发光）|
| KPI 数字 ≥28px | ✅ `.kpi-value` 30px |
| ECharts flex:1;min-height:0 | ✅ 沿用通用容器规范 |
| 图表色 ≠ 语义色 | ✅ 图表主色橙/蓝，语义另用绿/红 |
| 禁止 bounce | ✅ 动效 linear / 强 ease-out，时长 100-300ms |

---

## 七、Self-Check（主题 G 专属）

```
[ ] 标签/数字/表头/代码 使用等宽字体（mono 是本主题灵魂，不可缺）
[ ] 卡片用 1px 边框分层，box-shadow 为 none（无阴影）
[ ] hover 是边框硬切变黑 / 颜色反转，不是渐隐或缩放
[ ] 信号橙仅用于 CTA/激活/标记，未用于数据涨跌
[ ] 数据涨跌严格 绿#16A34A / 红#DC2626（深色变体切提亮版）
[ ] 圆角 ≤ 6px（工程锐利感），未出现大圆角
[ ] 非灰彩色总数 = 3（橙+绿+红），无第 4 色
[ ] 背景工程网格透明度 ≤ 0.04，未干扰数据可读性
[ ] 动效时长 ≤ 300ms 且为 linear/强 ease-out，无 bounce
[ ] 终端光标闪烁仅用于终端窗口组件，未用于数据区
[ ] 深色模式通过 data-theme="console-dark" 切换，涨跌/强调色已提亮
```
