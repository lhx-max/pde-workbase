# @bezier/canvas-pack-drama-audio

短剧配音编辑工作台原型，基于 `designai-app-canvas` 卡片包扩展，卡种为 `card.drama.audio`。产品目标是：用户输入短剧视频，通过视频理解生成 dense caption，整理为可编辑配音稿，按段生成 TTS，结合原视频同步试听并导出成片。

**当前交付是交互原型、模型文本适配和部署制品，不是已完成的短剧自动配音产品。** 已实现内容、目标能力及待验收项分别列出，不能用 mock 流转、接口存在或构建通过替代真实业务闭环。

## 1. 业务痛点与研究目标

目标用户：短剧制作、运营、配音和视频二创人员。以下痛点为当前业务假设，仍需真实用户和有使用权限的素材验证。

| 痛点 | 产品目标 | 当前进展 |
| --- | --- | --- |
| 视频内容、配音稿和音轨分散在多种工具中 | 同一工作台看画面、改稿、试听和定位 | 卡内视频选择播放、音频独立试听、时间戳定位已实现；浏览器媒体交互待验收 |
| dense caption 是画面描述，不等于可朗读的配音稿 | 视频理解与文案改写分成两个可检查阶段 | caption 数据接口和面板已实现；万擎文本改写适配已实现，真实调用待验收 |
| 改一句台词往往需要重生成整段配音 | 稳定段 ID、段级编辑与局部 TTS 重生成 | 文案/区间/换源决策可编辑；TTS 尚未接入 |
| 配音时长和镜头不一致 | 视频时间为统一主时钟，检查时长并同步调度 | 当前有区间映射和时长差提示；统一播放调度尚未实现 |
| 用户难以判断生成是否完成、结果是否过期 | 明确任务状态、版本、来源、恢复与重试 | provider 来源标记已实现；异步任务、过期状态和恢复合同待补 |
| 大素材编辑、导出容易阻塞页面 | 非破坏性 EDL、波形分层、后台合成 | EDL 核心和 JSON 导出已实现；性能指标尚未实测 |

研究重点：非破坏性编辑决策模型、时间戳驱动的视听对齐、人与 Agent 共用业务操作、按段生成与条件回填，以及可替换模型和媒体存储适配。

## 2. 整体技术 pipeline

```text
真实短剧视频
  │
  ├─ 本地文件选择 → Blob URL → 浏览器 video 播放原片及原声音
  │                         └─ 播放时间 → 当前台词展示 / 点击段定位
  │
  └─ 上传适配接口（待接宿主授权文件口）
       ↓
    权威媒体资源引用（目标 Appwrite 私有存储）
       ↓
    视频理解 / dense caption（媒体输入协议待确认）
       ↓
    captions：段 ID、视频起止时间、画面描述、可选缩略图
       ↓
    万擎 OpenAI-compatible 文本改写
       │  chat/completions：已有 captions + 人工草稿 → 配音稿
       │  WQ_API_KEY 仅服务端读取
       ↓
    用户审核和编辑稿件
       │  改文字 / 段边界 / 停顿 / 音量 / 静音 / 换源 / 对齐
       ↓
    TTS Provider 接口（尚未接服务）
       ↓
    段级音频资源、真实时长、任务回执（待实现）
       ↓
    原视频 + 原声音 + 新配音 + 字幕
       ├─ 统一主时钟的实时混合预览（待实现）
       └─ 后台合成 MP4 与可恢复导出（待实现）
```

当前真实落地的路径：本地文件预览代码 + 可编辑 EDL + caption/稿件面板 + 万擎文本协议适配 + EDL JSON 输出。早期使用占位 MP4 字节和 mock 数据的演示，只证明请求/数据流转，不证明视频可播放、模型看懂视频或 TTS/成片合成完成。

### 2.1 运行架构和职责

```text
卡片包 renderer（React 18 类型约束）
  ├─ 卡身交互、临时本地媒体预览
  └─ onPatch → 宿主注入保存通道

卡片包纯服务端注册入口
  └─ card.drama.audio.* → 画布操作管道 → 数据补丁 / 文件口
                                    └─ providers.ts → 外部模型

正常运行目标：Appwrite Functions + 数据库/私有桶
本地隔离验证：apps/server + apps/web + 显式 local-test 工作目录
```

