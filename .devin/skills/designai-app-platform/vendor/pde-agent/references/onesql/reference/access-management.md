# 权限管理

## 两类执行权限

Connection 已移除。注册 Query 和 Raw SQL 使用两套独立策略，不做上下层交集：

| 场景 | 权限字段 | 作用 |
|---|---|---|
| 注册 Query | `Query.access` | 控制谁能执行这个固定 SQL 和固定请求 Schema |
| Raw SQL | `Credential.providerConfig.rawAccessType/rawAccessValues` | 控制谁能拿该 Credential 执行任意受支持的只读 SQL |

Credential 的 ACTIVE 状态和 Secret 是否有效仍是两类查询共同的前置条件。Credential 不再有
`maxInvokeAccess`，也不存在 Connection `invokeAccess`。

## AccessPolicy

| 类型 | values 规则 | 含义 |
|---|---|---|
| `OWNER_ONLY` | 必须为空 | 仅 Credential owner |
| `USER_WHITELIST` | 至少一个 subject ID | 仅白名单用户 |
| `BUSINESS_LINE` | 至少一个业务线 ID | 调用者命中任一业务线；当前身份链路可能无法命中 |
| `ALL_AUTHENTICATED_USERS` | 必须为空 | 任意已认证用户，不等于匿名公开，也不限于当前 Project |

`USER_WHITELIST` 必须使用完整 subject ID，例如 `user:zhangsan`。裸用户名不会匹配。

Raw SQL 当前只支持 `OWNER_ONLY` 和 `USER_WHITELIST`。这是因为 Raw SQL 允许调用者自行提供 SQL，权限应比固定
Query 更严格。

## Query 创建和换绑

- 新建 Query 必须提供 `credentialId`，并且调用者必须拥有该 Credential。
- 更新 Query 时省略 `credentialId` 会沿用原 Credential。

## KwaiBI 数据集

`dataset inspect/query` 直接使用 Credential，不经过注册 Query，因此调用权限由
`Credential.providerConfig.rawAccessType/rawAccessValues` 控制：

- `OWNER_ONLY`：仅 Credential owner
- `USER_WHITELIST`：仅列出的 `user:<username>` subject

服务端还会使用 Credential principal/Secret 和当前真实用户执行数据集权限校验。Credential ID 不是授权凭证，
不能通过复制 ID 绕过 `rawAccess` 或数据集自身权限。
- 显式换绑到另一个 Credential 时，调用者必须拥有目标 Credential。
- Project 管理者可以继续编辑已经绑定到其他人 Credential 的 Query，只要不换绑 Credential。
- Query 执行时只检查 Query 是否 enabled、Credential 是否 ACTIVE，以及 `Query.access`。

## 向所有登录用户提供数据

把固定、安全的查询注册成 Query，并设置：

```json
{
  "access": {
    "type": "ALL_AUTHENTICATED_USERS",
    "values": []
  }
}
```

浏览器只拿 `queryKey` 和结构化参数调用 Query。Credential Secret 始终保存在服务端，不进入浏览器。

当前没有匿名公开策略。若需要无需登录的公网数据，应增加独立的匿名发布能力、限流和缓存，不要把 Credential 或
Secret 下发到浏览器。

## Raw SQL 白名单

创建 Credential 时设置：

```bash
website-builder onesql credential create \
  ... \
  --raw-access-type USER_WHITELIST \
  --raw-access-values user:zhangsan,user:lisi
```

该白名单只影响 Raw SQL，不限制已注册 Query。注册 Query 的调用者完全由各 Query 自己的 `access` 决定。
