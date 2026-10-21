# 数据模型总图 —— 团队版 App 平台

> 定位：**资产和治理全自管，身份和组织调一涵的接口**。本文件列全每张表的字段、归属、现状。标注：✅已实现 / 🟡部分 / ⬜待建。

## 〇、数据三分法

| 层 | 谁是真源 | 说明 |
|---|---|---|
| **身份/组织** | 一涵 | 团队、成员、角色、SSO——我们只存**镜像缓存**用于展示和关联，不存真源 |
| **平台治理** | 我们 | App 目录、显隐治理、卡种授权、配额、审计——平台自己的运转数据 |
| **用户资产** | 我们（分散在各 App 库） | 画布实例、卡绑定、各 App 的文档/素材——各自存各自的库，全局索引用一张绑定表串起来 |

## 一、身份层（一涵真源 + 本地镜像）

### `tenant_projection` ⬜（镜像缓存表）

| 字段 | 说明 |
|---|---|
| teamId | 一涵团队 id（主键） |
| name / avatar | 展示用镜像，定期从一涵刷新 |
| members | `[{userId, name, role}]` 快照 |
| syncedAt | 上次同步时间 |
| status | active / dissolved（解散后资产走归档流程） |

**规则**：同步只进不出——一涵改了什么我们跟什么；我们不反向写。请求进来的 `X-Team-Id/X-User-Id`（部署态由 SSO 网关注入）先查这张表校验存在性，查不到当新租户放行（本地 dev 的 `local` 租户直接放行）。

## 二、平台治理层（我们的表）

### `apps`（注册表）✅ 已有

```
appId, name, endpoint, webUrl, description,
status: active|disabled,
scope: platform|team, teamId?,        ← 本团队私有 App
manifest: { editorKinds, actions, tenancy, events, agentRuntime },  ← 建议存快照
registeredAt, publisherId?
```
⬜ 待补：`version`、`manifest` 快照、`publisher{teamId,userId}`（谁发布的）、`reviewStatus`（上架审核态——团队自装先走内部审批）

### `app_entitlements`（显隐治理表）✅ 已有

```
scope: *|team:<id>|user:<id>, appId, effect: allow|deny,
updatedBy, updatedAt
```
解析：user > team > *，无规则默认放行。管理端的「运维表格」就是它的 UI。

### `card_kind_grants`（卡种授权）✅ 已有

```
scope: *|team:<id>|project:<id>, kinds: string[],
updatedAt
```
决定每张画布能建哪些卡（`resolveAllowedKinds` 已按 project→team→* 解析）。

### `app_releases`（版本与上架）⬜ 待建

```
appId, version, manifest 快照, packageUrl, changelog,
status: draft|review|published|deprecated,
publishedBy, publishedAt
```
未来 App 商店/团队自装走这里——`apps` 是「当前生效」，这张是「历史与审批」。

### `quotas` + `usage_counters` ⬜ 待建

```
quotas:        tenantId, appId, maxAssets, maxStorageBytes, maxCallsPerDay
usage_counters: tenantId, appId, period(2026-10), assetCount, storageBytes, callCount
```
写入路径打点累加；`GET /api/apps/<id>/usage` 聚合输出给管理侧配额面板。

### `audit_log` 🟡（回执已有，审计索引待建）

```
auditId, actor:{teamId,userId}, actionId, appId, targetId,
status, receiptId?, summary, createdAt
```
每个操作回执落一条——「谁在什么时候对哪个资产干了什么」一查到底。现在的回执是会话级内存，需要落盘成这张表。

## 三、用户资产层（分散存储 + 全局绑定索引）

### `projects`（画布实例）✅ 已有

```
id, name, teamId, createdBy, createdAt, updatedAt, metadata, status?
```
⬜ 待补：`archivedAt`（删画布=归档，实例文件不删）。

### `bindings`（卡↔App 绑定索引）⬜ 待建

```
bindingId, canvasInstanceId, nodeId, kind,
appId, appInstanceId,            ← 绑的是哪个 App 的哪条实例
mirrorPath?, tenantId,
status: active|archived, createdAt, updatedAt
```
**为什么单独建**：现在绑定信息散在 doc 文档的 meta 里（nodeId/mirror）——画布删卡要归档绑定文档、按画布列出全部绑定资产、换 App 时迁移绑定，都需要一张全局索引。写入规则：绑定时两边各记一份（App meta 记 nodeId 照旧 + 中心 bindings 记一行）；以中心表为准做治理。

### 各 App 自己的实例库 ✅ 已有（doc 为例）

```
doc_documents: id, name, path, size, updatedAt,
               nodeId?, mirrorCanvasId?, mirrorPath?,   ← 绑定信息（与中心表对账）
               teamId, createdBy
sketch/其他 App 同理——各自的库各自的桶，互不进对方库
```

### `canvas_files`（镜像文件）✅ 已有

按实例组织（`sources/text/…`），画布侧渲染镜像——App 写透传维护，不属于治理表。

## 四、关系与铁律

```
tenant(一涵镜像)
  ├── projects[] (teamId)
  │     └── bindings[] (nodeId → appInstanceId)
  │              └── doc_documents / sketch_docs …（各 App 库）
  ├── apps (platform) + apps (team:<id>)
  ├── app_entitlements (team:<id>|user:<id> → appId)
  └── quotas / usage_counters / audit_log
```

1. **每条资产链到底可查**：卡 → binding → App 实例 → 文件 → tenant，一条线全是外键
2. **写操作三件套**：回执（幂等）+ 审计行 + 租户头——所有 App 协议统一
3. **App 私有数据不进中心库**：doc 正文永远只存 doc 自己的库；中心只有「索引和治理」，这是分散存储原则的底线
4. **删除一律归档**：asset 标 `archived` 不物理删——资产沉淀 + 可恢复 + 审计

## 五、落地顺序

| 阶段 | 内容 | 状态 |
|---|---|---|
| ① 已落地 | apps/entitlements/kind_grants/projects/doc 实例库（带租户指纹） | ✅ |
| ② 本期 | bindings 中心索引 + audit_log 落盘 + projects 归档字段 | 本次做 |
| ③ 上云前 | tenant_projection（接一涵 API）+ quotas/usage + app_releases | 待一涵接入清单 |
