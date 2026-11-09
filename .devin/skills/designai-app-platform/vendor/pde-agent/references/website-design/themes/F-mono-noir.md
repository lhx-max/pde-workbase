# themes/F-mono-noir.md — 极简黑主题（Mono Noir）

> **适用场景**：Landing Page / 内容站 / 工具应用（暗黑极简版）；数据场景慎用（图表语义色在纯黑上需谨慎调校）
> **视觉气质**：黑作主色，极简克制，高级冷淡，MiniMax 感 —— 大留白 + 一个极小面积的点缀色提气
> **用户印象**："高级"、"性冷淡"、"很干净的黑"、"不像 AI 做的"
> **字体组合**：Inter / Geist（推荐）+ PingFang SC 中文补字
> **核心信条**：黑不是"深色"，黑是一种"立场"。靠留白和层级说话，不靠装饰。

---

## 与主题 B 的区别（别混）

```
B 深色专业：暗夜蓝底盘（#0F172A），多彩系列，仪器/大屏质感，信息密度高
F 极简黑：  近黑底盘（#0A0A0A），近乎单色，大留白，克制点缀，气质优先于密度
```

---

## CSS Token 变量（复制至 :root）

```css
:root {
  /* 主色：黑本身就是主色，点缀色仅极小面积使用 */
  --color-primary:       #FAFAFA;   /* 反相：浅色作为"主操作"前景（黑底上的白按钮）*/
  --color-accent:        #E8E8E8;   /* 极小面积点缀（可按需替换为品牌色）*/
  --color-primary-dark:  #D4D4D4;

  /* 语义色（纯黑底上仍需可读，适度提亮）*/
  --color-success:  #4ADE80;
  --color-danger:   #F87171;
  --color-warning:  #FBBF24;

  --color-positive: #4ADE80;
  --color-negative: #F87171;
  --color-neutral:  #A1A1AA;

  /* 背景层级（黑）*/
  --color-bg-page:   #0A0A0A;   /* 最深底色：近黑 */
  --color-bg-card:   #141414;   /* 卡片背景：略提亮的黑 */
  --color-bg-subtle: #1C1C1C;   /* 次级区块 */
  --color-bg-hover:  #242424;   /* hover 状态 */

  /* 文字层级 */
  --color-text-primary:   #FAFAFA;  /* 主要文字：近白 */
  --color-text-body:      #D4D4D4;  /* 正文：浅灰 */
  --color-text-secondary: #8A8A8A;  /* 辅助说明：中灰 */
  --color-text-disabled:  #4A4A4A;  /* 禁用 */

  /* 边框与分隔（黑底上极淡）*/
  --color-border:  #262626;
  --color-divider: #1A1A1A;

  /* 阴影（黑底上阴影几乎不可见，靠边框和背景层级区分）*/
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.6);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.7);
  --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.8);
}
```

> ⚠️ **无 glow**：极简黑靠留白和对比说话，全场景禁止彩色发光（遵守 SKILL P0）。
> ⚠️ **点缀色替换**：用户给了品牌色时，把 `--color-accent` 换成品牌色，仅用于极小面积（链接、active 指示线、单个强调数字），不得铺满卡片或 Hero。

---

## 字体配置

```css
body {
  font-family: "Inter", "Geist", -apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif;
  background: var(--color-bg-page);
  color: var(--color-text-body);
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.01em;   /* 极简黑常用轻微收紧字距，增强精致感 */
}
```

---

## 主题专属组件样式

### 卡片（靠边框和背景层级区分，不靠阴影）

```css
.card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 22px 26px;
}
.card:hover { border-color: #383838; }
```

### 按钮（黑底 → 主操作用白，次要用描边）

```css
.btn-primary {
  background: #FAFAFA; color: #0A0A0A; border: none;
  padding: 9px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;
}
.btn-primary:hover { background: #D4D4D4; }
.btn-secondary {
  background: transparent; color: var(--color-text-body);
  border: 1px solid var(--color-border);
  padding: 8px 20px; border-radius: 8px;
}
.btn-secondary:hover { background: var(--color-bg-subtle); border-color: #383838; }
.btn-ghost {
  background: transparent; color: var(--color-text-secondary); border: none;
}
.btn-ghost:hover { color: var(--color-text-primary); }
```

### 数字高亮

