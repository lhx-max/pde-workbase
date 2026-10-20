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

### 4.2 协议面 P1–P11（合规清单）

| # | 端点 | 级别 | 干什么 |
|---|---|---|---|
| P1 | `GET /api/apps/<appId>` | 必须 | 能力清单：我是谁、我编辑什么卡、我有哪些动作 |
| P2 | 启动时 `POST <宿主>/api/apps/register` | 必须 | 自注册：告诉画布「我上线了，在这个地址」 |
| P3 | `POST /api/apps/<appId>/open-editor` | 必须 | 收 `{nodeId, filePath, canvasId?}` → 回 `{openUrl}`，即「打开我编辑这张卡」 |
| P4 | `GET /api/apps/<appId>/instances/:id/state` | 必须 | 查我这个实例的当前状态 |
| P5 | `GET/PUT /api/apps/<appId>/instances/:id/files?path=` | 必须 | 读写我这个实例的文件 |
| P6 | `POST /api/apps/<appId>/actions/<app>.create` | 应当 | 创建新实例的 App 级动作 |
| P7 | `POST .../instances/:id/actions/:actionId` | 应当 | 实例动作统一入口——manifest 里声明的每个动作都必须有路由，**声明了没实现 = 不合规** |
| P8 | `GET .../instances/:id/action-receipts/:receiptId` | 应当 | 查动作执行回执（同步动作可直接内嵌返回） |
| P9 | `GET/PUT /api/apps/<appId>/canvas/:canvasId/files?path=` | 应当 | 画布文件桥：后端转发到画布文件通道，前端不用直接知道画布地址 |
| P10 | `GET /api/apps/<appId>/permissions` | 必须 | 团队权限查询口；没接入时返回 `501 + {available:false, reason}`，**不许编一个不存在的权限服务** |
| P11 | `GET .../instances/:id/events` | 二期 | 我这边的变化事件流（SSE），MVP 可缓但 manifest 要如实标 `available:false` |

> 「必须」= 没有它插不进画布；「应当」= Agent 的统一调用面，缺了 Agent 就没法标准操作你；「二期」= 可缓但要诚实标注。

### 命名与包格式（钉死）

- 动作名 `<appId>.<动词>`：`doc.read`、`sketch.update`
- 错误码 `<APPID>_<SCREAMING_SNAKE>`：`DOC_NOT_FOUND`
- 成功包：`{ "requestId": "req_<uuid>", "data": {...} }`
- 失败包：`{ "error": { "code", "message", "retryable", "details?" }, "requestId": "req_<uuid>" }`
- 写操作认 `idempotency-key` 头：同一个键重发返回原结果，不重复执行
- 共享资源的写建议认 `expectedRevision`：冲突回 `409`；一期可放宽但要在文档写明「最后写赢」

**诚实铁律**：没配置、没接入的能力返回显式 `501/503`，**永不假成功、永不编造端点**。

## 五、能力清单 manifest

`GET /api/apps/<appId>` 返回的样子：

```json
{
  "appId": "doc",
  "name": "文档编辑器",
  "version": "0.1.0",
  "editorKinds": ["text"],
  "actions": [
    { "actionId": "doc.list",  "mode": "app",      "async": false },
    { "actionId": "doc.read",  "mode": "instance", "async": false },
    { "actionId": "doc.write", "mode": "instance", "async": false }
  ],
  "events": { "available": false }
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

## 十一、doc 当前差距（基准线）

| 差距 | 状态 |
|---|---|
| 响应包缺 `requestId` | 待补 |
| manifest 声明 4 个动作但无 `/actions/` 路由（P7） | 待补 |
| 无 `/action-receipts/`（P8） | 待补 |
| 无 `/events`（P11，二期） | 如实标注即可 |
| 文件写无版本冲突控制（一期放宽，需写明） | 标注 |
| open-editor 会话存内存，重启即丢 | 标注 |
