# 短剧配音编辑卡（card.drama.audio）

PDE 挑战赛 M 端命题「多模态生成的编辑器应用开发」的交付卡包，基于画布工作区底座 `designai-app-canvas` 的卡片包合同 `canvas-card-pack/v1` 开发。

生成链路产出短剧视频、解说词和逐句配音后，这张卡负责「最后一公里」的编辑：逐句改词、换音色、调区间和音量、局部重新生成配音，对着画面试听，最后导出成品。整套编辑都在画布卡片内完成，不需要在多个工具之间来回切换。

## 三要素

### 目标用户
- **短剧解说与配音的运营、剪辑人员**：拿到 AI 生成的解说词和 TTS 配音后，需要快速修正个别句子的文字、语气、时间位置和响度，再导出给下游剪辑或发布。
- **画布 Agent 与工作流编排**：通过画布能力清单发现 `card.drama.audio.*` 动作，把「改第 3 句停顿」「换配音源」「导出字幕」这类操作编进自动化链路。

### 使用场景（真实业务场景）
以短剧解说视频的配音返工为例，验证用的素材是一集短剧解说的原片和对应解说词：

1. **生成**：视频和解说词进入画布，卡片按行建立逐句台词与视频区间；本机 VoxCPM 逐句生成配音候选。
2. **编辑**：选中一句，修改文字或音色，生成新候选，与旧版对比试听后采用；拖动时间轴调整区间、句间停顿和音量；锁定已确认的段落，避免误改。
3. **再生成**：只对改过的句子重新生成，台词列表上方会提示「更新 N 句配音」。画布 Agent 也可以提交 `card.drama.audio.rewrite`，由模型基于画面采样和原稿给出改写建议，写入卡片。
4. **导出**：导出 WAV 混音、SRT 字幕、带字幕的 MP4 或剪辑交接包；也可以通过动作把 EDL 和字幕写入工程文件，回流到下游。

### 能力边界
| 支持 | 说明 |
| --- | --- |
| 逐句编辑 | 改文字、逐句音色（预设或自定义描述）、逐句音量、静音、增删句子、画面入出点、音频裁剪、句尾留白 |
| 配音助手 | 编辑器左侧用自然语言下指令，例如「第 3 句太赶了，慢一点，后面停半秒」「把第 2 句改成……」「用第 1 句的音色统一全部」「第 2 到 4 句音量 80%」「贴合视频」「检查问题」「导出字幕」。助手先列出改动，点「应用」后一次提交（会重新贴合视频），可以一步撤销；没有配音、句子不存在等情况会说明原因。指令在卡内解析为结构化意图（[assistant.ts](src/director/assistant.ts)），不联网、不调用模型；以后可以改由大模型产出同样的意图 |
| 时间轴剪辑 | 拖动移动和裁剪（相邻句子自动让位：先缩短自己的区间，不短于配音时长或按字数估算的朗读时长，不够再顺延）、分割、复制粘贴、删除、吸附标记、选区、锁定、句间停顿（只移动本句或连同后续） |
| 音色一致 | 批量配音前可选整体音色；也可把满意的一句「设为音色基准」，其他句子按它的声音生成（本机 VoxCPM 克隆参考音频），换基准后已有配音显示待更新，可一键「更新 N 句配音」 |
| 贴合视频 | 按真实配音时长让句子首尾相接，富余时间分到句间；配音放不下时先压缩空白，再保持音调加速（最多 1.15 倍），仍放不下的句子提示超出，不再悄悄截断。采用新配音后自动重新贴合（可关闭），手动拖动的位置会保留 |
| 保持音调变速 | 试听倍速和贴合加速都用浏览器内 WSOLA 时间伸缩实现，声音只变快慢不变调；导出与试听一致 |
| 混音 | 原声、配音、背景音乐三轨音量，选区音量和渐变 |
| 试听与导出 | 视频为主时钟的同步试听；导出 WAV（15 分钟以内）、SRT、MP4（依赖浏览器 H.264/AAC）、交接包 |
| 撤销与保存 | 卡内撤销和重做（50 步），保存状态如实显示（见下文「保存」） |

