# 数据模型总图 —— 团队版 App 平台

资源ID、用途、归属仓库和审批入口统一见 [平台资源目录](platform-resource-catalog.zh-CN.md)。本文解释数据关系；集合/桶及schema是否已部署以目标环境的真实预检为准。

> 定位：**业务 App 管理自己的资产，DA/MA 管理正式目录、组织与实例；画布只管理自身 COI 目录、卡片和绑定映射**。本文件列全每张表的字段、归属、现状。标注：✅已实现 / 🟡部分 / ⬜待建。
> **阅读修正（2026-10-21）**：本文同时保留早期规划与后续云端收敛设计；§一/§二的候选表不等于本期建设要求，当前云端目标见§三。✅是该记录的实现声明，不证明当前云资源存在或生产验收。源码、本地索引、云表及运行证据分开核查；总体关系先读 [开发手册](app-development-handbook.zh-CN.md)。
> **开发者只读（已配置）**：本项目两个开发库/桶默认已登录用户可读，只有显式维护者/服务身份写；两条写函数普通读者不可执行。不要把这个开发资源规则扩展为所有生产用户资产的授权。读取用自己的用户会话，不运行provision、不发维护者凭据；读取路径与实测见 [访问说明](../../../../docs/developer-read-only-access.zh-CN.md)。

## 〇、数据三分法

| 层 | 谁是真源 | 说明 |
|---|---|---|
| **身份/组织** | 一涵 | 团队、成员、角色、SSO——我们只存**镜像缓存**用于展示和关联，不存真源 |
| **平台治理** | 按宿主职责 | MA 正式应用目录/身份/实例由基座维护；内部 Canvas COI 目录、卡种及显隐由画布维护，不要求业务 App 复制这些表 |
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

**历史候选，当前不建此表（见§三）**：展示缓存若将来需要，不能成为授权真源。生产请求必须有可信身份与团队资格，缓存查不到不能当“新租户”自动放行；本地模式另行显式启用。

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
解析：user > team > *，无规则表示内部显隐未禁止；不授予业务读写权限。可信身份、实例归属与动作授权另行核验。管理端的「运维表格」就是它的 UI。

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
每个操作回执落一条——「谁在什么时候对哪个资产干了什么」一查到底。此为早期审计索引规划；当前各 App 的回执须按可靠性交付合同持久化，不得据此退回会话内存。独立审计表是否需要由实际运维消费合同决定。

## 三、现在这两个 App 的云表（2026-10-21）

不新建绑定表，不建项目名单，不建租户表。项目菜单在一涵的基座，他只存画布编号。租户编号用他传来的 `teamId`，写在下面这些行上，两边必须相同。

云端目标是业务正文、画布状态及资源进入对应云存储；本地开发仍可显式使用本地存储。操作回执、绑定缓存、同步日志/outbox 和配置属于另一类运行数据，不能从“正文在云端”推导它们不需要持久化。当前实现的单写者/持久卷限制见正文增补合同，尚未核验的云资源不标已部署。

### `canvases`（画布）✅ 已有

一行一张业务画布。MA 应用/实例/Provider 身份由基座提供，内部 canvasId 由可信映射解析；不得把外部 bizId 或 Provider ID 直接当成画布业务 ID。

```
id, teamId, createdBy, revision, updatedAt,
state    卡片、连线、视口，以及瘦身后的操作回执
archivedAt?
```

卡片上直接写绑定，不另表：`boundAppId`、`boundAppInstanceId`。`teamId` 用这一行的，不在卡片上再存一份。

### `canvas_files` + 存储桶 ✅ 已有

表只做索引，字节在桶里。画布 JSON 里只留路径。

```
canvasId, path, fileId, kind, mime, size, sha256, createdAt
```

图片、文字卡的文件副本走这里。文字卡的正文还会抄在卡片的 `text` 里，给 Agent 直接读。

### `canvas_operations` ✅ 已有，只是索引

方便按一次操作去查。真源在 `canvases` 那一行里的回执，这张表丢了也能从那里补。

### `documents` + 文档桶 ✅ 已有（文档 App 自己的库）

一行一份文档，正文在文档桶，不进画布库。

```
id, name, path, fileId, size, updatedAt,
nodeId, mirrorCanvasId, mirrorPath,
teamId, createdBy, archivedAt?
```

`nodeId` + `mirrorCanvasId` 就是文档这边的绑定，必须和画布卡片上的 `boundAppInstanceId` 对上，`teamId` 必须和画布那一行相同。

### 明确不建

| 不建 | 原因 |
|---|---|
| 新增云端 `bindings` 表 | 当前云端设计以画布卡片和文档行表达；不等于删除现有 bindings API/本地安全索引，迁移须另验 |
| `projects` / 项目名单 | 菜单在一涵基座 |
| `tenant_projection` | 现在不镜像组织，只记录他传来的 teamId |
| `audit_log` | 打开和编辑都不靠它 |

## 四、关系与铁律

```
一涵：项目菜单 → 画布编号
画布库：canvases（卡片上写 boundAppId / boundAppInstanceId）
        canvas_files → 存储桶
文档库：documents（nodeId / mirrorCanvasId / teamId）→ 文档桶
```

1. **对得上才算绑上**：画布卡片的文档编号 = 文档行的 id，文档行的画布编号和卡片编号反过来也指向这张卡，两边 teamId 相同。
2. **写操作检查**：可信身份/授权 + 版本/幂等 + 可关联结果。审计和回执按实现记录持久范围；不能因传了租户头就当认证通过，也不能因旧规划有审计表就默认实际已建。
3. **App 私有数据不进中心库**：doc 正文永远只存 doc 自己的库；中心只有「索引和治理」，这是分散存储原则的底线
4. **删除一律归档**：asset 标 `archived` 不物理删——资产沉淀 + 可恢复 + 审计

## 五、落地顺序

| 阶段 | 内容 | 状态 |
|---|---|---|
| ① 已落地 | apps/entitlements/kind_grants/projects/doc 实例库（带租户指纹） | ✅ |
| ② 本期 | 绑定写在 canvases 卡片和 documents 行上；本地文件不再作为真源 | 约定已定，云未接上前本地只是兜底 |
| ③ 按需规划 | 身份对接、quotas/usage、版本上架；tenant_projection 当前不建 | 外部合同和需求确认后再实施，不作为无条件建表要求 |
