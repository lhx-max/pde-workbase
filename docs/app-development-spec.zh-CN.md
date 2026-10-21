# App 开发规范（通用）

> 给要**从零开发一个新 App** 的人或 Agent。参考实现：`designai-app-doc`。
> 配套：`canvas-app-interop.zh-CN.md`（画布↔App 协议）、`canvas-card-pack.zh-CN.md`（卡包契约）、根 `SKILL.md`。

---

## 〇、一个 App 是什么

**App = 一个自带前端 + 后端 + 存储的完整小产品。** 它不依赖画布就能独立启动、独立使用；接进画布后，画布里的卡片可以打开它做深度编辑，管理侧 Agent 可以像调画布一样调它。

一个 App 由三块组成：

```
┌─────────────────────────────────────────┐
│  App（例如 doc 文档编辑器）                │
│                                         │
│  前端   React 组件 → 打成 npm 包交给画布    │
│  后端   自己的 API 服务（Express/等价物）    │
│  存储   自己的 Appwrite 库 + 桶            │
└─────────────────────────────────────────┘
        ↑ npm 包（组件嵌进来）
        ↑ 统一 API（Agent 调用）
        ↑ 文件通道（和画布交换内容）
     画布 / 管理侧 Agent
```

- **前端**：React 写的编辑器界面，最终以 **npm 组件包** 的形式交给画布（或其他宿主）嵌进去用
- **后端**：自己的 API 服务，管自己的业务逻辑和数据读写
- **存储**：自己的 Appwrite 库和桶（见 §三）

---

## 一、仓库结构与命名

```
designai-app-<appId>/
├── apps/
│   ├── server/            # 后端：协议 API + 自有业务 API
│   └── web/               # 前端壳：独立运行时用的页面
├── packages/
│   └── <app>-surface/     # npm 组件包：交给画布/宿主嵌入的 React 组件
├── functions/<app>-api/   # 可选：同一套后端打包成 Appwrite Function
└── docs/, scripts/        # 文档、云资源初始化脚本
```

| 项 | 规则 | doc 示例 |
|---|---|---|
| appId | 小写单词，全局唯一 | `doc` |
| 仓库名 | `designai-app-<appId>` | `designai-app-doc` |
| 组件包名 | `@<appId>/surface` | `@doc/surface` |
| 服务端口 | 每个 App 一个，登记 | `19000` |
| Appwrite 库 | `<appId>_app_dev` | `doc_app_dev` |
| Appwrite 桶 | `<appId>_assets_v2` | `doc_assets_v2` |
| 环境变量前缀 | `<APPID>_` | `DOC_REGISTER_TO` |

已占用端口：canvas `17462`、sketch `17610`、doc `19000`。新 App 用新端口并补进本表。

技术栈固定：TypeScript + React 18 + Express + Node 24 + pnpm 10.33.2。

## 二、前后端自闭环（硬性要求）

**App 不依赖画布就能跑，这是底线。** 验收方式：把 App 单独启动，不配置任何画布相关的环境变量，它的核心功能必须可用（doc 不配画布也能建文档、编辑、保存）。

自闭环要求：

- 后端启动不需要画布在场
- 前端壳 `apps/web` 能独立打开并使用编辑器
- 存储用自己的 Appwrite 或本地降级，不读画布的任何数据
- 和画布相关的配置（`CANVAS_ORIGIN`、`<APP>_REGISTER_TO`）**全部是可选的**——配了就接上画布，不配就独立跑

## 三、存储规范

**你的数据存你自己的地方。** 每个 App 有自己的 Appwrite 库和桶，画布的数据存在画布自己的库和桶里——两边不互相进对方的数据库，要交换内容只走 API（文件通道，见 §七）。

用大白话说：各管各的仓库，要货走传送带（API），不许直接去对方仓库搬。

### 3.1 卡内容的存储归属（宿主卡 vs App 自有数据）

「App 自己的数据存自己库」指的是 **App 独立产物**（比如用户在 doc 首页自建的一篇文档）。**画布上卡的内容是另一回事——它是画布实例的资产**：

