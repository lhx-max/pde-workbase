# 调用者作用域的幂等凭条与媒体认领（caller-scoped idempotency）

**解决的问题**：共享工作区上，两个不同的已验证 MA 调用者用同一个 idempotency key / clientRequestId 时，旧实现会把第二个调用者判成第一个的重放——返回别人的任务、复用别人的凭条。本改动把「认领」按调用者身份分域：同 key 不再跨调用者共享。

## 激活条件（硬门槛）

- 只有 `currentRequestTenant()` 里的调用者被可信权威标记为 `userVerified === true` 时才启用新作用域。
- 验证调用者必须同时带齐六个字段：`teamId`、`bizId`、`userId`、`applicationId`、`applicationInstanceId`、`providerInstanceId`。任一缺失/空白 → **503 `MEDIA_CALLER_SCOPE_UNAVAILABLE`**，在 dispatch/落库之前拒绝，绝不静默降级到共享命名空间。
- 其余一切上下文（本地开发 `{teamId,userId}`、显式 `userVerified:false`、后台任务无上下文）**保持旧的裸键行为**，现有 fixture 与直接调用服务层的测试不受影响。

> 接线已在本 App 自有服务器完成：`setVerifiedTenant` 只在可信身份验证成功后添加服务内部标记。客户端自报 header 无效；不依赖外部 MA/SDK 增加字段，未验证的开发 profile 不冒充正式身份。

## ImageAppService（图片 App 凭条）

- **存储键**：`workbenchImageReceipts` 里的键在已验证调用者下变为 `irp-<sha256(身份六元组哈希, projectId, 原始key)>`（≤128 字符，不透明）；未验证调用者仍是原始 key。返回给调用者的 `receiptId` 始终是其提交的原始 key。
- **凭条元数据**：新增可选字段 `callerScope` = 调用者身份六元组的 sha256。只有这个哈希，不落任何身份原文、不落凭据。
- **重放**：同一调用者 + 同 key + 同输入 → 命中自己的凭条，直接重放（`replayed: true`），发生在版本检查之前；输入变了 → 409 `IMAGE_IDEMPOTENCY_CONFLICT`。不同用户/不同 MA 实例用同 key → 各自独立认领，走正常新操作（当前版本检查照常）。
- **读凭条**：`receipt(projectId, receiptId)` 先按当前调用者作用域解析内部键；命中记录的 `callerScope` 与当前作用域不符 → 404。无作用域（未验证/后台）读到 scoped 凭条 → 404。旧的无作用域凭条仅供显式未验证/local profile 读取，已验证调用者不认领——这是"端点重放归属权"，不是团队级保密；凭条本来就在共享画布状态里。
- **内部一致性**：`dispatch`/`updateReceipt` 始终用内部存储键；已有任务 ID 不因重放变化（新生成任务的 seed 使用内部键，把不同调用者的独立任务分开）。已验证作用域永远不会认领旧操作留下的无归属凭条。
- 授权顺序不变：路由层照旧先做项目/授权检查，服务层只管认领归属。

## 通用媒体 `acceptMediaRequest`

- 签名向后兼容（第 5 个参数 `claimedTaskId` 可选）。已验证调用者下，存进 `media_task_requests.request_id` 的是 `mrq-<sha256(作用域, projectId, 原始clientRequestId)>`（≤200 字符）；请求体、`clientRequestId` 原文、任务交付合同（`canvas-<uuid>` 任务 ID）一律不变。
- **跨调用者任务 ID 冲突**：claim 没命中但调用者指定的 taskId（canvasDelivery 的 `canvas-<uuid>`）已被占用 → 在 `create()` 之前抛 409 `MEDIA_REQUEST_ID_CONFLICT`，消息脱敏（不带身份、不带请求体）。调用者要发起独立操作就换新的 UUID——不会把别人的任务塞回来，也不会静默改任务 ID。
- 同一调用者同 key 重放稳定：claim 命中 + 摘要一致 → 返回原任务。云端 journal 快照/恢复原样存取作用域键（`media_task_requests` 全表往返），重建后的服务对同一调用者照常重放。
- 无新列、无 schema 变更、无新迁移；不会把明文身份或凭据写进请求载荷。

## 边界与已知限制

- 单元用例使用本地 media fixture；Root 另以真实 Appwrite 的 HTTP 创建、服务重建、当前调用者回执及其他读者拒绝验证接线（74 项综合云检查的一部分）。真实 MA 站点和付费模型未在此冒充通过。
- 凭条只记作用域哈希，不做全状态保密——同项目其他授权读者仍能在 state 里看到凭条对象的存在。
- `image.status` 不认领请求键；已验证上下文仍必须完整，资源与读权限由路由检查。

## Root 集成校正

可信 `setVerifiedTenant` 在成功核验后添加服务内部 `userVerified:true`；请求自报头不能设置该标记，不修改外部 SDK。正式链路据此激活分域，而不是把“字段齐全”当认证。验证用户读取 legacy 无归属回执返回 404，不能因 raw key 一样认领；历史共享画布 JSON 本身仍是获准成员可读的业务状态，本机制不声称把它变成每人秘密。

验证用户的生图必须提供稳定 clientRequestId，缺少时在模型目录、任务写入和执行之前返回 428；新身份字段有长度和控制字符检查。不可匹配的持久回执归属拒绝覆盖。fixture 与 local-test 维持显式旧模式，真实 MA/资源桥/模型用户授权/staging 仍需独立实测。
