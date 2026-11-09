# data-components/echarts-config.md — ECharts 标准配置

> 本文件为库内自包含的 ECharts 标准配置，与数据场景完全兼容。  
> **适用场景**：data-report / dashboard  
> **加载时机（Tier 3）**：生成或美化 ECharts 图表时按需加载。

---

## 一、全局 ECharts 默认配置（必须应用）

> **⚠️ 两套颜色体系，用途严格分离：**
>
> | 色系 | 用途 | 配置位置 |
> |------|------|---------|
> | **页面 UI Token**（`--color-xxx`）| 按钮 / 状态 Badge / Delta 涨跌 / 选中行 / 边框 | CSS `:root` 变量 |
> | **图表多系列色**（`CHART_PALETTE`）| ECharts 各系列线/柱/扇形区分 | `color: [...]` 配置 |
>
> 两套体系的颜色**刻意设计为不同**，防止图表颜色与 UI 状态色产生语义混淆  
>（例：图表第2系列若用 `#18A058` 会与正向 delta 的绿色混淆，让用户以为这条线"是好的"）

> **⚠️ P0 · 图表必须与主题联动（v2.1 修复「图表断层」）**
>
> 旧版把配色与底盘色**硬编码**（只手动对齐 A/B/F 三套主题）——换 C/D/E 主题或改主色时，
> 图表不跟手，出现「UI 与图表两张皮」。**新版一律用 `buildEChartsBase()` 桥接器**：
> 通过 `getComputedStyle` 读取主题在 `:root` 暴露的 `--chart-*` 变量，实现 6 套主题全自动联动。
> Canvas 读不到 CSS 变量，所以必须由 JS 读出后喂给 ECharts——这是唯一正确的联动方式。

**Step 1 · 主题在 `:root` 暴露图表 Token（各主题文件提供；缺省走 fallback）**

```css
/* 示例：主题 A 企业亮色。B/F 深色主题给深色底盘 + 更亮的多系列色 */
:root{
  /* —— 图表底盘色（跟随明暗，必须跟主题走）—— */
  --chart-axis-line:   #DFE0E8;   /* 坐标轴线 */
  --chart-axis-label:  #9395A8;   /* 刻度文字 */
  --chart-split-line:  #F0F1F5;   /* 网格分隔线（极淡）*/
  --chart-legend-text: #696B80;   /* 图例文字 */
  --chart-tooltip-bg:  #1A1A2E;   /* tooltip 背景（暗色主题改浅）*/
  --chart-tooltip-fg:  #FFFFFF;   /* tooltip 文字 */
  /* —— 多系列色板（刻意 ≠ 语义色，防止与涨跌色混淆）—— */
  --chart-1:#3B6CF4; --chart-2:#00B09B; --chart-3:#F5A623;
  --chart-4:#9B59B6; --chart-5:#E84848; --chart-6:#00C9D7;
  --chart-7:#8BC34A; --chart-8:#FF6B8A; --chart-9:#9395A8;
}
```

**Step 2 · 桥接器：读变量 → 生成 ECharts 基础配置（所有实例必须用它）**

```javascript
/**
 * 图表配色/底盘一律经此桥接器，从主题 CSS 变量派生 —— 修复「图表与主题断层」。
 * 设计原则不变：
 *  - 多系列色相均匀分布（每两色 Hue ≥ 30°），8 条线同时显示仍可区分；
 *  - 第 0 色 = 品牌主色，建立品牌感；
 *  - 多系列色刻意 ≠ 语义色（涨跌绿红），避免图例与状态色混淆。
 */
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// 多系列色板：优先读主题 --chart-1..9，缺失则回退到内置亮色板（向后兼容）
function getChartPalette() {
  const FALLBACK = ['#3B6CF4','#00B09B','#F5A623','#9B59B6','#E84848','#00C9D7','#8BC34A','#FF6B8A','#9395A8'];
  return FALLBACK.map((f, i) => cssVar(`--chart-${i + 1}`, f));
}

// 生成基础配置。切换主题后重新调用并 setOption 即可（见 §六）。
function buildEChartsBase() {
  return {
    backgroundColor: 'transparent',      // 背景透明，由卡片 CSS 控制
    color: getChartPalette(),            // 图表专用色板（非 UI 语义 Token）
    textStyle: { fontFamily: '"Inter", -apple-system, "PingFang SC", sans-serif' },
    grid: { top: 40, right: 16, bottom: 40, left: 16, containLabel: true },
    xAxis: {
      axisLine:  { lineStyle: { color: cssVar('--chart-axis-line', '#DFE0E8') } },
      axisLabel: { color: cssVar('--chart-axis-label', '#9395A8'), fontSize: 11 },
      axisTick:  { show: false },
      splitLine: { show: false }
    },
    yAxis: {
      axisLine:  { show: false },
      axisTick:  { show: false },
      axisLabel: { color: cssVar('--chart-axis-label', '#9395A8'), fontSize: 11 },
      splitLine: { lineStyle: { color: cssVar('--chart-split-line', '#F0F1F5'), type: 'dashed' } }
    },
    tooltip: {
      backgroundColor: cssVar('--chart-tooltip-bg', '#1A1A2E'),
      borderWidth: 0,
      textStyle: { color: cssVar('--chart-tooltip-fg', '#FFFFFF'), fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.18); border-radius: 6px; padding: 8px 12px;'
    },
    legend: {
      textStyle: { color: cssVar('--chart-legend-text', '#696B80'), fontSize: 11 },
      icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 16, top: 'top'
    },
  };
}

// 用法：const chart = echarts.init(el);
//       chart.setOption({ ...buildEChartsBase(), series: [...] });
const ECHARTS_DEFAULTS = buildEChartsBase();  // 兼容旧引用名
```