- **正文唯一真相 = 画布实例文件区**（如 `sources/text/<nodeId>.md`）。卡内容是「卡的资产」，生命周期跟卡走：快照带它、导出带它、删卡清它、换 App 实现它还在
- **App 不吞卡内容**——你编辑卡内容时经文件通道（`GET/PUT .../instances/:id/files?path=`）读写宿主这份文件，**不许把卡正文复制进自己的私有库**（否则卡就不再自包含、换 App 就丢内容）
- 宿主画布 JSON state 里存的 `text` 是**内容镜像**（渲染/搜索用），`projectFilePath` 是文件指针；双向同步由画布做，**文件为准**
- 所以 App 私有库里只有两类东西：用户在你界面里**独立创建**的文档、你的应用配置/索引——**不含任何画布卡的正文**

存储两层模式：

- **索引集合**：Appwrite collection 存元数据（`{ name, path, fileId, size, updatedAt }`）
- **桶**：Appwrite bucket 存内容字节，fileId 用内容 hash 派生，天然去重

**本地降级**：没配 `APPWRITE_ENDPOINT` 时用本地文件存储也能跑，不许报错、不许假装上了云。

连接配置（固定环境变量名）：

```
APPWRITE_ENDPOINT=https://frontend-cloud.corp.kuaishou.com/v1
APPWRITE_PROJECT=grworkspace
APPWRITE_DATABASE=<appId>_app_dev
APPWRITE_BUCKET=<appId>_assets_v2
APPWRITE_SESSION_COOKIE=a_session_grworkspace=<值>   # 整串 cookie 对，只传值会 401
```

## 四、通用 API 规范（每个 App 都要实现的面）

这是所有 App 对外的**统一接口面**——管理侧 Agent 只要学会这一套，就会调所有 App。分两层：

### 4.1 自有业务 API

App 自己领域的接口（doc 的 `/api/documents` 列表/读写/导出）。形状自己设计，但响应包格式必须遵守 §五，未实现的能力显式返回 `501`，不许装死或假成功。

### 4.2 统一协议合同（v1，唯一标准）

这是整个体系的**唯一 API 标准**——画布和所有 App 用同一副骨架，管理侧 Agent 学会一套就会调全部。画布、doc、sketch、browser、未来的 App 一律按此实现；历史 DA 交付形状（`/api/canvases`）作废，能力由本合同吸收。

**目录与接入**

| # | 端点 | 级别 | 干什么 |
|---|---|---|---|
| P1 | `GET /api/apps` | 必须 | 目录：列出所有已注册 App（调用方在宿主/画布侧调） |
| P2 | 启动时 `POST <宿主>/api/apps/register` `{appId,name,endpoint,webUrl?,description?}` | 必须 | 自注册：告诉宿主「我上线了，在这个地址」。`endpoint` 是协议/API 面地址；`webUrl` 是**你自己前端页面的地址**（宿主「打开 App 详情页」时跳它，不填退化到 endpoint）。**注销**：宿主侧 `DELETE /api/apps/<appId>` 把 App 从目录移除——此后它的卡片从所有「+」菜单消失、页签「+」不再列出它；`canvas` 自身不可注销 |
| P3 | `GET /api/apps/<appId>` | 必须 | 能力清单：我是谁、我编辑什么卡、我有哪些动作、事件流在哪 |
| P4 | `POST /api/apps/<appId>/open-editor` `{nodeId,filePath,canvasId?}` → `{openUrl}` | 编辑器 App 必须 | 收「打开我编辑这张卡」的请求；配套 `GET ?nodeId=` 可查回话 |

**实例与状态**

| # | 端点 | 级别 | 干什么 |
|---|---|---|---|
| P5 | `GET /api/apps/<appId>/instances` | 应当 | 实例列表 |
| P6 | `POST /api/apps/<appId>/actions/<app>.create` `{input:{name?}}` | 应当 | 建实例（App 级动作） |
| P7 | `GET /api/apps/<appId>/instances/:id/state` | 必须 | 实例当前状态（含 `revision`/`eventCursor`） |
| P8 | `GET /api/apps/<appId>/instances/:id/revision` | 可 | 只拿版本号 |
| P9 | `GET /api/apps/<appId>/instances/:id/context` | 可 | 实例摘要（Agent 读的轻量上下文） |
| P10 | `GET /api/apps/<appId>/instances/:id/nodes/:nodeId` | 可 | 单实体读取 |
| P11 | `GET /api/apps/<appId>/instances/:id/nodes/:nodeId/history?limit=` | 可 | 实体历史 |

**写操作（统一动作模型）**

