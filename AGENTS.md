# Canvas Workspace — independent extraction

## App 后端部署位置（2026-10-23 用户确认）

- 四个 App（画布、文档、草图、生图）的业务后端部署在 Appwrite Functions，业务数据和文件保存在 Appwrite 数据库及各自的桶中。
- DA 部署容器承载宿主前端与必要的接入代理，不把四个 App 的常驻业务后端放进该容器作为上线方案。
- 本地独立服务只作开发、调试或隔离验证；此前将完整业务改走独立 Express 服务、将云函数降为 partial 的方案不再作为目标架构。
- 将已验收能力适配回云函数时保留身份、租户、版本、幂等、恢复及私有存储要求；不盲目回退旧代码，也不把函数已存在当作功能已完成。

零背景开发者先读 `.devin/skills/designai-app-platform/docs/app-development-handbook.zh-CN.md`，按任务加载专项合同；新 App 使用该技能包的 `templates/APP_CONTRACT.template.md` 形成自己的开发/验收合同。包安装、模拟登记、正式接入、Agent 调用与 staging 分开报告；规范审计和实际待补项见 `docs/app-development-standards-audit.zh-CN.md`。

> **必读规范入口（任何 AI / Agent 进仓先读）**：`.devin/skills/designai-app-platform/` 技能包——[`SKILL.md`](./.devin/skills/designai-app-platform/SKILL.md) 主入口（卡片包开发、App 互联协议、COI 接口、冻结区、分支规则、Agent CLI），规范文档在 [`docs/`](./.devin/skills/designai-app-platform/docs/)：[`app-development-spec.zh-CN.md`](./.devin/skills/designai-app-platform/docs/app-development-spec.zh-CN.md)（新 App 通用开发规范，事无巨细，含统一合同 P1–P24 + 合规自检表）、[`canvas-card-pack.zh-CN.md`](./.devin/skills/designai-app-platform/docs/canvas-card-pack.zh-CN.md)、[`canvas-app-interop.zh-CN.md`](./.devin/skills/designai-app-platform/docs/canvas-app-interop.zh-CN.md)、[`data-model.zh-CN.md`](./.devin/skills/designai-app-platform/docs/data-model.zh-CN.md)、[`canvas-card-capability-matrix.zh-CN.md`](./.devin/skills/designai-app-platform/docs/canvas-card-capability-matrix.zh-CN.md)。

规范维护：涉及协议、身份/权限、权威存储、资源、制品或验收边界的开发，须在同一交付中给出规范影响判断并同步适用合同/模板/资源目录。负责人、仓库、文档及Appwrite用途/审批统一见 `.devin/skills/designai-app-platform/docs/platform-resource-catalog.zh-CN.md`；资源访问按归属仓库负责人审批。

This is a standalone repository extracted from Bezier/Loom commit `319e5eee556a3641d2ee68a6111a36ddc7a1eff7`. Do not import, symlink, or resolve runtime resources from the original checkout. Keep the upstream Apache-2.0 license and record adapted source provenance.

## Product boundary

Preserve the original canvas workspace UI, CSS, interaction and data behavior; do not redesign it. Include top tabs, project assets, text/sketch/clip/browser surfaces, previews, canvas APIs, JSON, files, artifact organization and delivery. Include the original Canvas / Assets / Collect sidebar and a standalone local asset library with real folders, metadata, versions, management and canvas import/save operations. The user explicitly selected this built-in local library after the initial extraction. Exclude the original chat product UI/runtime and original account/team platform. The user approved an MF SDK integration: keep its React 19 UI in the isolated MF document (expected path `apps/mf-ui`, which is absent from this checkout), served on exact reserved `mf.localhost`, a different loopback origin from the `127.0.0.1` canvas through the same app-owned listener. Do not restore MF's plain localhost hostname or proxy `/sso-health`: that SDK development branch extracts a browser-side SSO token. Connect through versioned contracts and authenticated adapters; never import MF into the canvas component tree or allow its document host to reach normal canvas APIs. Canvas package/typing constraints remain React 18; Next App Router supplies its own renderer, so record actual browser renderer versions separately from installed peers. Server-side MF credentials are single-user, local-only; shared/public reverse-proxy deployment is unsupported. The local canvas and asset library remain authoritative; unconfigured MF is explicitly unavailable. Reuse the original asset UI and injected-storage core; external asset libraries remain replaceable adapters. Agent execution, browser hosts and authorization belong behind adapters. Unconfigured capabilities must report an explicit unsupported/unavailable result; never fake success.