### 例外：语义强制场景（只有这 3 种情况允许直接指定颜色）

```javascript
// 1. 只有一个系列，且该系列有明确正/负语义时
//    例：折线图只显示"目标达成率"，用品牌蓝即可
series: [{ color: '#3B6CF4', ... }]

// 2. 瀑布图 / 偏差图 — 必须区分正负
const WATERFALL_COLORS = {
  positive: '#18A058',  // 此处用语义色，因为颜色=数值方向
  negative: '#F04848',
  total:    '#3B6CF4',
};

// 3. 达成率仪表盘 / 进度条 — 配色跟随达成状态
function getProgressColor(rate) {
  if (rate >= 1.0) return '#18A058';   // 超额 → 绿
  if (rate >= 0.8) return '#3B6CF4';   // 达标 → 蓝
  if (rate >= 0.6) return '#F5A623';   // 接近 → 橙
  return '#F04848';                    // 预警 → 红
}
```

---

## 二、图表类型配置模板

### 折线图（Line Chart）

```javascript
function getLineOption({ title, xData, series, colors }) {
  return {
    ...ECHARTS_DEFAULTS,
    title: {
      text: title,
      textStyle: { fontSize: 13, fontWeight: 600, color: '#374151' },
      top: 0, left: 0
    },
    grid: { top: 48, right: 16, bottom: 40, left: 16, containLabel: true },
    xAxis: {
      ...ECHARTS_DEFAULTS.xAxis,
      type: 'category',
      data: xData,
      boundaryGap: false
    },
    yAxis: { ...ECHARTS_DEFAULTS.yAxis, type: 'value' },
    series: series.map((s, i) => ({
      name: s.name,
      type: 'line',
      data: s.data,
      smooth: true,
      lineStyle: { width: 2, color: colors ? colors[i] : undefined },
      itemStyle: { color: colors ? colors[i] : undefined },
      // 面积填充（可选，alpha ≤ 0.12）
      areaStyle: s.showArea ? {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: `${colors ? colors[i] : '#3B7FF5'}1F` },  // opacity ~0.12
            { offset: 1, color: `${colors ? colors[i] : '#3B7FF5'}00` }
          ]
        }
      } : undefined
    }))
  };
}
```

### 柱状图（Bar Chart）

```javascript
function getBarOption({ title, xData, series, horizontal = false }) {
  return {
    ...ECHARTS_DEFAULTS,
    title: {
      text: title,
      textStyle: { fontSize: 13, fontWeight: 600, color: '#374151' },
      top: 0, left: 0
    },
    grid: { top: 48, right: 16, bottom: 40, left: horizontal ? 80 : 16, containLabel: true },
    xAxis: horizontal ? { ...ECHARTS_DEFAULTS.yAxis, type: 'value' }
                      : { ...ECHARTS_DEFAULTS.xAxis, type: 'category', data: xData },
    yAxis: horizontal ? { ...ECHARTS_DEFAULTS.xAxis, type: 'category', data: xData }
                      : { ...ECHARTS_DEFAULTS.yAxis, type: 'value' },
    series: series.map(s => ({
      name: s.name,
      type: 'bar',
      data: s.data,
      barMaxWidth: 40,
      barMinHeight: 2,
      itemStyle: { borderRadius: [3, 3, 0, 0] },  // 顶部圆角
      label: { show: false }  // 默认不显示柱顶 label（太乱）
    }))
  };
}
```

### 环形图（Donut Chart）

```javascript
function getDonutOption({ title, data, innerText }) {
  return {
    ...ECHARTS_DEFAULTS,
    title: {
      text: title,
      textStyle: { fontSize: 13, fontWeight: 600, color: '#374151' },
      top: 0, left: 'center'
    },
    legend: { ...ECHARTS_DEFAULTS.legend, orient: 'vertical', left: 0, top: 'middle' },
    series: [{
      type: 'pie',
      radius: ['45%', '70%'],  // 环形
      center: ['60%', '55%'],
      data: data,  // [{ name: 'A', value: 40 }, ...]
      label: { show: false },
      labelLine: { show: false },
      emphasis: { label: { show: false } },
      // 中间文字（innerText 可选）
    }],
    // 中间文字用 graphic 实现
    graphic: innerText ? [{
      type: 'text', left: '57%', top: '48%',
      style: {
        text: innerText.value, textAlign: 'center',
        fill: '#111827', fontSize: 22, fontWeight: 700,
        fontFamily: '"Inter", sans-serif'
      }
    }, {
      type: 'text', left: '57%', top: '57%',
      style: {
        text: innerText.label, textAlign: 'center',
        fill: '#9CA3AF', fontSize: 11,
        fontFamily: '"Inter", sans-serif'
      }
    }] : []
  };
}
```