| # | 端点 | 级别 | 干什么 |
|---|---|---|---|
| P12 | `POST .../instances/:id/operations` `{operationId,baseRevision,operations[]}` | 画布必须；其他 App 有批量语义时必须 | **批量原子提交**，1–100 个操作一个版本——写操作的正形 |
| P13 | `POST .../instances/:id/actions/:actionId` `{input,expectedRevision}` + `idempotency-key` 头 | 应当 | 单操作糖 = 批次为 1；manifest 声明的每个 actionId 必须有路由，**声明没实现 = 不合规** |
| P14 | `GET .../instances/:id/operations/:operationId` 或 `.../action-receipts/:receiptId` | 应当 | 回执查询：网络结果不确定时先查这里不重发 |
| P15 | 实例生命周期动作 `<app>.rename`/`<app>.delete`/`<app>.duplicate` | 应当 | 挂在 P13 动作入口下，不走 REST DELETE |

**文件与交换**

| # | 端点 | 级别 | 干什么 |
|---|---|---|---|
| P16 | `GET/PUT /api/apps/<appId>/instances/:id/files?path=` | 必须 | 读写我这个实例的文件，响应 `{data:{content}}` |
| P17 | `GET/PUT /api/apps/<appId>/canvas/:canvasId/files?path=` | 编辑器 App 应当 | 画布文件桥：后端转发到画布文件通道，前端不用直接知道画布地址 |

**事件与权限**

| # | 端点 | 级别 | 干什么 |
|---|---|---|---|
| P18 | `GET .../instances/:id/events?after=<cursor>` | 画布已实现；其他 App 二期 | SSE 变化流：`ready` → 实体增删改；`resync:true` 时先重读 state |
| P19 | `GET /api/apps/<appId>/permissions` | 必须 | 团队权限口；未接入返回 `501 + {available:false, reason}`，**不许编造权限服务** |
| P20 | `.../instances/:id/snapshots*` | 二期 | 快照 CRUD+恢复；未实现时 manifest 标 `available:false` |

> 「必须」= 没有它插不进体系；「应当」= Agent 的统一调用面；「可」= 有就给、没有不强求；「二期」= 可缓但要诚实标注。

### 命名与包格式（钉死）

- 动作名 `<appId>.<动词>`：`doc.read`、`sketch.update`
- 错误码 `<APPID>_<SCREAMING_SNAKE>`：`DOC_NOT_FOUND`
- 成功包：`{ "requestId": "req_<uuid>", "data": {...} }`
- 失败包：`{ "error": { "code", "message", "retryable", "details?" }, "requestId": "req_<uuid>" }`
- 写操作认 `idempotency-key` 头：同一个键重发返回原结果，不重复执行
- 共享资源的写建议认 `expectedRevision`：冲突回 `409`；一期可放宽但要在文档写明「最后写赢」

**诚实铁律**：没配置、没接入的能力返回显式 `501/503`，**永不假成功、永不编造端点**。

### 4.3 卡片可见性 = 注册表驱动（宿主侧规则）

画布界面**没有任何写死的卡片入口**——所有「+」菜单都由注册表决定：

- **画布上的「+」加卡菜单**（卡柄、底栏、空白画布）：卡的种类必须出现在画布 manifest `nodeKinds` 里，且——
  - **原生卡**（image / video / storyboard）：始终显示，画布自己就能编辑；
  - **App 支撑卡**（text / sketch / page / presentation，及 manifest `editorApps` 里登记的任何 kind）：**对应 App 已注册且 active 才显示**。App 一上线卡就出现，一下线/未装就消失——不是灰掉，是隐藏。**文字卡也是 App 卡**：`text` 归 doc App（`editorApps['text']='doc'`）——卡内正文渲染直接用 doc 的 surface 组件（`@doc/surface` 的 `MarkdownWordDocument`），doc 注销后文字卡从加卡菜单消失（画布上已存在的卡仍以 surface 组件渲染，只是不再可新建、深度编辑入口失效）。
