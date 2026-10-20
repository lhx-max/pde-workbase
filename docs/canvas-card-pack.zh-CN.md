d# 画布卡片包开发规范 v1（FDE 同步开发基线）

> 适用对象：在画布 App 上开发业务卡片的团队（FDE）。
> 本文件是**唯一契约**：照此开发即可并行推进，不需要等通用版实现细节定型。
> 原则：**信封归平台，内容归你**。平台冻结的是「信封」（身份、几何、操作通道、文件口），
> 卡片内容字段是你的黑盒——平台原样存取、永不解析，你随便写、随便改。

协议版本：`canvas-card-pack/v1`。平台承诺：**信封字段只增不改不删**；
破坏兼容的改动只会出现在 v2，v1 行为长期保留。

---

## 1. 你要交付的东西

一个 npm 包（独立仓库、独立发版），内含：

```
@your-team/canvas-pack-yourbiz/
├── src/
│   ├── index.ts            # export default 一个 CardPack
│   ├── cards/
│   │   └── product-card.tsx  # 卡片渲染器（TSX 组件）
│   ├── ops.ts              # 卡片专属动作的 handler（可选）
│   └── schema.ts           # 卡片 data 黑盒的校验（可选但推荐）
├── package.json
└── README.md               # 你的卡怎么建、data 里有什么字段
```

主仓挂载（一期，构建期）：

```ts
// packages/canvas-workbench/src/packs.ts（由你的 PR 只改这一行）
import yourPack from '@your-team/canvas-pack-yourbiz';
export const CARD_PACKS = [yourPack /*, ...*/];
```

二期再做运行时动态挂包，一期不追。

## 2. 命名规范

- **卡片类型 ID**：`card.<团队>.<名称>`，小写连字符，如 `card.acme.product`。
  前缀即归属——你的团队只发自己前缀的 kind，冲突即拒收。
- **动作 ID**：`card.<团队>.<名称>.<动词>`，如 `card.acme.product.refresh`。
- **保留前缀**：`card.core.*`、`node.*`、`edge.*`、`group.*`、`layout.*`、`image.*`、
  `document.*`、`sketch.*`、`storyboard.*`、`video.*`、`page.*`、`workflow.*`、`canvas.*` 归平台。

## 3. 卡片数据协议

一张卡就是画布 state 里 `workbenchBasicNodes` 数组中的一项：

```ts
interface CanvasCard {
  // ── 平台信封（平台管，你只读不写）──
  id: string;                    // 卡内唯一，建卡时由你给定或平台生成
  kind: string;                  // 'card.<团队>.<名称>'
  x: number; y: number;          // 画布坐标
  width?: number; height?: number;
  title?: string;
  projectFilePath?: string;      // 卡片主文件的工程相对路径（见 §6）

  // ── 你的黑盒（你管，平台不解读）──
  data?: Record<string, unknown>;   // 任意 JSON 可序列化内容
  dataVersion?: number;             // 你自己升级 data 结构用的版本号

  // ── 其他字段（选填，平台认识的才生效）──
  // 平台不认识的所有字段都会原样保留、原样带回——
  // 你可以放心在信封平级加自己的顶层字段，不怕被吃。
}
```

**铁律**：

1. `data` 必须是 JSON 可序列化对象（不能有函数、Date、undefined 坑）。
2. 单卡序列化后 ≤ **256 KB**。超出把内容落成文件（§6），卡内只留引用。
3. 平台不校验 `data` 内容；**你自己在包里用 schema 校验**（见 §4.3）。
4. 平台承诺持久化和传输中**保留全部未知字段**——包括 `data` 和你加的平级字段。

## 4. 操作协议（卡片动作）

### 4.1 通用动作（平台已提供，直接用）

`node.create` `node.patch` `node.move` `node.duplicate` `node.delete`
`edge.connect` `edge.disconnect` `group.*` `layout.auto` `canvas.undo` 等——
对你的卡天然生效，不用做任何事。通过 COI 门脸或画布内部 operations 通道提交。

### 4.2 专属动作（你的卡需要自定义行为时）

动作提交形状（走 operations 通道，与通用动作同一条管道）：

```ts
{ type: 'card.acme.product.refresh', nodeId: 'p1', params: { region: 'cn' } }
// 信封字段（nodeId）归平台；params 黑盒归你，平台不解读
```

平台投递给你的 handler：

```ts
// 你的 ops.ts
export function applyRefresh(
  node: CanvasCard,
  params: Record<string, unknown>,   // 黑盒，你自己校验
  ctx: CardOpContext,
): { data?: Record<string, unknown>; files?: FileWrite[] } | void {
  // 返回要 merge 进 node.data 的补丁；抛错 = 动作失败回滚
}
```

