# REQUIREMENTS — 短剧配音音频编辑卡（card.drama.audio）

> 早期需求记录（2026-11-03），保留作历史参考。其中「不做波形、播放、TTS」等边界已过时，当前能力、三要素和动作清单以 [README](README.md) 为准。

PDE 挑战赛 · M 端命题「多模态生成的编辑器应用开发」交付需求文档。基于画布工作区底座 `designai-app-canvas`（基线分支 `feat/zhuzhiheng-card-pack-base`），交付物 = 卡片包 `@bezier/canvas-pack-drama-audio`。

## 1. 三要素（命题必填）

### 目标用户
- 短剧制作的运营/创作者：拿到 TTS 生成的配音音轨后，需要快速微调「哪句在前、停顿多长、哪句重录、整体响度」的人群。
- 次要：管理侧 Agent / 工作流编排（通过 COI 能力清单发现并调用 `card.drama.audio.*` 动作，把配音微调编进自动化链路）。

### 使用场景（≥1 真实业务场景）

> 运行时实链已按本节场景跑通（本地隔离验证，见 §4 证据）。
短剧第 N 集配音产出链：
1. 语音合成生成整段配音 → 音频字节落工程文件，卡上只存引用（`attach`：audioRef + durationMs，可带初始分段）
2. 卡片时间轴上按台词分段（`upsert`/`remove`），逐句调停顿（`gap`）、音量（`gain`）、静音试听节奏（`mute`）、掐头去尾（`trim`）
3. 台本同步写入卡片（`script`），与台词段 label 对应
4. 导出（`export`）：EDL 决策渲染为清单 `card-assets/drama-audio/<卡ID>.edl.json`（含源引用、裁剪窗口、分段决策、估算时长、内容摘要），回流下游混音/合成链
5. 改台词后换源重绑（`attach`）→ 编辑 → 再导出：生成→编辑→再生成→导出闭环

### 能力边界（v1 明确不做，不假装成功）
- **不做**真音频字节渲染/混音落盘（导出产物是 EDL 清单，不是音频文件）
- **不做**波形解码与播放预览（渲染器无文件读取通道，时间轴展示分段结构）
- **不做**TTS 集成（`attach` 只登记引用与时长，合成调用归生成链路）
- 单文件 >30MB 走平台限制（§6 文件口约束）；卡内 `data` ≤256KB（只存决策）

## 2. 竞赛评审映射

| 评审项 | 权重 | 本方案落点 |
|---|---|---|
| 首任务 ≤5min / SUS≥80 | 8% | 建卡即见时间轴；点段即编辑，全部操作卡内闭环，无跨工具切换 |
| 交互一致性 | 8% | 走 `onPatch` 通道 → 自动获得平台撤销/重做/保存；样式用主题 CSS 变量不写死颜色 |
| 任务效率 | 8% | 停顿/音量一键步进（±100ms / ±0.1x），比基线多工具倒腾少 3 步以上 |
| AI 指令可用性 | 6% | 9 个语义化动作直接对自然语言映射（"第 3 句后面停顿加长半秒" → `gap`）；失败时 UI 手动兜底 100% 覆盖 |
| 场景定义清晰度 | 6% | 本文档三要素 + 上述场景链 |
| 功能闭环度 | 10% | 生成（attach 换源重绑）→编辑（EDL 补丁）→再生成（script 回流）→导出（EDL 清单 + 摘要） |
| 协议适配 | 8% | 信封零改动；契约测试（canvas-card-pack.test.ts 等 655 项）全绿；新卡种不触碰存量画布数据，天然向后兼容 |
| 工程质量 | 6% | 纯函数核心 + 47 项单测覆盖 schema/EDL/动作/确定性；guard 通过 |
| 首屏/帧率/内存 | 30% | EDL 设计：data 恒小、撤销链轻；时间轴单 Canvas 绘制（dpr 适配、rAF 无关操作不重绘全卡）、组件 memo 安全；导出为纯函数 + 文件口，无 UI 阻塞 |
| 规模上限 | 6% | 段数增长只扩 EDL 数组，时间轴绘制 O(段数)；阶梯测试位后续补衰减曲线 |

## 3. 验收清单（规范 §10 对照）

- [x] kind/动作全用 `card.drama.audio` 前缀（不占平台保留前缀）
- [x] `src/server.ts` 服务端入口导出，`apps/server/src/card-packs.ts` 已挂载
- [x] `data` 黑盒 JSON 可序列化、恒 ≤256KB（只存引用与决策）
- [x] 渲染器不写死颜色（主题变量 + fallback）、可 memo、无外部可变单例
- [x] 动作 handler 全部确定性（同输入同输出，单测覆盖重放一致）
- [x] README 写清建卡动作、data 字段表、专属动作清单
- [x] 构建期挂包只改 `packs.ts` 一行

## 4. 验证证据（2026-11-03 本地）

| 检查 | 结果 |
|---|---|
| `pnpm guard` | 通过（2017 文件 / 20 manifest） |
| 包 `typecheck` / `test` / `build` | 通过 / 59 用例全绿（含 v2 双轨与 v1 兼容）/ dist 产出 |
| `apps/server` build + test | 通过 / 655 用例全绿（1 文件跳过为存量） |
| `canvas-workbench` build + test | 通过 / 264 用例全绿 |
| `apps/web`（Next）build | 通过 |
| 本地运行时实链（`CANVAS_STORAGE_MODE=local-test` 显式隔离，数据目录 `/tmp`，非云端验收） | 服务起跑；`GET /api/apps/canvas` 能力清单含 `card.drama.audio` + **13 动作** + `drama` 包注册；`node.create` 建卡过卡种闸口；v1 链（attach→gap→trim→export）与 v2 链（attach 双轨→align 段对齐→rebind 段换配音源→span 改区间→export）全部 succeeded；EDL v2 清单真实落盘（videoRef/对齐区间/换源/alignShiftMs 偏差）；同 idempotency-key 重放 `replayed=true` 返回旧凭条；**旧 v1 卡原样读取自动降级单轨（向后兼容实测）** |

已知基线状态（非本包引入）：全仓 `pnpm typecheck` 在 apps/server 存量文件报 TS18046/TS7006（stash 验证与挂载无关）。

## 5. 迭代路线（赛后增量方向）

0. ~~双轨编辑（v2 已交付）~~：视频源绑定、段级画面区间对齐与偏差提示、段级换配音源（rebind）、拖拽改配音区间（span）、v1 卡自动降级兼容。
1. 波形层：attach 时服务端预计算峰值数组存 `data.peaks`（分层 mipmap），Canvas 画真波形（长素材阶梯衰减曲线）
2. 播放预览：`editorApp` 关联独立音频 App，或平台开放渲染器文件读取通道后接 WebAudio
3. 真音频导出：EDL → 混音渲染落字节（BGM 混音、变速、淡入淡出）
4. TTS 回流：`script` 变更触发再合成的编辑结果回流再生成
5. `speed`（段级变速）与 BGM 轨（第二音轨 EDL 扩展，`dataVersion` 自管升级）