- **页签栏「+」**：列出已注册的外部 App（画布自己除外），点击**在工作区新开一个页签、挂载 App 的 TSX 组件**（不是 URL 跳转）——页签 id `app:<appId>:<target>`，存进持久化页签状态。它只负责「打开 App 页签」，不负责「建卡」；建卡永远走画布上的「+」。
- **App 页签的挂载方式**：宿主安装 App 的 surface npm 包（如 `@doc/surface`），按 appId 找到对应组件渲染；组件通过 App 的 `endpoint`（协议面地址）读写数据，**不走 iframe**。App 的 API 必须允许宿主页面跨源调用（本地开发可放开，生产环境白名单宿主来源）。
- 所以 App 想让自己的卡在画布上可建：① 注册自己（P2）② manifest `editorKinds` 声明你编辑什么 kind ③ 宿主 manifest `editorApps` 里有 kind→appId 映射（卡包注册时写入）。

### 4.4 卡面三权分立（卡内 UI 归属）

一张卡上的 UI 分三个归属方，各管各的：

- **卡壳**（边框、缩放手柄、标题栏、复制/删除、连线锚点、「+」）：**宿主画布**，App 不碰
- **内容区**（渲染、内联编辑）：**卡所属 App 的 surface 组件**全权决定——宿主不得往内容区塞自己的提示菜单
- **空卡初始动作面板**：**宿主**——空卡时展示的初始面板（如文字卡的「自己编写/拆分镜/生成图片/文生视频」）动作全是编排层动作（进入编辑态、建连卡），归宿主管；一旦进入编辑/有了内容，内容区归 App
- **AI 生成操作条**（提示词输入、「拆分镜/生图/文生视频」这类跨卡生成）：**管理侧 Agent 执行通道**——它不是「卡的部件」，是借卡的位置放的 Agent 入口。宿主 manifest 的 `agentRuntime.available` 声明执行通道是否接入；**未接入时整条生成 UI 必须隐藏**，不许放一个能输入但没人执行的假框（诚实铁律）

## 五、能力清单 manifest

`GET /api/apps/<appId>` 返回的样子：

```json
{
  "appId": "doc",
  "name": "文档编辑器",
  "version": "0.1.0",
  "protocolVersion": 1,
  "editorKinds": ["text"],
  "actions": [
    { "actionId": "doc.list",  "mode": "app",      "async": false },
    { "actionId": "doc.read",  "mode": "instance", "async": false },
    { "actionId": "doc.write", "mode": "instance", "async": false },
    { "actionId": "doc.open",  "mode": "instance", "async": false }
  ],
  "events": { "available": false },
  "snapshots": { "available": false },
  "requiresExpectedRevision": false,
  "execution": "synchronous"
}
```

- `editorKinds`：我负责深编辑哪几种卡——**必须和画布能力清单里的 `editorApps` 映射对得上**（`text→doc`）。对不上管理侧会把请求指到错的地方。
- `actions`：只写真实现的。

## 六、和画布的交互（三个半口）

| 口 | 干什么 |
|---|---|
| **自注册** | 启动时向画布 `POST /api/apps/register` 登记 `{appId, name, endpoint}`；失败只告警不退出 |
| **open-editor** | 画布把「这张卡归你编辑」的请求发过来：`{nodeId, filePath, canvasId?}`，你返回能打开编辑器的 `openUrl` |
| **文件通道** | 卡片里存的 `filePath` 是内容锚点；读写它走画布的 `GET/PUT /api/apps/canvas/instances/:id/files?path=`——这是和画布交换内容的**唯一通道**，可以经你后端 P9 转发 |
| **事件订阅（半个）** | 可选：订画布的卡片增删改事件流，卡变了你能知道 |

关联语义（钉死）：**卡 ↔ App 的关联键是 `filePath`**。卡是画布的，文件是共享的锚点，你的 App 用 filePath 找到该编辑的内容。两边不互查对方的数据库。

## 七、前端交付形态

**默认形态：npm 组件包。** 你的编辑器界面写成 React 组件，发到 `@<appId>/surface` 包里，画布/宿主 `import` 进来挂载：

```tsx
import { DocumentEditorPane } from '@doc/surface';
<DocumentEditorPane api={api} document={doc} />
```

**同时要有一个独立壳** `apps/web`：同一套组件放进一个能独立打开的页面里（验证自闭环用）。组件和壳共用同一套数据接口（如 doc 的 `DocDocumentApi`），只是挂载环境不同。

## 八、环境变量规范

