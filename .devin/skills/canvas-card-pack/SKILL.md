---
name: 画布卡片包开发
description: 画布 App 业务卡片（Card Pack）开发入口。Use when 用户要"开发画布卡片/卡片包/card pack/新建一种卡片/FDE 业务卡片/画布自定义节点/卡片挂载/卡片动作"或要在画布上加一种新的卡类型（商品卡/数据卡/业务卡等）。负责指引按契约 v1 产出可挂载卡片包；不负责通用画布引擎本身的开发（那是平台侧）、不替你定业务字段。
version: 1.0.0
---

# 画布卡片包开发

一句话：**卡片 = 一个 npm 包（TSX 渲染器 + 可选动作 handler），按 `card.<团队>.<名>` 命名挂载**。

**契约真源**：[`docs/canvas-card-pack.zh-CN.md`](../../../docs/canvas-card-pack.zh-CN.md)——本技能是操作指引，字段细节一律以契约文档为准，冲突时改契约不改技能。

## 开工前必读（按顺序）

1. `docs/canvas-card-pack.zh-CN.md` §1–§3：交付形态、命名规范、卡片数据协议
2. §11 平台待补清单：确认你要用的接缝平台已接上
3. 附录 A 示范卡：最小可用实现，照抄改名

## 铁律（违反 = 包被拒收）

- **信封归平台，内容归你**：`data` 黑盒随便写（JSON、≤256KB）；平台信封字段只读
- **改卡只走 `onPatch`**：不直接改画布 state、不 localStorage 偷渡、不 fetch 画布内部 `/api/*`
- **命名带前缀**：kind 和动作全部 `card.<你的团队>.<名>`，保留前缀列表见契约 §2
- **文件统一口**：`ctx.files`/`projectFilePath`，禁止自创存储
- **动作要幂等**：同输入同输出，去重平台管

## 开发流程

1. **建分支**：`feat/card-pack-<团队>-<业务>`，从 `feat/zhuzhiheng-card-pack-base` 拉
2. **建包**：`packages/canvas-pack-<业务>/`（或独立仓发 npm 包），结构见契约 §1
3. **写卡**：TSX 渲染器实现 `CardRenderProps`（node/selected/onPatch/onOpenFile）
4. **挂包**：`packages/canvas-workbench/src/packs.ts` 加一行（一期构建期挂载）
5. **本地验证**：

```bash
pnpm install
APPWRITE_ENDPOINT=... APPWRITE_PROJECT=grworkspace APPWRITE_DATABASE=canvas_app_dev \
APPWRITE_BUCKET=canvas_assets_v2 APPWRITE_SESSION_COOKIE=<问平台要> \
pnpm tools-dev run web --data-dir /tmp/<数据目录> --daemon-port 17460 --web-port 17580
# 浏览器 http://127.0.0.1:17580，node.create 建卡看渲染
```

6. **交付检查**（契约 §10 清单）：前缀、data 大小、memo 安全、幂等、README 三件套（建卡动作/data 字段表/动作清单）

## 常见坑

- **「我的卡渲染不出来」**：先查 kind 前缀对不对、`packs.ts` 挂没挂、数据里 `kind` 字段和注册名一不一致
- **「改了 data 画布没变」**：你绕开 `onPatch` 直接改了 node——补丁必须过 onPatch 才进持久化
- **「动作 404」**：动作名没带全前缀，或没在包的 `ops` 表里注册
- **「卡数据丢了」**：data 超过 256KB 被截/拒；大内容落 `ctx.files`，卡里存路径
- **审批/字段细节未定**：全塞 `data` 黑盒，平台不认得的字段原样保留——别把"未定"当阻塞

## 边界

- 通用卡片（text/image/sketch/storyboard/video/page/presentation）的修改是平台侧的活，不走本技能
- 卡片要的业务后端是你的事，平台只提供画布内通道（onPatch/files/动作）
- 视频大卡（>30MB）本期不支持