`CardOpContext` 给你三个口（§6 文件、§7 通知、当前 revision），不给你别的卡。

### 4.3 校验

- 平台校验信封：`type`/`nodeId` 存在、`params` 是 JSON 对象、动作在你的包里注册过。
- **你**在校验 `data`/`params` 的业务形状——推荐 zod，schema 放包里随版本演进。
- 校验失败抛错，平台转成标准错误信封 `{code:'CANVAS_INVALID_INPUT'}` 返回调用方。

### 4.4 幂等与凭条

每个动作带 `operationId`（幂等键）+ `baseRevision`。平台在**数据层**统一做：
同一 `operationId` 重放返回旧凭条，ID 重用但输入不同 → 409。
你的 handler 只需要是**确定性的**（同输入同输出），不要做自己的去重逻辑。

## 5. 渲染器规范（TSX 挂载）

注册（你的 index.ts）：

```ts
import type { CardPack } from '@bezier/canvas-workbench';

const pack: CardPack = {
  cards: [{
    kind: 'card.acme.product',
    render: ProductCard,
    // 可选：操作 handler 表（动作名去掉 kind 前缀后的后缀 → handler）
    ops: { refresh: applyRefresh },
  }],
};
export default pack;
```

渲染器签名（v1 冻结）：

```tsx
interface CardRenderProps {
  node: CanvasCard;                     // 完整卡片（含你的 data）
  selected: boolean;
  /** 改自己卡的唯一入口：merge 补丁进 node，走通用 operations 通道持久化 */
  onPatch: (patch: { data?: Record<string, unknown>; title?: string;
                     width?: number; height?: number }) => void;
  /** 打开卡片关联文件（如跳工程文件面板） */
  onOpenFile?: (path: string) => void;
}
function ProductCard(props: CardRenderProps) { /* 普通 React 组件，随便写 */ }
```

**约束**：

- 组件必须能被 `React.memo` 安全包裹；不要依赖组件外可变单例。
- 拖拽/缩放/选中/连线把手/右键菜单平台统一画——你只画**卡身内容区**。
- 禁止直接 `fetch` 画布内部 API；要调平台能力走 props 回调。
- 卡片内部的网络请求（打你自己业务后端）允许，带自己的鉴权，失败自兜。
- 暗色/主题：用画布 CSS 变量（`--canvas-*`），不写死颜色。

## 6. 文件与素材

卡片要存文件（图片、文档、导出物）统一走文件口：

```ts
// ctx.files（server 侧 handler 和 CardOpContext 提供）
await ctx.files.write('card-assets/product-p1.json', bytes);  // 存工程相对路径
await ctx.files.read('card-assets/product-p1.json');          // 读
```

- 路径必须工程相对（`/` 开头、无 `..`），建议统一前缀 `card-assets/<kind>/`。
- 落点由平台定（当前 = Appwrite 桶 + `canvas_files` 索引；未来换存储你无感）。
- 大文件（>30MB）本期不支持，等视频方案。
- `projectFilePath` 字段指向卡片「主文件」（可选），有了它卡片在文件面板可见。

## 7. 与画布的交互

你能拿到的就三类通道，都在 props/ctx 里：

| 通道 | 干什么 | 说明 |
|---|---|---|
| `onPatch` | 改自己卡的 data/标题/尺寸 | 唯一写入口，自动进通用持久化+凭条 |
| `ctx.files` | 读写工程文件 | server handler 侧 |
| `onOpenFile` | 通知宿主打开文件 | 渲染侧，可选 |

**不能做的**：读/改别的卡、调画布内部 API、绕开 onPatch 直接改 state、
注册平台保留前缀的 kind/动作。违反 = 包被拒收。

## 8. COI / Agent 接入（自动）

你的动作一旦注册进包：

- 自动出现在 `GET /api/apps/canvas` 的能力清单（管理侧 Agent 可发现）
- 通过 `POST /api/apps/canvas/instances/:id/actions/card.acme.product.refresh` 可被外部调用
- 凭条（`action-receipts`）、幂等、revision 冲突平台统一管

**你不用写任何 HTTP 路由**。

## 9. 版本与演进

- **包版本**：npm semver。画布构建锁定版本，你发新版走正常升级流程。
- **`data` 结构升级**：你自己升 `dataVersion`，渲染器按版本兼容旧数据——
  平台不做迁移，老画布里的卡永远按当时 data 原样返回。
- **协议升级**：本文件升 v2 时提前通知；v1 行为不撤。