平台维护卡片信封（身份、位置、尺寸和操作通道）；本包维护 JSON `data`。不能修改冻结区、绕过授权或把本地缓存当云端权威资源。复杂媒体任务若需要独立深编辑 App，应先与负责人确认参赛范围和互联合同，不能擅自增加部署架构。

### 2.2 EDL、版本与实时效果

- EDL 保存资源引用和编辑决策，不直接修改源视频/音频字节。
- `dataVersion: 3`；读取旧数据补默认字段，已有兼容测试。未来版本和未知字段的迁移行为仍需进一步严格校验。
- 改文字后当前时间对应的文字展示更新，**不等于声音已变化**。实际改声需要 TTS 重生成成功。
- 当前音频播放器是独立试听；区间、增益、静音和换源决策尚未应用到真实混音播放。
- 目标应拆开资源源区间和视频目标区间，尤其是短 TTS take 替换主音源时不能沿用主源偏移。
- 通用操作有 revision/operationId/回执机制；模型调用有成本且可能结果不确定，不应自动重试。任务输入快照、取消、去重及版本条件回填待补。
- 单卡 JSON 合同上限 256KB。当前仅避免媒体字节入卡，**未严格控制 captions、缩略图、段数和总序列化大小**，不能声称大小恒定或长素材内存恒定。

## 3. 已完成工作

| 模块 | 实现 | 实际验收边界 |
| --- | --- | --- |
| 包挂载 | 前端 renderer、纯服务端入口，构建期注册卡种和动作 | 本地能力清单发现已验证；云端动作尚未验收 |
| 台词编辑 | 台词、段区间、停顿、音量、静音、换源、视频区间对齐 | EDL 数据编辑，不等于音视频字节已处理 |
| 段拆分/合并 | UI 中点拆分、并下段 | 已有交互代码；边界/异源合并/视频对齐保留规则需专项测试 |
| 时间轴 | 双轨区间块、对齐虚线、时长差提示 | 不是音频波形；两轨时间尺度尚待统一；拖拽浏览器验收待补 |
| 视觉排版 | 视频/caption 紫色、配音蓝色、文档橙色、换源青色，统计徽章 | 主题对比度、布局溢出与无障碍尚未实测 |
| 本地媒体预览 | video/audio 文件选择、Blob URL 释放、视频定位、文字展示、解码失败提示 | 不上传、不持久化；缺浏览器执行环境，媒体播放交互尚未验收 |
| caption/配音文档 | 面板、可选缩略图、caption 转台词段、稿件应用为台本 | 真实视频理解未验收；已有 mock 来源需持续明确标记 |
| 万擎 | OpenAI-compatible 文本请求、系统提示、拒绝空白/截断结果、来源记录模型 ID | 隔离 HTTP fixture 验证通过，真实模型调用待安全配置密钥 |
| TTS/上传 | 可替换 TypeScript 接口；TTS 缺省明确不可用 | 接口预留，不是服务接通 |
| 输出 | EDL v3 JSON、摘要、卡内预览和复制、服务端文件写入 | 不是可播放 MP4/配音成片；剪贴板失败反馈待补 |
| 部署 | 本地实例启动、Appwrite 上传闭包打包 | 未上传或激活云端，未正式登记 |

### 3.1 代码目录

```text
packages/canvas-pack-drama-audio/
  src/
    index.ts          前端卡包入口
    server.ts         服务端卡种/动作/Agent 元数据
    audio-card.tsx    编辑界面、MediaPreview、上传接口类型
    types.ts          dataVersion 3、段、caption、配音稿结构
    schema.ts         参数与路径校验
    edl.ts            时间轴、对齐差、EDL 清单与摘要
    ops.ts            卡片动作
    providers.ts      generic 模型接口、万擎文本适配、TTS 接口
  tests/
    schema.test.ts
    edl-ops.test.ts
    providers.test.ts
  README.md
  REQUIREMENTS.md
```

挂载：`packages/canvas-workbench/src/packs.ts` 和 `apps/server/src/card-packs.ts`。对应消费包的 package.json 与 pnpm-lock.yaml 登记依赖。未执行 git commit。

