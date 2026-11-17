# 短剧导演工作台与配音卡

短剧导演工作台用于接手已有视频、解说词和配音，定位到一句，调整文字、声音或视频区间，再对着画面试听。工作台位于 `/session-apps`，逐句编辑直接写回当前画布项目里的配音编辑卡。

## 启动本地 demo

需要 Node 24 和 pnpm 10.33.2。从仓库根目录执行以下命令。每次复制都会得到独立的演示数据目录。要继续之前的编辑，请把 `DRAMA_DEMO_DATA` 指向上次使用的目录。

```sh
pnpm install --frozen-lockfile
pnpm --filter '@canvas/server...' --filter '@canvas-workspace/web^...' -r --if-present run build

export DRAMA_DEMO_DATA="$(mktemp -d "${TMPDIR:-/tmp}/pde-drama-demo.XXXXXX")"
cp -R packages/canvas-pack-drama-audio/demo/runtime/. "$DRAMA_DEMO_DATA/"

CANVAS_STORAGE_MODE=local-test DRAMA_TTS_ENABLED=1 \
  pnpm tools-dev run web --data-dir "$DRAMA_DEMO_DATA" \
  --daemon-port 18456 --web-port 18573
```

- [打开短剧导演工作台](http://127.0.0.1:18573/session-apps)。进入后从台词列表选择一句开始编辑。
- [打开随仓画布「念念有回响」](http://127.0.0.1:18573/?projectId=drama-demo-5d85c5e8-5a1a-4ee6-be99-557ab015ec42)。原始快照带素材和旧版全稿配音，逐句台词需在改写卡生成并交付。
- 若已使用其他端口启动，请用实际 Web 端口打开链接。启动器在终端运行，`Ctrl+C` 会结束本次 Web 和 API 服务。另行启动的 TTS 服务由其启动方式管理。
- 独立创建样例时，可在服务运行后执行下方命令，再用返回的 `projectId` 打开画布。工作台内输入 `打开项目 <名称或项目 ID>` 可切换到该样例。

```sh
CANVAS_SERVER_URL=http://127.0.0.1:18456 \
  pnpm --filter @bezier/canvas-pack-drama-audio demo:import
```

### 配置可选模型

在启动服务前设置环境变量。查看已有稿件和调整时间区间可以直接在本地进行。

| 能力 | 所需配置 |
| --- | --- |
| 采样并改写 | 服务端设置 `WQ_API_KEY`、`WQ_VISION_MODEL`、`WQ_MODEL`。按网络环境设置 `WQ_API_BASE`，默认走万擎 HTTPS 网关。改写先对采样帧做 OCR 和画面观测，再结合原稿生成解说与建议区间。 |
| 生成本地配音 | 设置 `DRAMA_TTS_ENABLED=1`。可以复用已在 `http://127.0.0.1:8808` 运行且提供 `/generate` 的 VoxCPM Gradio 服务。由 demo 启动 TTS 时，还需设置 `DRAMA_TTS_PYTHON`、`DRAMA_TTS_APP`（`app.py`）和 `DRAMA_TTS_MODEL` 的绝对路径。模型文件和 Python 环境需要单独准备。 |
| 工作台自然语言对话 | 服务端设置 `MANAGED_AGENT_BASE`、`MANAGED_AGENT_ID`、`MANAGED_AGENT_TENANT`、`MANAGED_AGENT_COOKIE`，可选 `MANAGED_AGENT_MODEL`。本地项目切换和导入指令可以独立使用。 |

密钥和 Cookie 由服务端环境读取。生产存储与部署要求见 [仓库说明](../../AGENTS.md#safety-and-data)；上述命令用于本地隔离 demo。

## 实际操作

1. 打开已有项目。工作台默认读取随仓样例，也可以在左侧输入 `打开项目 <项目 ID>`。已有逐句台词和配音的项目可直接开始编辑。
2. 项目只有原稿时，在画布的改写卡点击「采样视频并改写」。展开台词核对文案和建议区间，点击「确认交给配音编辑卡」。交付新稿会替换下游稿件并清空其配音引用，有已有配音时会提示确认，音频文件仍留在项目中。
3. 点击音轨或列表中的一句，视频会定位到对应位置。可以编辑文字、音色、音量和静音。拖动片段中部移动区间，拖动边缘调整起止，或者在详情中输入毫秒后按 Enter。新增、删除、文本和音轨调整可通过工作台的「撤销」「重做」恢复。
4. 点击「生成本句配音候选」，用「本句同步试听」和「同步试听候选」比较两版，再决定「采用候选」或「放弃候选」。点击「补齐缺失配音」会直接写回缺音频的句子。已有音频需要更新时，可逐句生成候选。
5. 核对当前配音、待更新和区间确认状态后，选择「导出混音 WAV」或「导出台词 SRT」。混音跟随当前采用的配音、视频时间、原声开关、音量、静音、源截取和停顿。试听倍速用于审听，导出按原视频时长生成。字幕从逐句台词和视频区间生成。若有待检查项，工作台会在导出前提示。

已有素材可以依次「导入主视频」「导入台词」「导入整轨配音」。TXT 或 MD 每行一句，导入后进入逐句列表。与原稿句数相同会保留已有区间，句数变化时会生成可调整的建议区间。整轨配音以文件起点对应视频起点，逐句按视频区间取音。选中一句后可以「替换本句音频」。

| 能力 | 当前运行边界 |
| --- | --- |
| 保存 | 工作台先保留草稿并串行提交，读回后显示已保存。冲突时可以重试、导出草稿或读取最新。撤销和重做与当前页面会话关联。 |
| 预览 | 单句与候选可以直接同步试听，浏览器按需载入音频。音频超过区间时会提示并裁切试听。 |
| 导出 | 工作台导出 WAV 和 SRT，WAV 支持 15 分钟以内的视频。卡片动作 `card.drama.audio.export` 仍可输出 EDL JSON。工作台支持浏览器录制 MP4 和剪辑交接包；MP4 依赖浏览器 H.264/AAC 编码能力，录制时保持页面在前台。 |
| 云端运行 | 本地演示媒体、模型和编辑链路按隔离环境运行。Appwrite 权威存储、权限和云端生成需单独验收。 |

## 开发入口

- [导演工作台](../../apps/web/app/session-apps/client.tsx) 提供视频预览、音轨和项目内编辑。[逐句编辑组件](src/dubbing-editor.tsx) 同时用于工作台和画布。
- `card.drama.audio` 的 [服务端注册](src/server.ts) 和 [动作](src/ops.ts) 包含 `rewrite`、`start-tts`、`export` 及基础 EDL 操作。调用卡片动作时使用当前 `expectedRevision` 和 `idempotency-key` 请求头。EDL 记录源音频截取、视频区间、增益、静音和停顿。
- [本地 demo 适配器](src/demo-adapter.ts) 通过 `127.0.0.1` 和显式 `local-test` 项目读取素材、交付台词与生成配音。[REQUIREMENTS.md](REQUIREMENTS.md) 保留早期需求记录。
- `demo:repair` 是旧样例的迁移脚本，会写入默认 API 端口 `17456` 上符合条件的本地项目。新样例和一般启动流程使用上面的启动及导入命令。

```sh
pnpm --filter @bezier/canvas-pack-drama-audio test
pnpm --filter @bezier/canvas-pack-drama-audio typecheck
pnpm --filter @bezier/canvas-pack-drama-audio build
```

## 专业编辑交互（本地隔离验证）

- 左侧素材与助手、中间视频与音轨、下方台词列表、右侧属性共用同一工程。拖动分隔线调整尺寸，双击恢复默认；布局和轨高在当前浏览器保存。
- 台词精修、音频剪辑、混音检查三种布局预设。选择轨道名称显示轨道音量（dB）与独听，选择台词显示本句属性。
- 音轨展示从实际音源解码得到的波形；加载或解码失败会显示状态，不以装饰波形代替。
- 点击标尺定位播放头；片段中部拖动移动，边缘拖动同时裁剪音频源与画面区间。原音频保留，可撤销或在原范围内延长边缘。
- 在有效声音内按 S 分割，再确认两段对应的台词；文字分句为人工指定，不代表已完成词级声音对齐。支持复制、在空白位置粘贴和删除，其他片段位置保持不变。
- 右键片段显示剪辑菜单；空格播放/暂停，⌘/Ctrl C/V 复制粘贴，⌘/Ctrl Z 撤销，Shift + ⌘/Ctrl Z 重做。输入框保留正常文字编辑行为。
- 以上为本地隔离试运行能力。交叉淡化、词级对齐、自动降噪、响度分析及后台导出尚未实现；不代表云端验收完成。
