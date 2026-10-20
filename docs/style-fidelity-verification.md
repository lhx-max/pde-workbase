# 样式还原专项复验

## 范围与结论

用户指出草图顶部标签及右上操作区样式疑似未完整还原。本轮以原代码 `319e5eee556a3641d2ee68a6111a36ddc7a1eff7` 为参照，重新检查 CSS 入口、祖先选择器、默认外观初始化及实际渲染几何；此前的中文化和功能测试不能替代样式完整性验证。

本轮只修改独立项目，不引回聊天、账号、团队或原运行平台。外部扩展完整原生复验继续按用户决定暂缓，没有触发授权。

## 已证实并修复的遗漏

| 问题 | 修复前实际表现 | 还原依据与修复 |
|---|---|---|
| 顶栏丢失宿主标记 | 原生页面实测 padding 为 `0px 10px`、tab gap 为 `0px`，出现底部分隔边线 | 给独立根恢复原有 `data-project-chrome` 条件，使保留的规则重新命中；恢复 `6px 14px`、`6px` gap、原选中/分隔线样式 |
| 单工作区外壳材质丢失 | 工作区贴边，没有原单窗格的 8px 留白 | 窄适配原 `.app .workspace` 与 focus 模式的边距、圆角和 `.ws-body` 材质；不添加会引入整套平台 grid 的 `.app` |
| 默认外观初始化丢失 | 未设置 `data-theme`；深色系统偏好使宿主变暗，但草图引擎仍为 light；默认 accent 也未应用原启动覆盖值 | 首屏 HTML 固定 light，恢复原默认 `#353535` 及其派生颜色，不恢复账号配置系统 |
| 通用导出弹窗基础 CSS 漏载 | 实测遮罩 `position:static`、`display:block`、透明；弹窗落在页面底部，遮罩 y=960、高度仅257 | 从原混合文件机械提取 modal 定位、遮罩、容器和头尾布局，并保持原入口的相对顺序 |
| 共享折叠与 QuestionForm CSS 漏载 | 真实入口展开的红测证明折叠、隐藏选择器及表单规则均缺失 | 机械提取完整共享 accordion / QuestionForm 闭包，包括动画和 reduced-motion；不恢复 Composio、todo 或已移除的 Questions 面板 |

修复代码：[独立外壳](<../apps/web/src/styles/workspace/standalone-shell.css>)、[通用弹窗](<../apps/web/src/styles/workspace/shared-modal.css>)、[表单与折叠](<../apps/web/src/styles/workspace/question-form.css>)、[入口](<../apps/web/src/index.css>)、[挂载标记](<../apps/web/src/App.tsx>)、[首屏主题](<../apps/web/app/layout.tsx>)。

新提取的两组 CSS 已与冻结原文件选定范围逐字节比对，除来源说明外完全一致。其余五个移除的入口（聊天、连接器、插件详情、插件栏及聊天皮肤）未找到“独立可达消费者 + 缺失规则”的新增证据，因此不整包恢复。

## 未擅自改动的原设计

- 原标签最大宽度就是 **110px**，标题最大宽度为 **96px**；加号原本紧跟标签。不凭观感扩大标签或移动加号。
- 导出／帮助原本在 header，缩放／撤销原本在画布内浮动工具条，不合并成一排。
- 中央绘图工具条原本 **40px** 高，右侧视图工具条原本 **32px** 高、**9px** 圆角、距画布上／右边 **8px**；窄于 900px 的草图容器原本会下移中央工具条。
- 空白草图的导出、撤销禁用是原行为；回归测试还会插入线框模板并验证它们可用。

以上草图组件及其局部／全局 CSS 与冻结代码一致；本轮真实几何测试并未把这两套工具条本来不同的造型误报为缺 CSS。

## 验证与证据

- [真实 Electron 草图回归](<../e2e/ui/workspace-native-style.test.ts>)：系统浅／深色偏好、1440／840 两种宽度，验证顶部契约、边距、工具条尺寸／位置／不重叠及禁用状态切换。
- [真实 HTML 导出弹窗回归](<../e2e/ui/workspace-style.test.ts>)：经原界面的“更多 → 导出 → 导出为图片”打开，验证全屏遮罩、居中、取消和返回预览，不触发系统保存或授权。
- [共享 CSS 闭包回归](<../apps/web/tests/shared-style-closure.test.ts>)：展开实际入口检查生效规则，不以“文件存在”代替“被加载”。表单恢复另通过现有 QuestionForm 组件测试；本轮不声称已运行外接工作流执行器的端到端任务。

最终结果：Guard、全仓 TypeScript 检查通过；Web **42 个测试文件、327 项通过**，生产构建通过。完整 UI **13 个普通场景各跑两轮，26 次通过、0 失败**（Web 18、Electron 8）；外部扩展人工复验两轮各跳过 1 项，共 **2 skipped**，不计入通过。

| 对照场景 | 修复前 | 修复后 |
|---|---|---|
| 草图／顶栏，系统浅色 | [原图](<../e2e/evidence/style-fidelity/before-sketch-light-1440.png>) | [原图](<../e2e/evidence/style-fidelity/after-sketch-light-1440.png>) |
| 系统深色偏好下的颜色错配 | [原图](<../e2e/evidence/style-fidelity/before-sketch-dark-1440.png>) | [原图](<../e2e/evidence/style-fidelity/after-sketch-dark-1440.png>) |
| HTML 导出弹窗 | [原图](<../e2e/evidence/style-fidelity/before-image-export.png>) | [原图](<../e2e/evidence/style-fidelity/after-image-export.png>) |
| 840px 窄窗口工具条布局 | — | [浅色偏好](<../e2e/evidence/style-fidelity/after-sketch-light-840.png>) · [深色偏好](<../e2e/evidence/style-fidelity/after-sketch-dark-840.png>) |

8 张截图已检查文件头，均为 PNG；保留原始字节，不编辑像素或重编码。校验见 [SHA256](<../e2e/evidence/style-fidelity/SHA256SUMS>)，来源和统计见 [清单](<../e2e/evidence/style-fidelity/verification-summary.json>)。

### 红测记录

共享 CSS 三条用例先全部失败；Electron 实测复现缺失祖先和主题，HTML 导出弹窗实测复现普通文档流。最初一次原生测试的相对 URL 写法不能用于 CDP page，已改为运行实例的绝对 URL；这是测试准备问题，不算产品回归。随后一次原生截图在切换宽度后超时，保留该失败批次，并在截图前显式将被测原生页面置前；没有放宽样式断言。

首次完整 UI 批次为 24 通过、2 失败、2 人工跳过：新增草图用例只等待按钮启用，就让下一条用例离开仍在保存的草图，触发了真实的离页保护。已补上保存 HTTP 成功和“已保存”状态的完成信号，未自动同意离页丢失数据，也未改产品的保护行为；该失败批次保留，不混入最终通过统计。

本轮截图是独立项目修复前后对照，不冒充原完整平台的运行截图；原版参照来自冻结源码及对应样式契约。

更新后的桌面预览已用原用户数据重新启动，Web 地址为 <http://127.0.0.1:17673>；HTTP 返回 200，原用户草图的 SHA256 在重启前后完全一致。没有重置项目、重新播种用户数据或停止占用默认端口的其他实例。