| 变量 | 用途 | 必需? |
|---|---|---|
| `<APP>_SERVER_PORT` | 服务端口 | 否（有默认） |
| `<APP>_PUBLIC_ENDPOINT` | 对外通告的自身地址 | 自注册时需要 |
| `<APP>_REGISTER_TO` | 画布地址，有则启动时自注册 | 否 |
| `CANVAS_ORIGIN` | 画布地址，文件桥转发用 | 接画布时需要 |
| `<APP>_DATA_DIR` | 本地降级存储目录 | 无 Appwrite 时需要 |
| `APPWRITE_*` | §三的六个 | 上云存储时需要 |
| `TEAM_PERMISSIONS_URL` | 团队权限地址 | 未约定前 P10 返回 501 |

## 九、安全与诚实

- 所有 `?path=` 参数必须消毒：拒 `..`、拒空段、限后缀白名单（参考 doc 的 `sanitizeLogicalPath`）
- 只调画布的 `/api/apps/*` 公开接口，不摸画布内部 API
- 未配置的能力显式报 `501/503`
- commit 邮箱必须公司域 `@kuaishou.com`，否则 GitLab 拒收

## 十、交付自检表（Definition of Done）

逐条**实测**，「写了」不算，「跑通了」才算：

- [ ] `pnpm -r build` / `test` / `typecheck` 全绿
- [ ] 不配任何画布变量，App 能独立启动、核心功能可用（自闭环）
- [ ] 设 `<APP>_REGISTER_TO` 重启后，`GET <画布>/api/apps` 能看到自己
- [ ] `GET /api/apps/<appId>` 返回 manifest，声明的动作都有实现
- [ ] 画布建卡 → `POST .../open-editor` → 拿到本 App 地址和 filePath
- [ ] `POST /api/apps/<appId>/open-editor` → 拿到能打开的 openUrl
- [ ] 经文件通道写入 → 画布侧读回内容一致（双向实测）
- [ ] 响应都带 `requestId`，错误都带 `code/message/retryable`
- [ ] 未配置的能力全部显式 501/503
- [ ] README 写明：结构、自闭环验证方法、环境变量、启动命令、未实现清单

## 十一、doc 合规状态（2026-10-20，按统一合同 P 编号）

| 项 | 合同条目 | 状态 |
|---|---|---|
| 响应包 `requestId` | 命名与包格式 | ✅ 全端点实现 |
| `/actions/` 路由（doc.list/read/write/open） | P6/P13 | ✅ 实现 + 幂等重放实测 |
| 回执查询 | P14 | ✅ 实现（会话级，重启清空——已在 manifest 标注） |
| `/events` | P18（二期） | manifest 如实标 `available:false` |
| `/snapshots` | P20（二期） | 如实标 `available:false` |
| 文件写无版本冲突控制 | P16 | 一期放宽：最后写赢，文档已写明 |
| open-editor 会话存内存 | P4 | 一期接受，重启即丢已写明 |

> doc 目前是体系里**第一个全合规参考实现**（必须项 100%，应当项除二期全实现）。

---

## 附录 A：API 格式参考（实测样例，可直接抄）

以下全部是 2026-10-20 在 canvas `17462` + doc `19000` 上真实跑过的调用。

### A.1 自注册（P2）

App 启动时：

```bash
curl -X POST http://<画布>/api/apps/register \
  -H 'content-type: application/json' \
  -d '{"appId":"doc","name":"文档编辑器","endpoint":"http://127.0.0.1:19000","webUrl":"http://127.0.0.1:19001","description":"Document editor App"}'
```

之后 `GET <画布>/api/apps` 返回：

```json
{ "requestId": "req_...", "data": { "apps": [
  { "appId": "doc", "name": "文档编辑器", "endpoint": "http://127.0.0.1:19000",
    "webUrl": "http://127.0.0.1:19001",
    "description": "...", "status": "active", "registeredAt": "2026-10-20T09:11:54.070Z" }
] } }
```

### A.2 能力清单（P1）

```bash
curl http://127.0.0.1:19000/api/apps/doc
```

```json
{
  "appId": "doc", "name": "文档编辑器", "version": "0.1.0",
  "editorKinds": ["text"],
  "actions": [
    { "actionId": "doc.list",  "mode": "app",      "async": false },
    { "actionId": "doc.read",  "mode": "instance", "async": false },
    { "actionId": "doc.write", "mode": "instance", "async": false },
    { "actionId": "doc.open",  "mode": "instance", "async": false }
  ]
}
```

### A.3 卡 → App 解析（画布侧）

```bash
curl -X POST "http://<画布>/api/apps/canvas/instances/<instanceId>/open-editor" \
  -H 'content-type: application/json' -d '{"nodeId":"t1"}'
```

