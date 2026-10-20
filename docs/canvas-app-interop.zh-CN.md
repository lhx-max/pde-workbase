# 画布 ↔ 独立 App 交互协议（v0.1 草案）

> 适用范围：画布（designai-app-canvas）与未来的独立 App（草图编辑器
> `designai-app-sketch`、浏览器 `designai-app-browser` 等）之间的数据交换。
> 卡片包（Card Pack）是卡**内部**的开发协议，见 `canvas-card-pack.zh-CN.md`；
> 本文是卡**外部**的 App 间协议。App 是独立仓库、独立部署的产物，画布是宿主。

## 0. 定这个协议解决什么

画布里的卡片（草图卡、未来的业务卡）只是一个**数据载体 + 入口**。卡的内容
由外部 App 的编辑器生产/编辑。两个产物分属不同仓库、可能不同团队，中间必须
有一条不互相泄漏内部实现的通道。本文冻结这条通道的最小形状。

## 1. 角色与边界

- **画布 App**：持有卡片信封（id/kind/几何/标题/`projectFilePath`/`data`）、
  画布状态、凭条、COI 门脸、共享文件桶。
- **编辑器 App**：持有自己的编辑器 UI、业务状态、后端。对画布是外部系统，
  **永远不直接依赖画布内部代码或内部 API**。
- **约定**：App 只能通过 §2 的三个通道与画布交互；卡片也只通过 §3 的
  「打开编辑器」请求找到 App。

## 2. 三个交换通道

### 2.1 读画布 —— COI 门脸（已存在）

```
GET /api/apps/canvas/instances/<bizId>/state        → 卡列表（含信封与 data 黑盒）
GET /api/apps/canvas                                → 能力清单（卡 kind、动作）
```

App 读卡 = 读画布 state，拿到节点 id/kind/geometry/data/projectFilePath。
**内部路由 `/api/projects/:id/canvas/*` 不是 App 契约，不保证稳定。**

### 2.2 写画布 —— COI 动作（已存在）

```
POST /api/apps/canvas/instances/<bizId>/actions/<actionId>
{ "input": { "operationId": "<幂等键>", "baseRevision": <版本>,
             "operations": [...] } }
```

App 改卡只用两类操作：
- 通用信封操作：`node.move` / `node.update`（标题、文件引用等）
- 卡片业务操作：`card.<团队>.<名>.<动词>`（若卡包了 server handler）

`baseRevision` 冲突回 409 → 重新读 state 再改。`operationId` 幂等，重放安全。

### 2.3 文件交换 —— 共享桶（已存在）

卡的内容文件统一走 Appwrite 桶，卡里只存 `projectFilePath`（相对路径）。
App 读写同一桶（凭部署侧注入的会话凭证），**不自建存储、不直接拼桶内路径
之外的地址**。写文件前先 `files.write`，再把路径写回卡的 `projectFilePath`。

## 3. 打开编辑器（卡 → App）

卡上的「编辑」按钮不内嵌编辑器，而是发一个**打开请求**：

```ts
interface OpenEditorRequest {
  appId: string;              // 'sketch' | 'browser' | <团队前缀>
  nodeId: string;             // 卡片 id
  projectFilePath: string;    // 桶内相对路径（卡内容）
  bizId: string;              // 画布实例
}
```

- 画布侧「kind → appId」映射：**已落地**——核心卡写死在能力清单 `editorApps`
  （text→doc、sketch→sketch、page→page、presentation→slides），业务卡由卡包
  `/server` 入口的 `cards[].editorApp` 声明；
- 服务端解析端点（已实现）：
  `POST /api/apps/canvas/instances/:instanceId/open-editor` `{nodeId}`
  → 返回 `{appId, endpoint, nodeId, kind, filePath}`；
  未关联或未注册 → `404 APP_NOT_INSTALLED`，不允许静默失败；
- 宿主（管理侧/工作台）负责把请求路由到对应 App（新窗口/内嵌面板/跳转，
  由宿主决定，画布不规定呈现形态）。

## 4. 卡 ↔ App 的数据归属

| 数据 | 归谁 | 怎么交换 |
|---|---|---|
| 卡信封（位置/大小/标题/路径） | 画布 | COI 读 / node.* 写 |
| 卡 `data` 黑盒 | 卡的业务方 | card.* 动作 / onPatch |
| 卡内容文件（.sketch.json 等） | 共享桶 | projectFilePath |
| 编辑器会话/草稿 | App 自己 | 不进画布 |

**禁条**：
- App 不写画布本地文件路径、不直连画布内部 API；
- 画布不解析 App 的业务字段（data 黑盒原则同卡片包）；
- 两者之间的字段格式变更必须走双方 schema 版本号，不猜结构。

## 5. 一期状态

| 件 | 状态 |
|---|---|
| COI 读/写通道 | ✅ 已上线（本地 server + Function） |
| 共享桶 + projectFilePath | ✅ 已上线 |
| **App 目录** | ✅ `GET /api/apps` 列已注册 App；`POST /api/apps/register` 外部 App 自注册（body: `{appId,name,endpoint,description?}`）；镜像 Appwrite `apps` 集合 |
| **打开编辑器** | ✅ `open-editor` 端点已实现（见 §3） |
| **跨 App 文件通道** | ✅ `GET/PUT /api/apps/canvas/instances/:id/files?path=`——App 读写卡里存的同一份文件（一期文本负载） |
| App 独立仓/独立部署 | ⏳ 拆出中 |

## 6. 待定（二期）

- App → 画布回调（编辑器完成后的「回到画布」）；
- 多实例并发编辑同一卡内容的锁策略；
- 交互的 auth 委托（画布会话 → App 会话）；
- 文件通道二进制负载（当前文本；图片/视频走素材通道）。
