# 运行验证与交付证据

本记录按阶段保留独立仓库的样式、中文化与三入口恢复证据。原代码基线为 `319e5eee556a3641d2ee68a6111a36ddc7a1eff7`，中文化基于恢复提交 `6e2d96ae36afc74bb9d249461190bc377c737311`。功能范围见 [功能对照](<feature-parity.md>)；最新样式修复以以下专项记录为准。

## 双入口并发、复制与持久恢复（2026-10-21，本轮验收中）

Node 24.19.0 / pnpm 10.33.2。本轮实现正文 hash 版本与有界三方合并、冲突双方保留、画布 commit 前持久 intent、文档持久 mirror queue、版本化显式解决、独立复制和条件解绑。规范见 [正文同步增补合同](<../.devin/skills/canvas-app-platform/docs/document-sync-contract.zh-CN.md>)，产品归属和限制见 [关系及状态报告](<canvas-doc-relationship-and-status.zh-CN.md>)。

截至本轮最近检查：

| 范围 | 实际结果 |
| --- | --- |
| Canvas server | 313 通过，1 Appwrite 真环境测试跳过；source/tests typecheck、build通过 |
| Canvas Web | 407 通过；typecheck通过 |
| Canvas workbench | 232 通过；source/tests typecheck、声明build通过 |
| Doc server | 65 通过；typecheck、build通过 |
| Doc surface / 独立Web | 两者typecheck通过；Web production build通过 |
| 宿主 Next | 独立构建目录生产build通过；不是原有运行服务已更新 |
| 真实双服务 HTTP | 下述8组通过，所有临时进程和数据已清理 |
| 真实浏览器 | **未全过**：双入口和冲突主链7组通过；复制卡后立即输入仍显示了新稿但没有保存，正在定位。不可用等待后编辑的通过代替此失败；末尾统一刷新验收尚未完成 |

运行 [真实双进程检查](<../e2e/canvas-doc-runtime.ts>)：

```sh
node --import tsx e2e/canvas-doc-runtime.ts run /absolute/canvas-workspace /absolute/designai-app-doc
```

8组内容：出生绑定与mirror确认；独立文字变化三方合并；同范围409保留双方及校验双方版本的解决；Doc离线连写并重启恢复；Canvas投递失败后重启恢复；UI式复制请求立即分离文件/Doc身份；独立doc.copy去绑定及独立生命周期；显式archive/restore及迟到解绑不能归档新绑定。均使用真实两个服务进程、临时根、随机端口和合成正文；日志中的503/409是注入离线/冲突的预期结果。**这不等于已通过真实UI复制后立即输入**。

浏览器验收明确揭示并修复了页签appTabs被丢弃、旧文字通知重放回滚、服务端允许迟到PATCH重新别名等问题。客户端receipt发布/路径重整回归已增加，但实际浏览器仍有立即输入未保存的缺陷，按 [逐次真实浏览器报告](<verification/canvas-doc-browser-20261021-1410/REPORT.md>)保留失败证据，不以单测或一次refresh掩盖。

安全收尾额外覆盖：权限策略损坏/IO错误不再default allow；同步状态/retry/resolve校验Doc App访问权限；替换文档身份后不能继承旧文档基线；旧JSON/base64/multipart文件覆盖接口不得绕过版本写入活动Doc镜像，返回428，需使用卡片/Doc或版本化App files。普通新上传和独立复制不受该限制。

**门禁和部署限制**：vendor仓内常规tgz的可移植file依赖已纳入guard；MF React/ReactDOM配对及既有未登记JS、根e2e缺失fixture仍使全仓门禁失败。单服务进程写同一根，Appwrite不提供真CAS；正文→日志间隙需要安全对账；真实身份/团队provider、Appwrite权限及生产部署未验收。未重启原有Canvas/Doc服务、迁移真实数据或清理历史绑定。

## 画布与文档 App 关系收口（2026-10-21，此前批次）

Node 24.19.0 / pnpm 10.33.2。画布服务端 **214 通过、1 Appwrite 集成跳过**；Web **381 通过**；两包类型检查及 diff 检查通过。文档服务端 **27 通过**，server/web/surface 类型检查与 server/web/function 构建通过。