## Layout and commands

External host integration is app-owned: adapt our packages, Provider adapters and deployment manifests to the host's published contract. Do not modify another owner's host, shared SDK, menus or Agent orchestration to make integration pass. Static component installation, backend application registration and real Agent invocation are separate acceptance gates; see `.devin/skills/designai-app-platform/docs/app-development-spec.zh-CN.md` §4.6.

- `apps/web`: extracted React/Next workspace and app-local host adapters.
- `apps/server`: independent canvas/file/task/preview/export HTTP service and CLI.
- `packages/canvas-workbench`, `workbench-core`, `workbench-ui`: original canvas and workflow UI/domain packages.
- `packages/components`, `contracts`, `host`, `release`: shared dependency closure, to be narrowed without breaking compatibility.
- `tools/dev`: standalone lifecycle entrypoint, called by `pnpm tools-dev`.
- `e2e`: real HTTP and Playwright integration checks.
- Root scripts are checks or tools only. Use package-scoped build/test commands, not root build/test aliases.

Use Node 24 and pnpm 10.33.2. New source, tooling and tests are TypeScript. Existing upstream build `.mjs` files are retained compatibility artifacts, not a reason to add new JavaScript source. Tests belong in package-level `tests/` siblings of `src/`; UI automation belongs in `e2e/ui/` with lifecycle fixtures. Run `pnpm install` after package changes, then `pnpm guard`, `pnpm typecheck`, package tests/builds and actual runtime checks.

## Safety and data

**2026-10-21 用户确认：后续开发以 Appwrite 云端为默认运行与验收环境。** 画布状态、业务资源和必须持久化的绑定/恢复信息不得默认仅落本地；缺少云端配置、凭据或 schema 时明确报不可用，不静默回退本地并宣称成功。本地文件模式仅供显式隔离测试，可丢弃缓存/临时工作目录不是权威存储，本地通过不算云端通过。项目菜单、身份/组织及宿主实例目录沿用一涵基座合同，不另建一套；App 只保存自己的业务数据和必要映射。历史源码仍有本地实现与未闭环的云端接缝，这条要求不代表它们已完成改造。桌面 `canvas-data` 旧联调数据已按用户授权丢弃，不重建该目录或重新启用引用它的旧 LaunchAgent。

The independent server receives an explicit resolved data root from its entrypoint. Services must derive storage from that root or explicit constructor arguments; never refer to the upstream checkout or infer a data root from cwd. Do not weaken path traversal/symlink checks, preview sandboxing, native browser grants, target revisions, idempotency or cancellation. Backend application code must not import frontend private implementation, or vice versa; shared DTOs go in pure contracts. Do not migrate unrelated upstream features merely to satisfy imports.

## Evidence

`docs/feature-parity.md` tracks completeness; copied or compiled is not verified. Record test/build/runtime evidence and limitations, especially browser native capabilities, ffmpeg availability, delivery recovery and multiple workspace instances. No co-author commit trailers.

## Session-apps 站点级 Agent 侧栏（2026-11-22，已移除）

用户验收后明确「没有用，删除」，站点级 Agent 对话侧栏（`agent-dock.tsx`、`workbench.module.css` 的 `.agentRail*`/`.agentPanel*`、`tests/session-agent-dock.test.tsx`）已于同日整体移除；`client.tsx` 不再挂载入口，画布上的 Agent 冒烟测试卡（`card_assist_*`）也已删除。后端 `/api/ma-v/agent/run`（`ma-client.ts`/`agent-runs.ts`/SSE 路由）为仓库既有实现，保留未动，MA 未配置时依旧显式 `AGENT_UNAVAILABLE` 不假成功。卡片内 CLI 助手与其受控动作通道独立存在，见下节。

## Session-apps 卡片 Agent 受控动作通道（2026-11-22）

