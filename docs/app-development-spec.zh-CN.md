# App 开发规范（通用）

> 适用范围：所有 DESIGN 应用体系下的独立 App（doc / sketch / browser / page / slides / 未来新 App）。
> 参考实现：`designai-app-doc`（本规范的每一条都能在它的代码里找到对应实现或标注的差距）。
> 配套文档：`canvas-app-interop.zh-CN.md`（画布↔App 协议）、`canvas-card-pack.zh-CN.md`（卡包契约）、根 `SKILL.md`。

---

## 〇、一句话定义

**App = 自带前端 + 后端 + 存储的独立服务单元。** 它通过统一 App 协议被管理侧 Agent 发现/调用，通过文件通道和 open-editor 与画布双向互通。拔掉任何一个 App，画布和其他 App 照常工作。

---

## 一、仓库结构（必须）

```
designai-app-<appId>/
├── apps/
│   ├── server/            # Express 服务（协议面 + 自有业务 API）
│   └── web/               # 独立壳（vite/React），嵌入选址的落点
├── packages/
│   └── <app>-surface/     # @<app>/surface — TSX 组件包（可选嵌入形态）
├── functions/
│   └── <app>-api/         # Appwrite Function 部署壳（与 server 同一套 API）
├── scripts/
│   └── appwrite-provision.sh   # 云资源初始化脚本
├── docs/                  # 本 App 的协议补充说明
├── pnpm-workspace.yaml    # 必须从画布仓拷贝（含 overrides/packageExtensions）
├── pnpm-lock.yaml         # 必须从画布仓拷贝（公司镜像版本不全）
└── README.md              # 结构、三个口、环境变量、启动命令
```

规则：

- 从画布仓拆代码时，**只拿本 App 需要的部分**；共享壳/其他模块的归 Agent A 或合并时处理。
- 装包先拷画布仓的 `pnpm-lock.yaml` + `pnpm-workspace.yaml` 再 `pnpm install`（公司 npm 镜像同步慢，`router`/`source-map-js` 等新版没有）。
- 禁 `git add -A`；提交前 `git branch --show-current` 确认分支。

## 二、命名规范

| 项 | 规则 | doc 示例 |
|---|---|---|
| appId | 小写单词 | `doc` |
| 仓库 | `designai-app-<appId>` | `designai-app-doc` |
| 组件包 | `@<app>/surface` | `@doc/surface` |
| 服务端口 | 每个 App 一个，登记在表 | `19000`（web `19001`） |
| Appwrite 库 | `<appId>_app_dev` | `doc_app_dev` |
| Appwrite 桶 | `<appId>_assets_v2` | `doc_assets_v2` |
| 环境变量前缀 | `<APPID>_`（大写） | `DOC_REGISTER_TO` |

已登记端口：canvas `17462`（dev）/`17460`，sketch `17610`，doc `19000`。新 App 选新端口并补进本表。

## 三、存储规范

每个 App **自己**的存储，永远不许读写画布的库/桶，也不许读画布本地文件。

**标准两层模式**（doc 实现）：

- **索引集合**：Appwrite collection（如 `documents`）存 `{ name, path, fileId, size, updatedAt, nodeId? }` 元数据
- **桶**：Appwrite bucket 存内容字节，`fileId` 用内容 hash 派生（`dc-<sha256前30>`，天然去重）

**本地降级**：未配置 `APPWRITE_ENDPOINT` 时必须能跑本地文件存储（`DOC_DATA_DIR` 之类），不报错不假装上云。

**连接环境变量**（固定名）：

```
APPWRITE_ENDPOINT=https://frontend-cloud.corp.kuaishou.com/v1
APPWRITE_PROJECT=grworkspace
APPWRITE_DATABASE=<appId>_app_dev
APPWRITE_BUCKET=<appId>_assets_v2
APPWRITE_SESSION_COOKIE=a_session_grworkspace=<值>   # 注意是完整 cookie 对，不是裸值
```

凭证坑：`APPWRITE_SESSION_COOKIE` 必须传 `a_session_grworkspace=xxx` 整串，只传值会 401。

## 四、API 的两个面

App 的 API 分两层，缺一不可：

### 4.1 自有业务 API（形状自由）

App 自己领域的 REST（doc 的 `/api/documents` CRUD、图片、导出）。形状自己定，但必须遵守 §五的统一包格式，未实现的能力显式 `501`（如 doc 的 `DOC_EXPORT_UNAVAILABLE`）。

### 4.2 App 协议面（合规清单，逐条实现）