使用显式临时数据根与随机 loopback 端口启动实际 canvas/doc 两个子进程，完成 **9 组**检查：3 组不同画布/团队的出生绑定、同 nodeId 不串文档、doc 保存后文件与 node.text 一致、跨租户直连和代理拒绝、删卡保文档、归档拒写/拒自动重绑，以及独立浏览器完整编辑持久化。Chrome 155 中新建→代码编辑→自动保存→刷新→重开富文本/代码→返回列表通过，pageerror/requestfailed 均为 0。[合成正文截图](<verification/doc-ui-persisted-2026-10-21.png>)不含用户数据。所有本轮临时服务和浏览器均已关闭，临时数据根已删除；未重启现有服务。

**本轮全仓门禁没有全绿**：guard 报 vendor file: 依赖、MF React 配对与未登记 JS 脚本；根级 typecheck 卡在 e2e 缺失 fixture。下方以前批次的“全仓通过”是历史记录，不代表当前 HEAD。尚无持久 outbox、文档正文 CAS、生产团队 provider/Appwrite 部署验收；未清理真实历史绑定。完整责任关系、修复清单、边界与服务切换说明见 [关系及状态报告](<canvas-doc-relationship-and-status.zh-CN.md>)。

## MF 开放 UI 本地集成（此前阶段）

在独立数据根和隔离生产构建中完成真实 MF SDK 验证，不替换正在使用的旧预览。最终 **6 个 MF 浏览器场景通过**（含认证场景的 HTTP401／业务码40101 两个子步骤），并在同一最新构建复验 **23 个原画布／资产场景通过**。验证覆盖原生上传／发送／SSE／WS、结束队列处理、授权工具、绑定文本交付、真实文件字节与无需刷新出现的唯一导入节点。

五个正常流程无失败 HTTP；全部六个场景无开发 SSO 令牌请求。认证失败后不导航到登录页面，不启动任务或修改文件。各文档实际只有一份 DOM 渲染器：Next 自带 `19.3.0-canary-3f0b9e61-20260317`，MF 为 `19.2.3`；原组件包的 React18 依赖声明不是浏览器运行版本。MF 精确使用 `mf.localhost`，不代理 SDK 的 localhost 开发令牌提取端点。

全仓类型、guard、生产构建和相应包级回归通过。完整计数、已修问题、原始截图及明确未验的云端登录／模型／ACL 清单见 [MF 集成报告](<mf-integration.md>)与[最终证据索引](<../e2e/evidence/mf-integration/README.md>)。这是真实 SDK 配合受控测试服务的本地验收，不是假定真实云端已登录或已完成模型生成；统计／字体的 CSP 拒绝记录仍保留。

## 全量 UI 排查（此前交付）

针对后续多处样式异常，追踪冻结入口、组件、CSS 与宿主，修复根级加载顺序、通用确认、资产共享规则、全局提示、统一 picker、演示和工具栏。Web 380 项、画布包 182 项单测通过；完整 Web／Electron UI 连续两轮 54 通过、2 次人工扩展确认跳过。Guard、全仓类型检查和生产构建通过，真实素材预览、音频播放与稳定态菜单另有补证。用户预览已恢复，原画板字节哈希未变。

具体差异、真实覆盖、97 张原始截图及明确未验状态见[全量排查报告](<full-ui-audit.md>)。这不替代外部扩展复验，也不宣称所有配置适配器的执行成功已验证。

## 画布操作菜单追加复验（此前阶段）

补回原 Home 入口隐式加载、但独立画布仍需要的宿主弹层 CSS，改为由实际消费组件直接导入。选择／抓手菜单实测从 288px 收紧到原内容宽度 144px，清除多余 16px 外层留白及 canvas 灰底。真实回归覆盖悬停保持、模式切换、选中态与 Escape 关闭。

Guard、全仓类型检查、Web 生产构建通过；Web **43 个文件、328 项通过**；完整 UI 两轮 **28 通过、0 失败、2 人工跳过**。扩展人工复验仍未完成。原因、限制及前后截图见 [样式专项报告追加章节](<style-fidelity-verification.md>)。

## 样式还原专项（上一轮）

用户指出草图顶部样式疑似未完整还原后，重新核对原入口与实际 CSS 匹配。确认并恢复顶部宿主标记、单工作区边距／材质、原版固定浅色及默认强调色，以及误随混合平台样式一起移除的通用 modal、accordion 和 QuestionForm 规则。原草图两组工具条的分层、尺寸及 110px 标签最大宽度予以保留，不凭观感重设计。