## 4. 输入输出接口

### 4.1 本地素材与上传

卡内文件选择只创建临时 Blob URL，不把 File、本机绝对路径或媒体字节写进 `data`。重开需要重新选择文件。

```ts
interface DramaAudioUploadAdapter {
  upload(file: File, signal?: AbortSignal): Promise<{ relativePath: string }>;
}
```

该接口尚未注入到默认 renderer。真实上传须复用宿主授权文件服务；平台已有 `POST /api/projects/:id/upload`，但卡包不直接 fetch 内部 API。云端大视频需先确认目标环境文件上限和获批的分片/直传方案。

### 本地多模态 demo

`pnpm --filter @bezier/canvas-pack-drama-audio demo` 启动显式 local-test 服务，`demo:import` 将 `demo/materials/` 的视频和稿件导入新实例。配音卡是稿件唯一编辑入口，不再创建会漂移的文字卡副本；工程视频通过本包隔离 demo adapter 读取，浏览器加载真实 metadata 后保存时长。此 adapter 仅在 `127.0.0.1`、带 local-test 标记的 demo 卡启用，普通卡包不获得额外宿主能力。

现有 demo 已迁移为两块 `card.drama.audio`：`stage=rewrite` 读取视频和原解说词、编辑内置 prompt，并调用 `rewrite`；`stage=edit` 接收用户确认的逐句稿件和视频区间，执行逐句 VoxCPM 配音、停顿/增益/静音/截取及视频主时钟试听。`demo:repair` 迁移既有实例并保留原音频和稿件，不删除旧资源。

配音编辑卡 UI 扩展（v3.1，data 加可选 `voiceInstruction`，旧卡兜底 null）：台词句默认折叠为摘要行、点击选中句展开完整编辑；时间轴台词块支持拖拽整体平移（保持时长、clamp 0..videoDurationMs，纯函数 `shiftSegmentWindow` 可测）；音色预设下拉+自定义描述（传入 VoxCPM `control_instruction`，全稿与逐句两条链路均读取 `data.voiceInstruction`）；试听倍速 0.5x–2x（设置 video.playbackRate，WebAudio 排程跟随同一倍率，不改变生成音频字节）。拖拽与折叠的浏览器交互尚待 Playwright 实测，不宣称已验收。

改写卡 UI（v3.2）：生成台词逐句折叠为摘要行（点击展开编辑，列表 maxHeight 300px 滚动），不再整卡平铺；新增「画面观测」折叠区展示每帧 OCR/视觉描述（data 加可选 `rewriteObservations`、`rewriteVisionProvider`，旧卡兜底为空不渲染）。折叠/滚动的浏览器交互尚待 Playwright 实测。

视觉改写为两段链路（v3.2）：第一段 `WQ_VISION_MODEL` 只做帧观测——对每张采样帧输出 `{atMs, ocr, visual}`（ocr 如实转录帧内可见文字、visual 客观描述画面），system 强限制为视频帧观测器、不生成不改写不建议任何台词，请求不含原稿与 prompt；观测与采样帧逐一对应，数量/时间戳/空观测不一致即失败。第二段 `WQ_MODEL` 以原稿为台词依据、结合帧观测改写，明确禁止直接把 ocr 文字当台词，水印、平台名、标题、免责声明等非台词文字不得进入台词。需配置 `WQ_API_KEY`、`WQ_VISION_MODEL`、`WQ_MODEL` 和适用 `WQ_API_BASE`，缺任一在发网络前 fail-fast。最多 12 张带时间戳的 320px JPEG，每帧≤100KB、请求≤1.2MB；帧不保存到卡片，观测摘要（每帧 ocr/visual 各≤2000 字符）存入卡片供人工核对。文本步输出严格 JSON 台词列表，1–80句、有序非重叠区间，错误/截断/不可用不得回退 mock。采样帧不等于完整视频或音轨；建议区间必须人工确认。