用户授权后落地：卡片 Agent（`myflicker` CLI，保持 plan 只读模式）现在可以**驱动画变更**。链路：`cli-assistant.ts` 每次询问附带 `scene`（卡片 id/kind/标题/坐标/字符串 data 截断）→ `agent-assist` 路由把卡片清单写入 CLI 提示词 → CLI 回答末尾输出 ```canvas-actions 受控动作块（CLI 本身仍无写权限）→ 服务端 `canvas-actions.ts` 校验后单次 PATCH `/api/projects/:id/canvas/state`（expectedRevision 乐观锁）→ 回复附`[画布动作回执]`。动作白名单：`update_card`（cardId 必须真实存在）、`create_card`（仅 `card.drama.audio`）；data 浅合并 ≤16KB；409 冲突全部记失败、不自动重试。真实链路冒烟通过：CLI 提议 create_card → 画布 revision 前进、新卡 `card_assist_*` 落状态、页面 1.5s 轮询自动显示。测试：`apps/web/tests/canvas-actions.test.ts`。

## 卡片 Agent 动作通道 v2：platform operations（2026-11-22）

用户要求「不做建议直接修改」并覆盖视频/音频导入、配音生成/编辑、变速、变音色后，动作通道升级为**平台 operations 批量**：`canvas-actions.ts` 把 CLI 动作映射为 `node.create/node.move/node.rename` 与 `card.drama.audio.<verb>`（经 POST `/api/apps/canvas/instances/:projectId/operations`，幂等凭条 + baseRevision + 卡片类型门禁由画布服务端统一裁决，不再手捏状态覆盖）。动作集：`create_card`、`update_card`（title/x/y）、`card_op`（op 白名单=卡包 `dramaAudioOps`：attach/script/upsert/remove/gap/gain/mute/trim/video/align/rebind/span/voice/speed/analyze/compose/rewrite/export/export-srt）、`import_media`（node.create+attach 双轨导入，工程文件存在性经 HEAD `/raw/` 校验）。卡包新增确定性 op：`voice`（voiceInstruction/lineVoiceInstructions 覆盖，null 清除）与 `speed`（segment speed/fitSpeed，0.5–2，1=清除）；`DramaAudioData.lineVoiceInstructions` 进入 data 类型。诚实边界：真实 TTS 音频合成仍未接入（`unavailableTtsProvider` → 显式 TTS_UNAVAILABLE；本地 VoxCPM 未部署），analyze/compose/rewrite 需要 WQ_API_KEY。E2E 冒烟（CLI attach→speed→voice 三连）已通过并落画布真实状态。注意：`packages/canvas-pack-drama-audio` 服务端消费 `dist/server.mjs`，改卡包 op 后必须 `pnpm --filter @bezier/canvas-pack-drama-audio build` 并重启 canvas server（原 dev 进程为 `CANVAS_STORAGE_MODE=local-test node apps/server/dist/cli.js run --port 17456 --data-dir /tmp/canvas-data-dev`，须 Node ≥22.13，本机用 nvm node 24.22.2）。

## import_media v3：本机文件导入与时长探测（2026-11-22）

用户实测发现导入通道不完备（纯视频被拒、无法从本机导入）后补全：`import_media` 现支持三种形态——纯音频（`audioRef+durationMs`，attach）、纯视频（`videoRef+videoDurationMs`，`card.drama.audio.video`）、双轨（`audioRef+videoRef`，attach）；新增 `src`（本机绝对路径，扩展名白名单 + 512MB 上限）：服务端经 `fs.openAsBlob` 复制上传进工程（音频 `outputs/voice`、视频 `inputs`），时长由容器解析自动探测——mp4/mov 走 moov/mvhd（32/64 位版本）、wav 走 fmt+data 块（`probeMediaDurationMs`），探测失败时要求显式提供 durationMs，不假成功。真实视频 E2E：11595855B mp4 → `inputs/念念有回响_*.mp4`，自动探测 173477ms，新卡绑定完成。间接依赖：本机无 ffprobe/ffmpeg，探测为自研盒解析（mkv/webm 暂不支持自动时长）。
