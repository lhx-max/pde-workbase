# `website-design` 集成编排

本文件负责把`website-design` 设计规范模块接入 Website Builder 工程流程。设计内核位于 `references/website-design/`，它是 Website Builder 内的集成副本；工程适配与冲突裁决不得回写源 Skill，所有适配与冲突裁决均以本文件为准。

## 1. 何时必须进入设计路由

只要任务会修改任一用户可见内容，就属于视觉任务，必须在编写或修改视觉代码前执行本流程，包括：

- DOM、JSX、Vue template 或组件结构；
- CSS、Tailwind class、CSS Variables、字体、颜色、间距、圆角、阴影；
- 图标、图片呈现、动效、响应式、溢出与可访问性视觉表现；
- 图表外观、交互状态、空状态、错误状态；
- 新建页面、美化页面、在已有页面新增组件或可见功能。

混合任务只要包含任何视觉子任务，就必须在该子任务编码前执行设计路由。只有能够明确证明任务对用户界面无任何可见影响时，才可以跳过。

## 2. 强制加载顺序

1. 读取 `references/website-design/website-design.md`，识别执行模式、唯一主场景和主题。
2. 实际读取一个 `references/website-design/scenes/*.md`；只读主入口不算完成。
3. 实际读取一个 `references/website-design/themes/*.md`；只声明主题名不算完成。
4. 根据需求按需读取 `core/` 与 `data-components/` 文件。
5. 按下一节生成可核查的设计记录。
6. 记录完整后才能修改 JSX、HTML、CSS、Tailwind 或 UI 组件代码。

无法判断场景或视觉方向时先向用户澄清，不得回退到通用模板。

## 3. 编码前设计记录

视觉任务必须先记录以下内容；缺少任一适用字段时，不得进入视觉编码：

```text
Mode: <A | B | C | C-in-Existing | A-Structural>
Scene: <唯一场景> — references/website-design/scenes/<scene>.md
Scene Rules Applied:
- <来自场景文件的具体规则 1>
- <来自场景文件的具体规则 2>
Theme: <主题> — references/website-design/themes/<theme>.md
Theme Tokens Applied:
- <源 Token/值 → CSS Variable、Tailwind theme 或组件落点>
Purpose: <页面目的和目标用户>
Tone: <明确的视觉语气>
Differentiation: <用户能记住的设计特征>
Loaded Files:
- <实际读取的每个文件>
Self-Checks Required:
- <通用、场景、主题与专项检查来源>
```

`Scene Rules Applied` 必须提取实际场景规则，`Theme Tokens Applied` 必须说明 Token 的代码落点，不能只列文件路径。

### 主题混合

使用主题混合时，必须读取 base 主题、每个 toward 主题以及 `core/theme-blending.md`，并追加：

```text
Blend Recipe: <base + toward + K1..K5 axes>
Interpolated Tokens:
- <Token: base → result → toward>
Clamp Verification:
- <每个旋钮均在允许量程内，且未突破 P0>
```

不得凭印象混合主题，也不得只读取 base 主题。

## 4. 执行模式与结构边界

### Mode C：从零生成

用于新页面。按场景叙事骨架生成结构，按主题 Token 生成视觉体系，并保留 Website Builder 的技术、安全和数据约束。

### Mode A：已有页面纯视觉优化

保持既有结构、脚本、交互逻辑和业务行为；场景骨架仅作诊断参考。通过 CSS Variables、Tailwind Token 或精准样式覆盖完成视觉收敛。

### Mode C-in-Existing：已有页面新增可见内容

仅在用户要求的新增范围内创建必要结构；既有区域继续按 Mode A 保护。设计记录必须追加：

```text
New Structure Scope: <允许新增的组件/区块>
Protected Existing Scope: <不得重写的既有区域与逻辑>
```

### Mode A-Structural：明确要求重构已有布局

仅在用户明确要求信息架构或布局重构时使用。编码前记录允许修改和禁止修改的区域，不能把结构重写伪装成普通美化。

## 5. Token 落地

- 优先复用项目已有样式体系，不为迁移设计规范而强制更换技术栈。
- 有全局 CSS Variables 时，将主题 Token 映射到变量；使用 Tailwind 时映射到 theme/token 或稳定 utility 组合。
- 业务计算型 inline style 保留；纯视觉值可在不改变逻辑时调整。
- 用户提供品牌色时按 `core/brand-token-derivation.md` 推导，不用品牌色替代 success/danger 等语义色。
- Token 的来源、最终值和代码落点必须写入 `Theme Tokens Applied`。

## 6. 图表冲突裁决

不得修改图表数据、业务配置或交互逻辑。只有能够安全隔离时才可追加纯视觉主题配置；无法证明仅影响视觉时保持原配置。

图表 Token 按以下优先级确定：

1. 所选主题文件明确提供的 `--chart-*` Token；
2. `data-components/echarts-config.md` 中对应主题配置；
3. 若主题没有完整图表 Token，则由主题的 primary、文本色、边框色、表面色和语义色派生 `Chart Token Map`：
   - 第一序列使用 primary；
   - 坐标轴与图例使用次级文本色；
   - 网格线使用边框色；
   - tooltip 使用表面色；
   - 正负语义严格使用 success/danger；
   - 多序列色按 `core/brand-token-derivation.md` 的 OKLCH 均匀推导法生成，并满足对比度和非灰色数量限制。

禁止引用镜像示例中不存在于项目的 `NEON_PALETTE` 或 `ECHARTS_DARK_NEON`。设计记录必须追加：

```text
Chart Tokens Applied:
- <来源 Token → 最终值 → 图表配置落点>
```

## 7. 可执行 Self-Check

源设计入口提到场景和主题 Self-Check，但部分文件没有同名章节。集成时按实际规则生成检查清单：

1. **通用检查：** 执行 `website-design/website-design.md` 的 P0 Hard Rules 与通用 Self-Check。
2. **Scene Checks：** 从所读场景文件提取包含“必须、禁止、不得、应、建议、断点、尺寸、布局、结构”的规则，至少覆盖页面骨架、关键组件、响应式和数据/内容呈现。
3. **Theme Checks：** 从所读主题文件提取 Token 表、字体、色彩、圆角、阴影、组件和动效约束。
4. **专项检查：** 从实际读取的 core/data-components 文件提取硬约束。
5. 若文件存在明确 Self-Check 章节，优先逐项使用，再用上述提取规则补足。

每条检查必须记录：

```text
- Source: <文件与规则摘要>
  Result: <pass/fail>
  Fix: <失败时的修复动作；通过时写 none>
  Recheck: <pass/fail>
```

任一 P0 或必要检查未通过，不得声明视觉任务完成。

## 8. 实现后的验证顺序

1. 通用 P0 与 Self-Check；
2. Scene Checks；
3. Theme Checks；
4. core/data-components 专项检查；
5. 使用 `myflicker-browser` 做真实渲染验证：布局、文本/图例溢出、响应式、交互状态、console 和 network；
6. Website Builder 原有构建、自动化测试、部署、白屏回归、README/AGENTS 与 CHANGELOG 流程。

可视页面不得只以构建成功作为完成标准。

## 9. 优先级

发生冲突时按以下顺序裁决：

1. 用户明确需求与业务正确性；
2. Website Builder 的安全、快手 SSO、依赖、数据和部署硬约束；
3. 本集成编排中的模式与冲突裁决；
4. `website-design` 的 P0、场景、主题和专项规则；
5. 实现便利性。

集成副本中对 `frontend-design`、`drawio-diagram` 或图表美化能力的文字仅用于说明能力边界，不构成 Website Builder 的运行时依赖。
