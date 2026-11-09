# core/interaction-states.md — 交互状态完整性 + UX 文案规范

> **本文件包含**：① 交互元素的 8 种状态清单（让产物"能用"而非"只能看"）；② UX 文案规范（按钮/错误/空状态）——这是"真人设计感"最容易被 AI 漏掉的一层。
> **加载时机（Tier 3）**：产物含表单 / 按钮 / 可交互组件 / 需要写界面文案时按需加载。
> **与其他文件的分工**：
>   · 缓动曲线 / 时长 / reduced-motion → core/motion-icons.md
>   · focus ring / 对比度 / ARIA → core/accessibility.md
>   · 本文件只管"状态是否设计齐" + "文案是否像人写的"。

---

## 一、八种交互状态（每个可交互元素都要想全）

> **AI 味的典型症状**：只做了 default 和 hover，一旦按下 / 禁用 / 加载 / 出错就"裸奔"。
> 真人设计师会把下面 8 态都想一遍——不是每个都要有，但**必须都想过**。

```
状态           何时出现            视觉处理要点
──────────────────────────────────────────────────────────────
default        静止               基础样式
hover          指针悬停（非触屏）  轻微抬升 / 变色，仅 @media(hover:hover) 生效
focus          键盘 Tab 聚焦       可见 focus ring（用 :focus-visible，见 accessibility）
active         按下瞬间           下压感 transform: scale(0.97)，颜色加深
disabled       不可交互           opacity 降 + cursor:not-allowed + 去掉 hover
loading        处理中             spinner / 骨架屏 + 禁重复提交（见 motion-icons §skeleton）
error          校验失败/操作失败   红边框 + 图标 + 文字说明（不只变红，要给原因）
success        操作成功           绿勾 / toast 确认（低风险操作可用乐观 UI）
──────────────────────────────────────────────────────────────
铁律：hover 和 focus 是两件事——键盘用户永远看不到 hover。别只做一个。
```

### 按钮八态参考实现

```css
.btn {
  transition: background var(--dur-fast) var(--ease-std),
              transform var(--dur-fast) var(--ease-std);
}
.btn:hover              { background: var(--color-primary-dark); }
.btn:focus-visible      { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.btn:active             { transform: scale(0.97); background: var(--color-primary-darker); }
.btn:disabled           { opacity: 0.5; cursor: not-allowed; pointer-events: none; }
.btn.is-loading         { color: transparent; pointer-events: none; position: relative; }
.btn.is-loading::after  { /* 居中 spinner */ content:''; position:absolute; inset:0;
                           margin:auto; width:16px; height:16px;
                           border:2px solid currentColor; border-right-color:transparent;
                           border-radius:50%; animation: spin var(--dur-page) linear infinite; }
```

### 输入框状态（含 error）

```css
input               { border:1px solid var(--color-border); }
input:focus         { border-color: var(--color-primary);
                      box-shadow: 0 0 0 2px var(--color-primary-light); outline:none; }
input:disabled      { background: var(--color-bg-subtle); cursor: not-allowed; }
input.error         { border-color: var(--color-negative); }
input.error:focus   { box-shadow: 0 0 0 2px rgba(240,72,72,0.15); }
/* error 文字：放在字段下方，用 aria-describedby 关联，见 §三 */
```

> **校验时机**：blur 时校验，不要每敲一个键就报红（密码强度提示例外）。
> **加载态**：低风险操作（点赞/收藏）用乐观 UI 立即反馈；支付/删除等必须等真实结果。

---

## 二、状态设计 Self-Check

```
[ ] 每个按钮/链接：hover 与 focus 都有（不是只做一个）
[ ] 主行动按钮：有 active 下压反馈
[ ] 可禁用元素：disabled 态有明显区分 + cursor:not-allowed
[ ] 表单提交/异步操作：有 loading 态且能防重复提交
[ ] 表单字段：有 error 态，且错误信息给出"怎么修"（见 §三）
[ ] 列表/数据区：有 empty 空状态（不是白屏，见 §三）
[ ] 触屏适配：hover 效果包在 @media(hover:hover) 内，不依赖 hover 传递信息
```

---

## 三、UX 文案规范（真人设计感的关键细节）

> 文案是"这是不是 AI 做的"最直接的破绽。以下三类必须遵守。

### 3.1 按钮文案：动词 + 对象，不用"确定/提交"

```
❌ BAD              ✅ GOOD              为什么
────────────────────────────────────────────────
确定 / OK           保存修改             说清会发生什么
提交 / Submit       创建账号             以结果为导向
是 / Yes            删除这条消息         确认的是哪个动作
取消 / Cancel       继续编辑             说清"取消"意味着什么
```

```
破坏性操作要点名"破坏"本身，并带数量：
  ❌ "删除选中"   ✅ "删除 5 个项目"
  "删除"(永久) 与 "移除"(可恢复) 语义要分清，别混用。
```

### 3.2 错误信息：三段式公式

> 每条错误都回答三个问题：**发生了什么 → 为什么 → 怎么修**。核心原则：**不要责怪用户**。

```
场景            模板
──────────────────────────────────────────────────────────
格式错误        "[字段]需为[格式]。例：[示例]"
                 如："手机号需为 11 位数字。例：138 0000 0000"
必填缺失        "请填写[缺什么]"
权限不足        "你没有[某项]的访问权限。[改为怎么做]"
网络错误        "无法连接[某服务]，请检查网络后[重试]"
服务端错误      "系统出了点问题，我们正在排查。[提供替代动作]"
──────────────────────────────────────────────────────────
❌ "你输入的日期无效"（责怪用户）
✅ "请按 年/月/日 格式填写日期"（告诉怎么做）
```

### 3.3 空状态：是引导，不是"暂无数据"

```
空状态三件事：① 简短说明现状 → ② 说清价值 → ③ 给一个明确行动

❌ BAD:  "暂无数据" / "没有内容" / 一片白屏
✅ GOOD: "还没有项目。创建第一个项目即可开始。" + [创建项目] 按钮
✅ GOOD（数据场景）: "当前筛选条件下无数据，试试放宽时间范围。" + [重置筛选]
```

> 数据场景的图表空态见 core/anti-patterns.md 反模式18（empty-state 占位样式）。

### 3.4 术语一致性

```
选一个词，全站统一（别一会"删除"一会"移除"）：
  删除/移除/清除 → 统一"删除"
  设置/偏好/选项 → 统一"设置"
  登录/登陆/进入 → 统一"登录"
  新建/添加/创建 → 统一"创建"
```

### 3.5 加载文案：具体，别只写"加载中"

```
❌ "加载中..."
✅ "正在保存草稿..." / "正在生成报告，通常需要 30 秒"
```

---

## 四、文案 Self-Check

```
[ ] 按钮无"确定/提交/是/否"，均为"动词+对象"
[ ] 破坏性操作按钮点名动作本身（"删除 N 项"）
[ ] 错误信息给出"怎么修"，不责怪用户
[ ] 空状态是引导（含价值说明 + 行动按钮），不是"暂无数据"
[ ] 同一概念全站用同一个词（术语一致）
[ ] 加载文案具体（"正在保存草稿"而非"加载中"）
```