| # | 端点 | 级别 | 说明 |
|---|---|---|---|
| P1 | `GET /api/apps/<appId>` | 必须 | 能力清单 manifest（见 §六） |
| P2 | 启动时 `POST <宿主>/api/apps/register` | 必须 | 自注册（见 §七） |
| P3 | `POST /api/apps/<appId>/open-editor` | 必须 | 收 `{nodeId, filePath, canvasId?}`，回 `{data:{openUrl,...}}`；配套 `GET` 可查回话参数 |
| P4 | `GET /api/apps/<appId>/instances/:id/state` | 必须 | 实例状态（实例语义见 §八） |
| P5 | `GET/PUT /api/apps/<appId>/instances/:id/files?path=` | 必须 | 实例文件读写，响应 `{data:{content}}` |
| P6 | `POST /api/apps/<appId>/actions/<app>.create` | 应当 | App 级创建实例动作 |
| P7 | `POST /api/apps/<appId>/instances/:id/actions/:actionId` | 应当 | manifest 里声明的**每个** actionId 必须有对应路由；声明了没实现 = 不合规 |
| P8 | `GET /api/apps/<appId>/instances/:id/action-receipts/:receiptId` | 应当 | 同步动作可返回内嵌回执（receiptId=operationId） |
| P9 | `GET/PUT /api/apps/<appId>/canvas/:canvasId/files?path=` | 应当 | 画布文件桥代理（服务端转发到画布文件通道，前端不直接持画布地址） |
| P10 | `GET /api/apps/<appId>/permissions` | 必须 | 团队权限未接入时返回 `501` + `{available:false, provider, reason}`，**不许编造端点** |
| P11 | `GET /api/apps/<appId>/instances/:id/events` | 二期 | 本 App 实体变化的事件流（SSE，游标回放） |

> 「必须」= 没有它 App 插不上画布；「应当」= 管理侧 Agent 统一调用面，缺了 Agent 无法用标准方式操作这个 App；「二期」= MVP 可缓但要在 manifest 如实标注。

## 五、协议细节（钉死）

**响应包**（所有协议面端点）：

```
成功: { "requestId": "req_<uuid>", "data": { ... } }
失败: { "error": { "code": "DOC_*", "message": "...", "retryable": false, "details?": {} }, "requestId": "req_<uuid>" }
```

- `requestId` 每个请求生成；doc 当前**缺 requestId**（待补，列为合规差距）
- 错误 `code` 用 `<APPID>_<SCREAMING_SNAKE>` 前缀
- `retryable` 必须如实：临时故障 true，参数/权限错误 false

**幂等与并发**：

- 写动作接受 `idempotency-key` 头，重放返回原结果不重复执行
- 有共享资源的写支持 `expectedRevision`，冲突回 `409`（doc 一期文件写可放宽，但要在 manifest/文档里写明「最后写赢」）

**诚实原则**（铁律）：未配置/未接入的能力返回显式 `501/503`，**永不假成功**。权限未接就 501，导出器未装就 501。

**路径安全**：所有 `?path=` 参数必须过消毒（doc 的 `sanitizeLogicalPath`）：拒 `..`、拒空段、限后缀白名单。

## 六、能力清单 manifest 形状

```json
{
  "appId": "doc",
  "name": "文档编辑器",
  "version": "0.1.0",
  "editorKinds": ["text"],
  "actions": [
    { "actionId": "doc.list",  "mode": "app",      "async": false },
    { "actionId": "doc.read",  "mode": "instance", "async": false },
    { "actionId": "doc.write", "mode": "instance", "async": false },
    { "actionId": "doc.open",  "mode": "instance", "async": false }
  ],
  "events": { "path": "/api/apps/doc/instances/{id}/events", "types": ["doc.updated"], "available": false }
}
```

- `editorKinds`：本 App 深编辑哪些卡 kind——**必须和画布 `GET /api/apps/canvas` 的 `editorApps` 映射一致**（`text→doc`）。不一致时管理侧会指错地方。
- `actions`：只声明**真实现了**的；声明没实现是最常见的造假。

## 七、和画布交互的「三个半口」

| 口 | 方向 | 机制 |
|---|---|---|
| 1. 自注册 | App → 画布 | 启动读 `<APP>_REGISTER_TO`，有则 `POST {host}/api/apps/register`，body `{appId,name,endpoint,description}`；失败只告警不退出 |
| 2. open-editor | 画布 → App | 画布 `POST .../open-editor {nodeId}` 返回 `{appId,endpoint,filePath}`；管理侧再 `POST /api/apps/<appId>/open-editor {nodeId,filePath,canvasId?}` 换 `openUrl` |
| 3. 文件通道 | App ↔ 画布 | 画布 `GET/PUT /api/apps/canvas/instances/:id/files?path=` 是唯一真相通道；App 要么经自家 server P9 转发，要么组件用 `canvasFileApi` 直连 |
| 3.5 事件订阅 | App ← 画布 | 可选消费 `GET .../instances/:id/events`（SSE，卡片增删改） |