确认交付记录源卡和 revision；替换已有下游稿件需显式确认，旧音频字节仍保留。逐句 TTS 成功后立即上传和条件回填，输入变化则不覆盖结果；不自动重跑失败或不确定的模型请求。视频是唯一主时钟，源截取与视频区间独立；段后停顿占区间尾部留白，静音不压缩时间，WebAudio 实际应用总/段增益。音频超出区间会标红并裁切试听，不自动拉伸，也不宣称已对齐。统一双轨共用视频时间比例。

本次规范影响：只扩展本包业务数据及 rewrite 动作，demo adapter 限 loopback/local-test；不变更 SDK、宿主、身份或云存储合同。真实浏览器视频解码、抽帧和缺少视觉配置失败路径已验证；万擎真实视觉调用仍待安全配置，逐句 TTS/混音完整验收与云端验收分开报告。

### 4.2 万擎文本配音稿

| 环境变量 | 用途 |
| --- | --- |
| `DRAMA_AUDIO_PROVIDER=wanqing` | 显式选择万擎文本生成；不使用 mock 默认成功 |
| `WQ_API_KEY` | 服务端密钥，通过安全环境配置，不进源码、卡片数据或文档 |
| `WQ_API_BASE` | 可选，默认 `https://wanqing-api.corp.kuaishou.com/api/gateway/v1/endpoints` |
| `WQ_MODEL` | 可选，默认 `ep-7wk3ep-1792046051430404420` |

请求：`POST <WQ_API_BASE>/chat/completions`，Bearer 认证，`messages` 为系统提示和已有 caption/草稿。响应读取 `choices[0].message.content`。办公网/运行环境地址应按实际网络可达性选择。

原文本接口仅确认文本协议；两卡 demo 新增抽帧 `image_url` 请求实现，需视觉模型实际接收验证，不发送本机路径冒充视频输入。

既有兼容入口：`DENSE_CAPTION_API_URL` + `DENSE_CAPTION_API_KEY`、`DUBBING_API_URL` + `DUBBING_API_KEY`。generic caption 当前只发工程引用和时长，必须由真实业务适配器解决媒体访问。响应 schema、总大小、图片 MIME 与域名/重定向限制待加强。

`DRAMA_AUDIO_PROVIDER=mock` 仅限显式隔离测试。mock 是固定描述，不是实际视频推理；来源必须显示 `mock`。

### 4.3 TTS 预留

```ts
interface TtsRequest {
  text: string;
  voiceId: string;
  segmentId: string;
}

interface TtsResult {
  audioRef: string;
  durationMs: number;
  provider: string;
}

interface TtsProvider {
  synthesize(request: TtsRequest, signal?: AbortSignal): Promise<TtsResult>;
}
```

缺省实现抛 `TTS_UNAVAILABLE`。实际接入还需段版本、任务 ID、幂等键、音色/情绪、真实字节存储、音频时长和取消/恢复合同；不能将此最小接口直接当作生产完成。

### 4.4 已注册的 15 个动作

前缀均为 `card.drama.audio.`：

| 动作 | 输入 | 输出/职责 |
| --- | --- | --- |
| attach | audioRef、durationMs、可选 videoRef/videoDurationMs/segments | 初始化媒体引用与段决策 |
| script | script 或 null | 台本文本 |
| upsert | segment | 新增/替换台词段 |
| remove | segmentId | 删除台词段，不删除整张卡 |
| gap | segmentId、gapMs | 段后停顿 |
| gain | gain、可选 segmentId | 总/段级音量决策 |
| mute | segmentId、muted | 静音决策 |
| trim | 可选 startMs/endMs | 配音源裁剪窗口 |
| video | videoRef、videoDurationMs | 视频引用 |
| align | segmentId、可选 videoStartMs/videoEndMs | 视频区间对齐 |
| rebind | segmentId、audioRef 或 null | 段级换源 |
| span | segmentId、可选 startMs/endMs | 配音源段边界 |
| analyze | 空对象 | generic caption provider 结果 |
| compose | 可选 script | 万擎/兼容 provider 配音稿 |
| export | 空对象 | EDL JSON 工程文件及摘要 |

HTTP 调用必须带当前 revision 和唯一幂等键：

```json
{
  "input": {
    "nodeId": "dub-3",
    "params": { "script": "已有画面描述或配音草稿" }
  },
  "expectedRevision": 123
}
```