- Guard、全仓类型检查、Web 生产构建通过。
- 本轮 Web 包测试：**42 个文件、327 项通过，0 失败**。
- 完整真实 UI 两轮：**26 次通过，0 失败**（Web 18、Electron 8）；扩展人工复验 **2 skipped**，仍按用户决定暂缓。
- 新增实测覆盖：1440／840px、系统浅／深色偏好、草图工具条几何和保存完成、HTML 导出弹窗全屏遮罩与居中。
- 原因、先红后绿记录、验证边界和 **8 张修复前后原图**见 [样式专项报告](<style-fidelity-verification.md>)。

此前的功能／中文化测试没有覆盖上述祖先选择器与弹窗几何，不能视作样式完全还原的证明；以下中文化统计和截图保留为该阶段的历史证据，不替代本轮结果。

## 中文化复验（上一阶段）

此前截图为英文，是因为验收辅助函数明确选择了 English。本次不只更换截图：产品首次启动、服务端渲染、无 Provider 的组件以及桌面／扩展的缺省语言均改为简体中文，不再随英语浏览器或系统自动切换；明确的用户英文偏好仍保留。

补齐画布／资产／采集、浏览器设置、编辑检查器、保存与恢复错误、版本记录、文档空状态、无障碍说明，以及 5 类 96 项第一方风格标题／描述。文档预览通过共享 DTO 的 `notice/generatedTitle` 区分程序生成文案，不通过匹配英文正文替换用户内容。HTTP 错误保留原代码、状态和诊断，界面提供中文，包括权限、冲突和存储空间不足；部分保存不会冒充全部成功。

| 验证项 | 结果 |
|---|---|
| Guard、全仓类型检查 | 通过，12 个包清单；无原仓库运行依赖 |
| 包级测试 | **170 个文件、1703 项通过，0 失败** |
| HTTP／CLI 集成 | **2 个文件、7 项通过，0 失败** |
| 生产构建 | contracts、server、desktop（含扩展）、web 全部通过 |
| 中文真实 UI | **10 个普通场景各两轮，20 次通过、0 失败**（Web 16、Electron 4） |
| 外部扩展完整原生复验 | 用户暂缓；两轮各跳过 1 项，**共 2 skipped，不计入通过** |
| 中英词典 | 各 **8342 个键**，无缺失或额外键 |

新增真实默认语言用例使用 `en-US` 全新浏览器上下文和空存储，**不注入语言偏好**，验证中文界面及刷新；之后才设置显式英文并验证兼容。其余场景保持原布局、交互、HTTP 字段、真实文件字节、版本、授权隔离与撤销、来源及持久化断言。中文化的 red spec 涵盖首次语言、元信息／提示词泄漏、深层编辑错误、空文档状态与虚拟默认空间的语言归属。复审另外修复了显式英文且无存储／存储写入被拒绝时 HTTP 错误仍取中文的问题：服务文案随已挂载应用语言，卸载后回到默认值；相关 3 条用例先红后绿，最终构建与完整 UI 重新执行。

复验过程还曾出现 **19 通过／1 失败／2 跳过**：原生地址框聚焦时，受控值回填与下一帧全选之间存在竞态，导致旧 URL 与新输入串接。已用组件红测准确复现，改为同一焦点事件中同步提交显示值并全选，保持已聚焦时的正常鼠标定位，不重试 `fill` 或放宽断言。修复后地址组件 5 项通过，另外独立执行 **5 轮真实原生浏览器定向用例全部通过**；最终完整批次仍单列统计，不将定向次数混入。

当前主证据：