| 不支持 / 有前提 | 说明 |
| --- | --- |
| 媒体持久化 | 卡片合同 v1 没有给渲染器提供授权的媒体读写口，视频和音频只在当前会话可用。刷新后用「恢复会话素材」重新选择同内容的原文件（按内容哈希匹配），或从交接包取回素材。画布持久保存的是台词、剪辑参数和素材引用。 |
| 本机配音 | 只在页面运行于 `127.0.0.1`、且本机 VoxCPM 在 8808 端口就绪时可用；部署环境不可用。 |
| 模型改写 | 由画布 Agent 或 CLI 提交 `card.drama.audio.rewrite`（请求含采样帧与原稿）；服务端需配置万擎（`WQ_API_KEY`、`WQ_MODEL`、`WQ_VISION_MODEL`），未配置时动作返回 `REWRITE_UNAVAILABLE`。卡内不再提供改写请求下载。 |
| 配音助手的理解范围 | 只认识常见说法（句子序号、语速、音量、停顿与重叠、改台词、音色、贴合、生成、检查、导出、撤销），听不懂时回复示例；不做自由对话 |
| 尚未实现 | 交叉淡化、词级对齐、自动降噪、响度分析、后台导出 |
| 文件大小 | 单个媒体 ≤30 MB，单卡会话媒体合计 ≤180 MB；卡片 `data` 序列化后 ≤256 KB |

## 建卡与打开

通过画布通用动作 `node.create` 建卡，然后点击卡面上的「打开短剧配音编辑器」：

```json
{"id":"drama-audio-1","kind":"card.drama.audio","title":"短剧配音","x":0,"y":0,"width":380,"height":165,"data":{"stage":"edit"}}
```

编辑器中依次「导入主视频」「导入台词」（TXT/MD，每行一句），再导入整轨配音或逐句生成配音。

## 保存

卡片只能通过合同规定的 `onPatch` 把修改交给画布，由画布负责持久化。工具栏状态如实反映这一过程：

| 状态 | 含义 |
| --- | --- |
| 保存中… | 修改已交给画布，等待画布回传 |
| 已保存到画布 | 画布已回传同一份内容 |
| 画布尚未确认这次修改 | 4 秒内未回传，可点「重新提交」（不影响撤销历史） |
| 已载入画布的最新内容 | 其他窗口或 Agent 修改了卡片；以画布内容为准并清空撤销历史，避免覆盖他人修改 |
| 修改未应用 | 例如超出 256 KB，修改不会提交 |

等待确认期间关闭页面会弹出离开提示。

## data 字段

`data` 为卡包自管的 JSON 黑盒（`dataVersion` 3），平台原样保存。主要字段：

| 字段 | 说明 |
| --- | --- |
| `videoRef`、`videoDurationMs` | 主视频引用与时长（毫秒），视频是唯一主时钟 |
| `rewriteLines` | 逐句台词 `{ id, text, videoStartMs, videoEndMs }`，区间不重叠 |
| `confirmedLineIds` | 已人工确认区间的句子 |
| `audioRef`、`durationMs` | 整轨配音引用与时长 |
| `segments` | 配音片段 `{ id, label, startMs, endMs, gapMs, gain, muted, videoStartMs, videoEndMs, audioRefOverride, leadMs?, speed?, fitSpeed? }`；`id` 与台词对应；`leadMs` 为配音提前进入、与上一句重叠的毫秒数；`speed` 为手动语速，`fitSpeed` 为贴合视频时的自动加速，实际倍率为两者相乘 |
| `lineJoins` | 每句与上一句的衔接（毫秒），正数为空白、负数为重叠；手动拖动后记录，贴合视频时保留 |
| `masterGain`、`lineGains` | 配音总音量（0–2）与逐句音量 |
| `voiceInstruction`、`lineVoiceInstructions` | 整体音色与逐句音色描述 |
| `voiceReference` | 音色基准 `{ lineId, audioRef, startMs, endMs, text, voice? }`；生成时截取其中最多 15 秒上传给本机 VoxCPM 作为参考音频 |
| `generatedLineTexts`、`generatedLineVoices` | 生成配音时的文字与音色标识（有音色基准时包含基准音频），用于判断配音是否过期 |
| `directorOriginalGain`、`directorBackgroundRef`、`directorBackgroundDurationMs`、`directorBackgroundGain` | 原声音量与背景音乐 |
| `directorGainRegions` | 选区音量 `{ track, startMs, endMs, gain, fadeMs }` |
| `directorEdit` | 锁定区间 `locks`、画面标记 `markers`；旧数据中的批注 `notes`、时间方案 `arrangements`、审阅记录 `review` 原样保留，界面不再编辑 |
| `directorTrimBounds` | 剪辑裁剪时保留的原音源边界，支持在原范围内重新延长 |
| `rewritePrompt`、`rewriteDraft` | 改写要求与待采用的改写建议 |
| `trimStartMs`、`trimEndMs`、`script`、`captions`、`dubbingDoc` | EDL 裁剪窗口、台本、画面描述与配音文档 |
| `exportedPath`、`exportedDigest`、`subtitlePath` | 动作导出的 EDL 与字幕工程路径 |