`expectedRevision` 在顶层。通过 `GET /api/apps/canvas/instances/<id>/state` 读取实际 revision 后调用动作端点，幂等键置于 `idempotency-key` 请求头。此例为信封形状，不是固定可重放测试 revision。

模型结果非确定性；仅纯编辑和 EDL 渲染是确定性的。注册动作可被协议发现，不代表自然语言指令识别或真实 Agent 编排已经验收。

## 5. 待解决问题与实施优先级

| 优先级 | 待办 | 影响/验收出口 |
| --- | --- | --- |
| P0 | 获取获准真实短剧素材、安全配置万擎密钥，确认网络和视频输入协议 | 不能用 mock 宣称真实 dense caption；真实文本和视频理解分开验收 |
| P0 | 宿主注入授权上传、媒体读取 URL 和动作 transport | 本地 File 预览不等于上传；生成按钮需有真实服务端操作通道 |
| P0 | 安装 Playwright 浏览器，补真实解码、播放、定位、拖拽和保存恢复 E2E | 当前仅 HTTP 200/构建证明，不能标浏览器交互通过 |
| P0 | 限制总 data 大小、段/caption 数、缩略图体积，严格 schema 与版本兼容 | 避免 256KB 合同越界、损坏数据、未知字段丢失 |
| P0 | 接入成熟 TTS，定义任务身份/版本/幂等/取消/回填 | 文字编辑才能实际改变声音；失败恢复且不盲目重跑成本任务 |
| P1 | 重构统一时间轴，区分源偏移与视频目标时间，修复 pointer cancel/轨道命中/缩放 | 真实拖拽与音画定位一致；两轨不同时间尺度不能当同步对齐 |
| P1 | 拆分/合并的最短区间、停顿、异源、静音和视频对齐规则 | 不能丢弃后段配音源或创建零时长段；补纯函数及交互测试 |
| P1 | 版本过期状态、音频资源读取、统一主时钟调度和即时混音试听 | 当前增益/静音/换源仅改决策；改稿需提示旧音频过期 |
| P1 | 云函数后台合成、二进制文件适配、导出任务及回执恢复 | `ctx.files` 当前字符串口不能直接存真实视频；输出 MP4 与预览一致 |
| P1 | 主题对比度、卡片布局、虚拟列表和文件/错误反馈 | 长稿件、caption 面板不能溢出；操作状态不是只有颜色 |
| P1 | Appwrite 目标 profile 审批、函数配置、私有存储及真实授权验证 | 云端写入读回、空缓存恢复、权限拒绝与函数网络实测 |
| P2 | 自然语言编辑确认面板、测试集、SUS 与性能阶梯评测 | 首任务 ≤5min、AI 一次成功率 ≥70%、新增单测覆盖 ≥60% 等指标需证据 |

### 5.1 已发现的底座接缝，避免过度概括

- HTTP `node.delete` 等通用操作对白名单外 `card.*` 卡种有拒绝记录；**不能推断画布 UI 删除一定失败**，UI 存在兼容状态写入路径，需分别验证。
- 本包渲染 props 没有现成上传/媒体 transport，但浏览器本地 File/Blob 可预览。服务端 `ctx.files` 有字符串 read/write，不是“完全没有文件读取”。
- 云函数包含完整业务域的制品已打包，但 card.* 的函数内真实可调用性、身份、存储和模型网络要重新验收；历史 503/partial 记录不构成协议永久禁止。
- 普通 handler Error 的标准业务错误转换需核验；失败不得伪装成功，敏感请求/密钥不得进入报错或日志。
- 卡包依然只在允许的包目录和挂载点开发。若需要修改宿主 props、SDK、菜单或云资源配置，提交给资源/代码负责人确认，不绕过冻结区。

## 6. 运行、构建与部署

环境：Node 24、pnpm 10.33.2；新增代码 TypeScript。前端入口源码直出给 Turbopack，服务端入口 esbuild bundle + tsc 声明，包内相对 import 无后缀。