| 界面 | 原始截图 |
|---|---|
| 英文浏览器中首次默认中文 | [新建菜单与画布](<../e2e/evidence/zh-CN/00-default-chinese-english-browser.png>) |
| 画布／资产／采集三入口 | [三入口](<../e2e/evidence/zh-CN/20-three-original-sidebar-tabs.png>) · [本地资产卡片](<../e2e/evidence/zh-CN/22-original-local-asset-cards-and-space.png>) |
| 原生浏览器与采集 | [浏览页面](<../e2e/evidence/zh-CN/14-native-browser-page.png>) · [采集侧栏](<../e2e/evidence/zh-CN/27-original-native-collector-sidebar.png>) |
| 原资产保存与扩展设置 | [保存对话框](<../e2e/evidence/zh-CN/29-canonical-original-save-asset-dialog.png>) · [扩展入口与状态](<../e2e/evidence/zh-CN/30-native-browser-extension-entry-and-status.png>) |
| HTML 编辑与版本 | [手动编辑](<../e2e/evidence/zh-CN/09-html-manual-edit.png>) · [版本记录](<../e2e/evidence/zh-CN/10-html-versions.png>) |
| 文档结构文本预览 | [DOCX](<../e2e/evidence/zh-CN/34-docx-text-preview.png>) · [PPTX](<../e2e/evidence/zh-CN/35-pptx-text-preview.png>) · [XLSX](<../e2e/evidence/zh-CN/36-xlsx-text-preview.png>) |

两轮共生成 66 张原始截图，交付保留首轮 **33 张**，不改像素或重编码。部分原生截图沿用 `.png` 文件名但实际是 Electron screencast 的 JPEG 字节，格式在 [中文证据清单](<../e2e/evidence/zh-CN/verification-summary.json>) 明确记录；[SHA256](<../e2e/evidence/zh-CN/SHA256SUMS>) 可校验。以前的英文截图留在下方恢复记录中作历史证据，不代表当前默认语言。

边界与噪声：本次没有点击扩展“启用”、导出 ZIP 的系统确认或真实登录，不能据此补报外部完整链路已通过。原生运行仅有第三方站点 favicon 404，无页面脚本异常。系统／浏览器自行管理的界面、品牌与协议、用户文件名／内容／工作表名、开发诊断和 API 原始数据不被强制翻译；Office 仍是结构文本预览，不是版式还原或编辑器。

## 三入口恢复交付记录（中文化前）

- `pnpm install --frozen-lockfile`：通过，12 个 workspace manifests。
- `pnpm guard`：通过；无上游运行目录或被排除产品的导入。
- `pnpm typecheck`：根工具和所有包通过。
- 包级测试：**162 个文件、1647 项通过**。
- 真实 HTTP/CLI 集成：**2 个文件、7 项通过**。
- 真实 UI：**9 个场景各重复两次，18 次通过**；其中 Web 7 个场景、Electron 2 个场景。
- 外部扩展人工场景在默认批次中明确跳过：重复两次产生 **2 skipped**，不计入通过数。**用户选择暂缓修复后的完整原生链路复验**，详见下节。
- 已成功构建共享依赖、服务器、生产 Web 和 Electron；最终 UI 使用生产构建，包含最后的焦点、地址编辑及采集会话修复。扩展 ZIP 由桌面构建生成并检查全部 13 个条目。

环境：macOS arm64、Node 24.21.0、pnpm 10.33.2、Next 16.2.6、React 18.3.1、Electron 41.3.0。Web 使用 Chrome channel 的全新测试 profile；外部扩展单独使用 Chrome for Testing 的全新 profile，不使用日常浏览器资料。

| 包 | 测试文件 | 通过项 |
|---|---:|---:|
| components | 2 | 12 |
| release | 1 | 5 |
| contracts | 54 | 586 |
| host | 2 | 16 |
| desktop | 17 | 172 |
| server | 32 | 374 |
| workbench-core | 1 | 3 |
| workbench-ui | 4 | 15 |
| canvas-workbench | 14 | 182 |
| web | 35 | 282 |
| HTTP/CLI e2e（单列） | 2 | 7 |

## 外部扩展：部分实际通过，完整复验暂缓

[人工协作测试](<../e2e/ui/native-extension.test.ts>)加载桌面构建产物中的实际扩展，使用真实鼠标选中页面文字、打开原保存对话框，并由用户确认真实系统授权；没有模拟系统同意、直接调用扩展消息来代替操作或增加产品测试后门。

本次实际运行已经证明：

1. 独立扩展身份校验、加载、选择工具栏和原保存对话框可用。
2. 用户同意后，选择内容确实写入本地库，原文字节、来源 URL 和项目关联断言通过。
3. 保存后的检查器链路暴露两个缺陷：上游 worker 丢失 `assetData/sessionId`；本地能力刷新临时清空能力导致原生宿主撤销检查器会话。第二轮实际运行已到达保存后检查器，但编辑因会话撤销失败。
4. 两个缺陷均已修复，并有先红后绿回归；另补充了异步操作不跨资产来源的回归。最后一次原生复验等待授权超时，未执行写入。用户随后明确选择先完成其它交付，不再弹出授权窗口。