## 10. 开发流程

1. 从画布主仓 `feat/zhuzhiheng-da-cloud` 拉分支 `feat/card-pack-<团队>-<业务>`。
2. 新建包 `packages/canvas-pack-<业务>/`（或独立仓库发 npm 包）。
3. 本地起工作台验证（数据走 Appwrite）：

```bash
cd canvas-workspace
pnpm install
APPWRITE_ENDPOINT=... APPWRITE_PROJECT=grworkspace APPWRITE_DATABASE=canvas_app_dev \
APPWRITE_BUCKET=canvas_assets_v2 APPWRITE_SESSION_COOKIE=<问平台要> \
pnpm tools-dev run web --data-dir /tmp/<你的数据目录> --daemon-port 17460 --web-port 17580
# 浏览器开 http://127.0.0.1:17580
```

4. 交付检查清单：
   - [ ] kind/动作全用自己的团队前缀
   - [ ] `data` 黑盒 ≤256KB、JSON 可序列化
   - [ ] 渲染器不写死颜色、能 memo
   - [ ] 卡片动作幂等（重发同 operationId 返回旧凭条）
   - [ ] README 写清：建卡动作、data 字段表、专属动作清单
   - [ ] 构建期挂包只改 `packs.ts` 一行

## 11. 平台侧接缝状态（已接通 / 待补）

**已接通**（代码已在基线分支，可直接用）：

- `registerCardPack`/`packs.ts` 挂载点：未知 kind 的卡片自动走注册表渲染，平台壳（拖拽/缩放/连线/标题栏）照常
- `card.*` 专属动作路由：schema 放行 `card.<team>.<name>.<verb>`，管道分发到注册的 server handler，凭条/幂等/version 冲突全套生效；handler 的 kind 前缀必须等于目标卡 kind，否则 400
- `CardOpContext`：handler 拿 `{projectId, files}`，`files.write/read` 走当前存储后端（文件或 Appwrite）
- 动作自动进 COI 能力清单（`GET /api/apps/canvas` 的 `actions`）和内部 capabilities

**待补**：

| 待补 | 影响 | 临时方案 |
|---|---|---|
| 运行时动态挂包 | 现在构建期打包（改 `packs.ts` 一行） | 一期够用，二期优化 |
| Agent 动作 schema 自动暴露 inputSchema | COI 清单只有 actionId | 文档里自己描述 params |
| `onOpenFile` 宿主回调 | 暂时拿不到 | 一期忽略 |
| Function（canvas-coi）内 card handler 注册 | Function 里 card.* 返回 503 | 一期管理侧只走核心动作 |

## 12. 禁止清单（会拒收）

- 注册平台保留前缀（§2）的 kind/动作
- 直接改平台信封字段（id/kind/x/y 以外的“你的字段”随便加）
- 绕开 `onPatch` 直接改画布 state / localStorage 偷渡持久化
- 自创文件存储（必须走 `ctx.files`/`projectFilePath`）
- 在渲染器里 `fetch` 画布内部 `/api/*`

---

## 附录 A：最小可用卡（照抄改名即可）

```tsx
// src/cards/memo-card.tsx
import type { CardRenderProps } from '@bezier/canvas-workbench';

export function MemoCard({ node, selected, onPatch }: CardRenderProps) {
  const text = String(node.data?.text ?? '');
  return (
    <section className={selected ? 'card selected' : 'card'}>
      <textarea
        defaultValue={text}
        placeholder="写点什么…"
        onBlur={e => onPatch({ data: { ...node.data, text: e.target.value } })}
      />
    </section>
  );
}
```

```ts
// src/index.ts
import { MemoCard } from './cards/memo-card';
export default { cards: [{ kind: 'card.demo.memo', render: MemoCard }] };
```

```ts
// 建卡（通用动作即可，无需专属动作）
await submitAction(instanceId, 'node.create', {
  node: { id: 'memo-1', kind: 'card.demo.memo', x: 100, y: 100,
          title: '备忘', data: { text: '' } },
});
```

## 附录 B：术语

| 词 | 意思 |
|---|---|
| **卡/kind** | 画布上一类卡片，如 `card.acme.product` |
| **信封** | 平台统一管理的卡片字段（id/kind/几何/路径） |
| **黑盒 `data`** | 团队自定义内容区，平台不解读 |
| **动作/op** | 对卡片的一次操作，走 operations 通道 |
| **凭条/receipt** | 动作执行结果的回执，幂等重放依据 |
| **COI 门脸** | `/api/apps/canvas/*` 统一应用协议入口 |