```sh
pnpm install
pnpm --filter @bezier/canvas-pack-drama-audio run build
pnpm guard
pnpm typecheck
pnpm --filter @bezier/canvas-pack-drama-audio run test
pnpm --filter @canvas-workspace/web run build
```

没有额外 lint 脚本时沿用本仓 guard/typecheck，不宣称未执行的检查通过。

当前本地隔离 profile（不是上线方案）：

```sh
CANVAS_STORAGE_MODE=local-test DRAMA_AUDIO_PROVIDER=wanqing \
  pnpm tools-dev run web \
  --data-dir /tmp/drama-audio-runtime-check \
  --daemon-port 17460 --web-port 17580
```

浏览器：`http://127.0.0.1:17580`；本地 API：`http://127.0.0.1:17460`。这是一次演示配置，端口、目录、实例不应成为生产默认。已有 `drama-1/dub-3` 保存数据可能带早期 mock 来源，重开后必须如实展示。万擎缺 `WQ_API_KEY` 时不可用。

正常云端 profile 使用负责人批准的 Appwrite 配置；缺配置、schema 或授权时拒绝，不静默回退本地。云端权威数据不放驻留 Express 容器。

打包 Appwrite 上传闭包（不远端变更）：

```sh
pnpm --filter @canvas/canvas-coi run deploy
```

上传目录：`functions/canvas-coi/.deploy/`。本次生成的临时归档：`/tmp/drama-audio-canvas-coi.tar.gz`。

- 归档 SHA-256：`359873df0fd1419a69086dbecb5adae1c19055ee49180efe6e7c24c9975e3ad7`
- 函数 bundle SHA-256：`7eac7d1d5b4327adb1bc586e3b4d90eb8c9543ba71e7e1546cb4f4652c75f8de`
- 这些摘要属于本次制品快照；源码或重新打包变化后必须重新核对。
- 未上传/激活云端；实际操作按 `functions/canvas-coi/deploy.sh` 运维清单审批执行，不随部署修改 scopes/execute/ACL，保留上一 deploymentId 以回滚。

## 7. 实际证据与未验收项

| 检查 | 当前证据 |
| --- | --- |
| 全仓 guard | 最近执行通过（2021 文件、20 manifests） |
| 全仓 typecheck | 最近执行通过，依赖构建完成后不再以早期缺制品报错当作现存基线问题 |
| 本包 tests | 最近执行 71 用例通过；不等于单测覆盖率 ≥60%，覆盖率尚未测量 |
| 本包 build / apps/server build / apps/web build | 最近执行通过 |
| server/workbench 回归 | 早期版本记录 655/264 用例通过；最新预览改动后未重新执行这两套回归，不当作本次新 UI 证据 |
| 本地实际运行 | 重启后前端/API HTTP 200，能力清单 15 动作，drama-1 数据恢复读回 |
| 万擎协议 | 隔离 HTTP fixture 验证 chat/completions 路径、model/messages/Bearer 和结果不泄露 key；真实万擎调用未执行 |
| 浏览器 UI | Playwright 启动失败：未安装对应 Chromium；真实解码、同步、剪贴板、拖拽及可视效果待验收 |
| Appwrite | 上传闭包生成；未部署/激活，云端业务动作和权限未验收 |
| 完整业务闭环 | 尚未完成：真实视频理解、TTS、混合试听、MP4 导出及真实业务案例缺证据 |

## 8. 比赛交付口径与规范影响

应交付可交互编辑器，不是仅靠脚本跑通的黑盒：人可以定位、审核、修改和手动兜底，Agent 使用同一业务动作服务。易用性 30%、完整度 30%、性能 40% 均需真实场景和指定素材/机器实测；当前不声明全部达标。

本包不改变平台信封协议。新增 data/Provider/上传/TTS 预留属于业务合同扩展，后续接入二进制资源、异步任务、云端部署和深编辑壳时须同步适用合同和资源审批；不能只更新 README 后就宣称规范和部署完整。

[REQUIREMENTS.md](./REQUIREMENTS.md) 保留早期需求与验证历史，其中“恒 ≤256KB”“闭环完成”“所有业务卡 UI 删除失败”等旧描述不得作为当前事实。**本文按实现/已验收/待接入/待验收区分状态，作为当前汇总入口。**