```json
{ "requestId": "req_...", "data": {
  "appId": "doc", "endpoint": "http://127.0.0.1:19000",
  "nodeId": "t1", "kind": "text",
  "filePath": "sources/text/t1-op-61249b73c0ff4c20.md" } }
```

App 未装时：`404 { "error": { "code": "APP_NOT_INSTALLED", ... } }`，不静默失败。

### A.4 App 侧收打开请求（P3）

```bash
curl -X POST http://127.0.0.1:19000/api/apps/doc/open-editor \
  -H 'content-type: application/json' \
  -d '{"nodeId":"t1","filePath":"sources/text/t1.md","canvasId":"canvas-xxx"}'
```

```json
{ "data": { "appId": "doc", "nodeId": "t1",
  "filePath": "sources/text/t1.md", "canvasId": "canvas-xxx",
  "openUrl": "http://127.0.0.1:19001/?nodeId=t1&filePath=sources%2Ftext%2Ft1.md&canvasId=canvas-xxx" } }
```

### A.5 文件通道（P5 / P9）

写（经 App 后端转发，也可以直连画布同形端点）：

```bash
curl -X PUT "http://127.0.0.1:19000/api/apps/doc/canvas/<instanceId>/files?path=sources/text/t1.md" \
  -H 'content-type: application/json' -d '{"content":"# 标题\n\n正文"}'
```

```json
{ "requestId": "req_...", "data": { "path": "sources/text/t1.md", "status": "written" } }
```

读：

```bash
curl "http://<画布>/api/apps/canvas/instances/<instanceId>/files?path=sources/text/t1.md"
```

```json
{ "requestId": "req_...", "data": { "content": "# 标题\n\n正文" } }
```

### A.6 实例状态（P4）

```bash
curl http://127.0.0.1:19000/api/apps/doc/instances/<docId>/state
```

```json
{ "data": { "instanceId": "d-abc123", "meta": { "id": "d-abc123", "name": "...",
  "path": "documents/d-abc123.md", "size": 128, "updatedAt": "..." }, "content": "# ..." } }
```

### A.7 批量操作（P12，写操作正形）

```bash
curl -X POST "http://<host>/api/apps/<appId>/instances/<id>/operations" \
  -H 'content-type: application/json' \
  -d '{"operationId":"op-<uuid>","baseRevision":1792492885801,
       "operations":[{"type":"node.create","node":{"id":"brief","kind":"text","title":"需求","x":0,"y":0}},
                     {"type":"node.update","nodeId":"result","set":{"text":"方案初稿"}}]}'
```

```json
{ "requestId": "req_...", "data": {
  "receipt": { "operationId": "op-<uuid>", "status": "applied",
               "baseRevision": 1792492885801, "revision": 1792493393642,
               "nodeIds": ["brief"], "createdAt": "..." },
  "revision": 1792493393642, "state": { ... }, "replayed": false } }
```

`baseRevision` 冲突回 `409`；同 `operationId` 重发返回原回执 `replayed:true`，不重复执行。

单操作糖（P13）同语义、批次为 1：

```bash
curl -X POST "http://<host>/api/apps/<appId>/instances/<id>/actions/node.update" \
  -H 'content-type: application/json' -H 'idempotency-key: op-<uuid>' \
  -d '{"input":{"nodeId":"result","set":{"text":"方案初稿"}},"expectedRevision":1792492885801}'
```

### A.8 错误包

```json
{ "error": { "code": "DOC_INVALID_PATH", "message": "Expected a .md or .mdx path",
  "retryable": false }, "requestId": "req_..." }
```

权限未接入（P10 的诚实桩）：

```json
HTTP 501
{ "available": false, "provider": "wangyihan", "configured": false,
  "reason": "团队权限 API 地址与返回格式尚未提供，权限接线保留未启用" }
```

### A.9 变化订阅（事件流形状，P11 照此做）

```
GET /api/apps/canvas/instances/<id>/events?after=<eventCursor>

event: ready
data: {"instanceId":"canvas-xxx","cursor":"0","resync":false}

event: card.created
data: {"type":"card.created","instanceId":"canvas-xxx","nodeId":"t2",
       "kind":"text","title":"...","revision":1792493393642,"cursor":"1792493393642"}
```

`resync:true` = 游标掉出缓冲，先重读 state 再连。