**铁律**：App 只准调画布的 `/api/apps/*` 公开面，永远不调画布内部 API、不读画布本地文件、不写画布存储。

## 八、instanceId 语义（容易搞混，钉死）

- **画布的 instanceId** = 画布项目（projectId），一个画布一个
- **App 的 instanceId** = App 自己的实体（doc = 一份文档 `d-xxx`）
- **卡 ↔ App 的关联键 = `filePath`**：卡的 `projectFilePath` 指向文件，open-editor 把 `{nodeId, filePath, canvasId}` 交给 App，App 靠 filePath 定位自己的内容
- 不要在两个 instanceId 之间建立「自动映射」——关联永远经 filePath 显式传递

## 九、嵌入形态（两种并存，URL 是默认）

| 形态 | 什么时候用 | doc 实现 |
|---|---|---|
| **URL 嵌入（默认）** | iframe / 新窗口打开编辑器 | open-editor 返回 `openUrl`，形如 `http://<web>/?nodeId=&filePath=&canvasId=`，壳按参数加载 |
| **TSX 组件包（可选）** | 宿主想源码级内嵌 | `@doc/surface` 导出 `<DocumentEditorPane api={...} document={...} />` |

**两个形态共用同一套 API 适配接口**（doc 的 `DocDocumentApi`：`read/write/exportDocument`）——壳和组件只是渲染层不同，数据通道同一套。新 App 照此：先定 `XxxDocumentApi` 接口，再让 URL 壳和 TSX 包都实现它。

## 十、环境变量规范（固定名）

| 变量 | 用途 |
|---|---|
| `<APP>_SERVER_PORT` / `PORT` | 服务端口 |
| `<APP>_PUBLIC_ENDPOINT` | 对外通告的自身地址（自注册用） |
| `<APP>_PUBLIC_WEB` | 编辑器壳地址（openUrl 拼接用） |
| `<APP>_REGISTER_TO` | 宿主地址（有则自注册） |
| `CANVAS_ORIGIN` | 画布地址（P9 文件桥转发用） |
| `<APP>_DATA_DIR` | 本地降级存储目录 |
| `APPWRITE_*` | §三的六个 |
| `TEAM_PERMISSIONS_URL` | 团队权限地址（未约定前 P10 返回 501） |

## 十一、工程要求

- Node `~24`，pnpm `10.33.2`，TypeScript；新代码 TS
- **交付门槛**：`pnpm -r build`、`pnpm -r test`、`pnpm -r typecheck` 三条全绿才算完成——「写了」不等于「能跑」，这是之前所有 Agent 翻车的根源
- 前后端不许互穿私有实现；共享 DTO 进纯契约包
- commit 作者邮箱必须公司域（`@kuaishou.com`），否则 GitLab 拒收

## 十二、App 合规自检表（Definition of Done）

交付前逐条过，**实测**不算自报：

- [ ] `pnpm -r build` / `test` / `typecheck` 全绿
- [ ] 服务能独立起来（`pnpm dev` 或 `node dist`）
- [ ] 设 `<APP>_REGISTER_TO` 启动后，`GET <画布>/api/apps` 能看到自己
- [ ] `GET /api/apps/<appId>` 返回 manifest，actions 与实现一致
- [ ] 画布建卡 → `POST .../open-editor` → 拿到本 App endpoint + filePath
- [ ] `POST /api/apps/<appId>/open-editor` → 拿到能打开的 openUrl
- [ ] 经文件通道（P5 或 P9）写入内容 → 画布 `GET .../files` 读回一致（双向实测）
- [ ] 所有协议面响应带 `requestId`，错误带 `code/message/retryable`
- [ ] 未配置的能力全部显式 501/503（权限、导出器等）
- [ ] 存储走自己的 Appwrite 库/桶或本地降级，不碰画布的
- [ ] README 写明：结构、三个口、环境变量、启动命令、未实现清单

## 十三、doc App 当前合规差距（基准线记录）

| 差距 | 级别 |
|---|---|
| 协议面缺 `requestId` 包裹 | 待补 |
| manifest 声明 4 个 action 但无 `/actions/` 路由（P7） | 待补 |
| 无 `/action-receipts/`（P8） | 待补 |
| 无 `/instances/:id/events`（P11，二期可缓） | 标注 |
| 文件写无 expectedRevision/幂等键（一期可放宽，需写明） | 标注 |
| open-editor session 存内存 Map，重启即丢（可接受，需写明） | 标注 |

> 新 App 对照本表起步；这些差距补齐后此节删除，规范文本即全部真相。