因此，**不得将新版的“外部扩展保存 → 保存后编辑 → YAML → 库内展示”全链路记为已通过**。相关 worker 协议、能力生命周期和来源归属测试已通过，但不替代这项人工复验。扩展安装到普通 profile、系统文件保存落盘、Pinterest/Google 真实账号与 cookie 交接也未宣布验收。

仅在用户另行要求继续人工复验时，首个应用确认弹窗选择 **启用**（英文模式为 Enable）。随后的扩展 ZIP 保存框可以取消，测试已将真实构建包加载到其独立 profile。不要关闭工作区中的扩展设置对话框。运行命令见下节；本次中文化没有执行这项人工授权。

## 可复现命令

使用 Node 24 和仓库固定 pnpm 版本。数据根规则只以 [根目录说明](<../AGENTS.md#safety-and-data>)为准，不使用共享/环境中的现成应用实例。

```sh
pnpm install --frozen-lockfile
pnpm guard
pnpm typecheck
pnpm --filter './packages/*' -r --if-present build
pnpm --filter @canvas/server build
pnpm --filter @canvas-workspace/web build
pnpm --filter @canvas/desktop build
pnpm --filter './apps/*' --filter './packages/*' --workspace-concurrency=1 -r --if-present test
pnpm --filter @canvas/e2e test
pnpm --filter @canvas/e2e test:ui --repeat-each=2 --reporter=list
```

安装匹配的 Playwright Chromium，或以 `CANVAS_E2E_BROWSER_CHANNEL=chrome` 使用已安装 Chrome 的临时 profile。直接以 Node 执行 pnpm 脚本时，设置 `CANVAS_E2E_PNPM` 指向该脚本；自定义浏览器缓存时保持 `PLAYWRIGHT_BROWSERS_PATH` 一致。

仅在用户准备好确认系统弹窗时运行：

```sh
CANVAS_E2E_CONFIRM_NATIVE_EXTENSION=1 pnpm --filter @canvas/e2e test:ui native-extension.test.ts --project=desktop --reporter=list
```

默认使用匹配的完整 Chromium；需要时用 `CANVAS_E2E_EXTENSION_EXECUTABLE` 指定支持加载扩展的 Chrome for Testing **绝对可执行路径**。这不是 profile 路径，也不改变产品权限。人工用例在写入前检查唯一测试项目名称，避免写入另一独立运行实例。

## 真实场景与边界

- [资产 UI](<../e2e/ui/asset-library.test.ts>)：原 Canvas/Assets/Collect 三入口、本地空间创建、文本资产、收藏、真实字节导入画布、使用记录、展开原资产库、删除空间默认转移、重载持久化；以及浏览器偏好真实 PUT/重载和 Web 扩展设置入口。曾出现的复选框名称不匹配已经纠正，最终完整流程两次通过。
- [工作区](<../e2e/ui/workspace.test.ts>)：原顶部标签、项目文件、Markdown 编辑/保存/重开、草图模板落盘、剪辑编辑器重开；HTML 交互、源码、手动编辑、版本和演示文稿翻页。
- [原生浏览器](<../e2e/ui/native-browser.test.ts>)：真实 guest 导航/返回、截图与归档、资源发现和 PNG 原始字节保存到本地库；权限拒绝其它项目、关闭后失效、禁止本地文件及特权来源导航。guest 没有主应用特权桥。
- [原采集器](<../e2e/ui/native-collector.test.ts>)：侧栏浏览、跨页签保留、项目采集托盘与来源、原保存对话框写入库、加入画布、展开浏览器、真实扩展设置菜单。打开设置不等于扩展安装成功。
- [Office 预览](<../e2e/ui/office-previews.test.ts>)：DOCX/PPTX/XLSX 合成 OOXML 档案经真实 HTTP 上传；原侧栏发现/选择，再从原 Quick Switcher 打开结构化文本预览，验证段落、幻灯片、工作表和 Download 链接资源的精确字节。**不是 Office 排版还原、公式计算、编辑或下载系统弹窗验收。** 侧栏文件点击只选择，不自行打开预览。
- [HTTP/CLI](<../e2e/tests/asset-library-cli.test.ts>)：实际 CLI 子进程、空间/资产/版本/收藏、导入保存/使用记录/默认空间转移、multipart 精确字节、captureId 重放/冲突、ZIP 和 create-only 二进制输出，以及偏好 CAS。[工作区 HTTP 集成](<../e2e/tests/workspace.test.ts>)另验证版本恢复、代理及两个并发独立实例。

## 修复证据而非放宽断言

- 标签菜单退场抢夺 Capture 弹层焦点：[焦点回归](<../apps/web/tests/asset-library-launcher-focus.test.tsx>)，先红后绿，随后真实偏好场景通过。
- 地址栏延迟 blur/选择回调覆盖再次输入：[地址编辑回归](<../apps/web/tests/browser-address-editing.test.tsx>)，先红后绿，原生导航重复通过。
- 扩展已保存结果字段丢失：[实际打包 worker 回归](<../apps/desktop/tests/main/browser-extension-worker.test.ts>)，修复前 8 项失败、修复后 9 项通过；内部令牌不交给内容脚本，检查器绑定标签页。
- 同来源能力刷新误撤销会话：[能力回归](<../apps/web/tests/asset-library-capabilities.test.tsx>)；异步读写来源漂移：[来源回归](<../apps/web/tests/asset-library-capture-source.test.ts>)。都已先红后绿。
- 最终默认 Web 测试不依赖额外 `--environment` 参数；相关 DOM 测试显式声明 jsdom。未删除或跳过失败断言来获得默认套件通过。

## 运行所有权与证据

[统一生命周期 harness](<../e2e/lib/tools-dev/runtime.ts>)只经 `pnpm tools-dev run web|desktop --production` 启动应用，并拥有预留端口、就绪检查、进程组和每个 worker 的独立运行数据。UI 只导入 [Playwright suite](<../e2e/lib/playwright/suite.ts>)，HTTP 集成使用对应 Vitest suite。测试通过真实 API 创建数据，不拦截工作区接口，不连接环境中已有服务。

原生 trace 关闭，避免保存短时授权头。成功运行清理自己拥有的临时数据；失败保留诊断数据，均不进入 Git。无真实账号、日常浏览器 profile 或用户 cookie 被自动化操作。没有使用 `--no-sandbox`。浏览器原首页仍可能请求公开 favicon，目标采集页面则来自独立本地 fixture。

最终第二次重复运行的 **32 张原始截图**保存在 [交付证据目录](<../e2e/evidence/restoration-final/>)，校验摘要见 [summary](<../e2e/evidence/restoration-final/verification-summary.json>)。原生截图保持原始捕获字节，部分文件虽沿用 `.png` 名称，实际编码为 JPEG；未重绘或修图。初次抽取的旧截图不作为本轮功能闭环的证明。

重点截图：[原三入口](<../e2e/evidence/restoration-final/20-three-original-sidebar-tabs.png>)、[原资产卡片与空间](<../e2e/evidence/restoration-final/22-original-local-asset-cards-and-space.png>)、[展开资产库](<../e2e/evidence/restoration-final/23-original-expanded-asset-library.png>)、[默认空间转移](<../e2e/evidence/restoration-final/24-space-removal-preserves-assets-by-default.png>)、[原生采集侧栏](<../e2e/evidence/restoration-final/27-original-native-collector-sidebar.png>)、[原保存对话框](<../e2e/evidence/restoration-final/29-canonical-original-save-asset-dialog.png>)、[原生扩展设置](<../e2e/evidence/restoration-final/30-native-browser-extension-entry-and-status.png>)、[DOCX](<../e2e/evidence/restoration-final/34-docx-text-preview.png>)、[PPTX](<../e2e/evidence/restoration-final/35-pptx-text-preview.png>)、[XLSX](<../e2e/evidence/restoration-final/36-xlsx-text-preview.png>)。

完整逐像素 golden-image 比较、供应商付费执行、普通 profile 扩展安装、原生下载保存及真实登录结果未覆盖。原浏览器停用的 inspect/edit/comment 工具栏、缺少的 viewport UI、批注闭环和归档边界仍见 [功能对照](<feature-parity.md>)，不把内部处理器的存在写成可用功能。