```css
.kpi-value { color: #FAFAFA; font-size: 32px; font-weight: 700;
             font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.delta.pos { color: var(--color-positive); }
.delta.neg { color: var(--color-negative); }
.delta.neu { color: var(--color-neutral); }
```

### 导航与 Sidebar

```css
.sidebar         { background: #0A0A0A; border-right: 1px solid #1A1A1A; }
.nav-item        { color: #8A8A8A; }
.nav-item:hover  { background: #141414; color: #D4D4D4; }
.nav-item.active { background: #1C1C1C; color: #FAFAFA; }

.topbar { background: #0A0A0A; border-bottom: 1px solid #1A1A1A; }
```

### 表格

```css
.data-table th { color: #6A6A6A; border-bottom-color: #262626; }
.data-table td { color: #D4D4D4; border-bottom-color: #1A1A1A; }
.data-table tr:hover td { background: #141414; }
```

### 链接 / active 指示（点缀色唯一登场处）

```css
a { color: var(--color-text-primary); text-decoration: none; border-bottom: 1px solid #383838; }
a:hover { border-bottom-color: #FAFAFA; }
.tab-indicator { background: var(--color-accent); height: 2px; }  /* 品牌色可注入此处 */
```

---

## ECharts 配色（极简黑专用）

```javascript
// 极简黑：以灰阶为主，单一点缀色，避免彩虹色破坏克制感
const THEME_F_PALETTE = [
  '#FAFAFA',  // 主系列：近白
  '#8A8A8A',  // 中灰
  '#4ADE80',  // 仅在需要区分正向时
  '#F87171',  // 仅在需要区分负向时
  '#5A5A5A',  // 深灰
  '#BDBDBD',  // 浅灰
];

const echartsMonoNoirBg = {
  backgroundColor: 'transparent',
  textStyle: { color: '#8A8A8A' },
  title: { textStyle: { color: '#FAFAFA' } },
  legend: { textStyle: { color: '#8A8A8A' } },
  xAxis: { axisLine: { lineStyle: { color: '#262626' } },
           axisLabel: { color: '#6A6A6A' },
           splitLine: { lineStyle: { color: '#1A1A1A' } } },
  yAxis: { axisLine: { lineStyle: { color: '#262626' } },
           axisLabel: { color: '#6A6A6A' },
           splitLine: { lineStyle: { color: '#1A1A1A', type: 'dashed' } } },
  tooltip: { backgroundColor: '#141414', borderColor: '#262626',
             textStyle: { color: '#FAFAFA' } }
};
```

> 极简黑做数据图表时，**优先用灰阶 + 单一点缀色**区分系列，而不是堆多彩系列——多彩会立刻破坏"高级黑"的气质。多分类不可避免时，改用主题 A / B。

---

## Self-Check 补充项（主题 F 专属）

```
[ ] body background 是 #0A0A0A（近黑，不是纯黑 #000000，纯黑显廉价）
[ ] 卡片背景是 #141414（靠背景层级 + 边框区分，不靠阴影）
[ ] 正文文字 #D4D4D4（不是纯白 #FFFFFF，避免刺眼）
[ ] 无任何彩色发光 / glow / 彩色 box-shadow
[ ] 点缀色（accent）面积极小：仅链接 / active 指示 / 单个强调，未铺满卡片或 Hero
[ ] 主操作按钮用浅色前景（白底黑字），不用彩色大按钮
[ ] 图表以灰阶为主，多彩系列 ≤ 2 种点缀（否则换 A/B 主题）
[ ] 大留白：区块间距比亮色主题更宽松，靠留白建立高级感
[ ] 字距轻微收紧（letter-spacing: -0.01em ~ -0.02em）
```

---

## 图表 Token（供 echarts-config 桥接器读取）

> F 极简黑：近黑底盘、灰阶为主 + 极少点缀。
```css
:root{
  --chart-axis-line:#262626; --chart-axis-label:#6A6A6A; --chart-split-line:#1A1A1A;
  --chart-legend-text:#8A8A8A; --chart-tooltip-bg:#141414; --chart-tooltip-fg:#FAFAFA;
  --chart-1:#FAFAFA; --chart-2:#8A8A8A; --chart-3:#4ADE80; --chart-4:#F87171; --chart-5:#5A5A5A;
  --chart-6:#BDBDBD; --chart-7:#3A3A3A; --chart-8:#4ADE80; --chart-9:#A1A1AA;
}
```