---

## 三、特殊元素规范

### markPoint（最高/最低点标注）

```javascript
// 含 markPoint 时：grid.top 必须 ≥ 48px
// 含 2 行标题时：grid.top 必须 ≥ 56px
markPoint: {
  symbol: 'circle',
  symbolSize: 6,
  data: [
    { type: 'max', name: '最高' },
    { type: 'min', name: '最低' }
  ],
  label: {
    fontSize: 10,       // ← 不超过 10px
    offset: [0, -12]
  }
}
```

### tooltip 格式化函数

```javascript
// 带单位的 tooltip formatter
const tooltipFormatter = (params, unit = '') => {
  if (!Array.isArray(params)) params = [params];
  let result = `<div style="font-size:12px;color:#374151">${params[0].axisValue || params[0].name}</div>`;
  params.forEach(p => {
    result += `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
      <span style="display:block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>
      <span style="color:#6B7280">${p.seriesName}:</span>
      <span style="font-weight:600;color:#111827;font-variant-numeric:tabular-nums">${p.value}${unit}</span>
    </div>`;
  });
  return result;
};
```

---

## 四、字号强制规则

```
axisLabel：   fontSize: 11, color: '#9CA3AF'
legend：      fontSize: 11, color: '#6B7280'
tooltip：     fontSize: 12
图表标题：    fontSize: 13, fontWeight: 600
bar label：   fontSize: 10-11（悬浮显示时 12px）
markPoint：   fontSize: 10（最小）

[P0] 图表内最小字号 ≥ 10px
[P0] 图表内标签字号 ≤ 14px（否则遮盖数据）
```

---

## 五、ECharts 容器布局（P0 强制）

```html
<!-- ✅ 正确：ECharts 容器用 flex:1 撑满父卡片 -->
<div class="chart-card">
  <div class="chart-title">结论句标题</div>
  <div id="chart-main" class="chart-container"></div>
</div>

<style>
.chart-card {
  display: flex; flex-direction: column;
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 6px; padding: 20px 24px;
}
.chart-title { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 16px; }
.chart-container {
  flex: 1;
  min-height: 0;       /* ← 必须，flex 子元素否则撑不开 */
  min-height: 260px;   /* ← 最低兜底 */
}
</style>
```

```
❌ 禁止：.chart-container { height: 300px; }（固定高度）
✅ 正确：.chart-container { flex: 1; min-height: 0; min-height: 260px; }
```

---

## 六、深色主题 ECharts 覆盖

> **v2.1 起：深色主题无需再写 JS 覆盖对象。** 桥接器 `buildEChartsBase()` 会自动读取
> 当前 `:root` 的 `--chart-*` 变量——深色主题（B / F）只要在自己的 CSS 里**重定义这些变量**，
> 图表底盘与配色即自动切换，业务代码一行不改。

**深色主题在 `:root`（或 `[data-theme="dark"]`）重定义即可：**

```css
/* 主题 B (dark-pro) / F (mono-noir) 提供的图表 Token */
:root[data-theme="dark"]{
  /* 底盘：深色更暗、文字更亮 */
  --chart-axis-line:   #1E3A5F;
  --chart-axis-label:  #4A6080;
  --chart-split-line:  #0D2040;
  --chart-legend-text: #8BA3C7;
  --chart-tooltip-bg:  #0D1830;
  --chart-tooltip-fg:  #E2EAF8;
  /* 多系列：深色下更亮更鲜艳（与亮色刻意区分）*/
  --chart-1:#4F8EF7; --chart-2:#2ECDA4; --chart-3:#F5B832;
  --chart-4:#B97BFF; --chart-5:#FF6B6B; --chart-6:#22D4E5;
  --chart-7:#A8D95A; --chart-8:#FF8FB0; --chart-9:#778CA8;
}
```

> **切换主题后刷新图表**：主题切换是改 CSS 变量，已渲染的 Canvas 不会自动重绘，需重新 setOption：
> ```javascript
> function refreshAllCharts() {
>   document.querySelectorAll('[_echarts_instance_]').forEach(el => {
>     const c = echarts.getInstanceByDom(el);
>     if (c) c.setOption(buildEChartsBase());  // 重新注入底盘+配色，series 保留
>   });
> }
> // 切主题时调用：document.documentElement.dataset.theme='dark'; refreshAllCharts();
> ```

> ⚠️ **向后兼容**：旧代码里的 `ECHARTS_DARK_OVERRIDES` / `CHART_PALETTE_DARK` 可继续用，
> 但新生成一律走 `buildEChartsBase()` + `--chart-*` 变量，不再手写深色覆盖对象。