## 卡片动作（Agent 调用）

动作注册在[服务端入口](src/server.ts)，自动出现在 `GET /api/apps/canvas` 的能力清单中。调用方式为 `POST /api/apps/canvas/instances/:id/actions/card.drama.audio.<动作>`，请求带 `input.nodeId`、`input.params`、当前 `expectedRevision` 和 `idempotency-key` 请求头；同一幂等键重放会返回旧凭条。平台目前不会自动暴露参数 schema，参数以下表为准：

| 动作 | params | 作用 |
| --- | --- | --- |
| `attach` | `audioRef`、`durationMs`，可选 `videoRef`、`videoDurationMs`、`segments[]` | 绑定或替换配音源，可同时绑定视频 |
| `video` | `videoRef`、`videoDurationMs` | 绑定或替换主视频 |
| `script` | `script`（字符串或 `null`） | 写入台本 |
| `upsert` | `segment`（完整片段字段） | 新增或替换片段 |
| `remove` | `segmentId` | 删除片段 |
| `gap` | `segmentId`、`gapMs` | 调整句尾停顿 |
| `gain` | `gain`，可选 `segmentId` | 无 `segmentId` 时调整总音量 |
| `mute` | `segmentId`、`muted` | 静音开关 |
| `trim` | 可选 `startMs`、`endMs` | 配音源裁剪窗口，缺省清除该端 |
| `align` | `segmentId`，可选 `videoStartMs`、`videoEndMs` | 设置片段的画面区间 |
| `span` | `segmentId`，可选 `startMs`、`endMs` | 调整片段的音源区间 |
| `rebind` | `segmentId`、`audioRef`（`null` 恢复主源） | 片段换配音源 |
| `analyze` | 无 | 由视频生成画面描述（需配置模型） |
| `compose` | 可选 `script` | 台本加画面描述生成配音文档（需配置模型） |
| `rewrite` | 改写请求体（视频引用、时长、原稿、改写要求、采样帧） | 基于采样帧和原稿生成改写建议，写入 `rewriteDraft` |
| `export` | 无 | 把 EDL 清单写入 `card-assets/drama-audio/<卡ID>.edl.json` |
| `export-srt` | 无 | 把逐句字幕写入工程文件 |

参数校验失败时返回标准错误信封，动作不会部分生效。

## 开发与验证

需要 Node 24 和 pnpm 10.33.2。

```sh
pnpm --filter @bezier/canvas-pack-drama-audio typecheck
pnpm --filter @bezier/canvas-pack-drama-audio test
pnpm --filter @bezier/canvas-pack-drama-audio build           # 产出 ./server 入口
```

覆盖率门槛为行与语句 ≥60%（见 `vitest.config.ts`），当前为行 74.16%、语句 70.84%（371 个测试）。为了不改动工作区其他包的锁文件条目，卡包不常驻覆盖率插件；测量时临时安装，测完还原：

```sh
pnpm --filter @bezier/canvas-pack-drama-audio add -D @vitest/coverage-v8@4.1.6
pnpm --filter @bezier/canvas-pack-drama-audio exec vitest run --coverage
git checkout -- packages/canvas-pack-drama-audio/package.json pnpm-lock.yaml && pnpm install
```

本地运行画布（显式隔离数据目录，仅用于开发验证，不代表云端验收）：

```sh
CANVAS_STORAGE_MODE=local-test pnpm tools-dev run web --data-dir "<绝对路径>" --daemon-port 17460 --web-port 17580
```

需要本机配音时，另开终端启动 VoxCPM（默认读取仓库 `.runtime/local-tts`，可用 `DRAMA_TTS_HOME` 指向其他目录）：

```sh
pnpm --filter @bezier/canvas-pack-drama-audio voice
```

## 来源

卡包由本仓的短剧导演工作台与配音卡迁移而来，保留 Apache-2.0 许可证；内联图标来自 Lucide（见 [LICENSE.lucide](LICENSE.lucide)）。迁移边界与待验收项见 [UNMIGRATED.md](UNMIGRATED.md)，早期需求记录见 [REQUIREMENTS.md](REQUIREMENTS.md)。
