# 结构化输入与 Access Policy

## 结构化输入

JSON 参数支持：

- 内联 object：`--parameters '{"limit":5}'`
- 内联 array：`--filters '[{"field":"date","operator":"EQ","value":"20260724"}]'`
- 文件引用：`--request-schema @schema.json`
- 明确文件参数：`--file <path>`

数值必须是 JavaScript safe integer。需要数字类型时使用 JSON number，不要使用旧版 `key=value` 格式。

## Access Policy

| 类型 | values 规则 |
|---|---|
| `OWNER_ONLY` | 必须为空 |
| `USER_WHITELIST` | 至少一个 `user:<域账号>` |
| `BUSINESS_LINE` | 至少一个业务线；当前身份链路可能无法命中 |
| `ALL_AUTHENTICATED_USERS` | 必须为空 |

注册 Query 的 `access` 是该 Query 唯一的调用者策略。Credential 的 `rawAccess` 是 Raw SQL 的独立策略，二者不取
交集，也没有策略放宽或收紧顺序。

`ALL_AUTHENTICATED_USERS` 表示所有已认证用户，不是匿名公开，也不自动限定为当前 Appwrite Project 成员。

`USER_WHITELIST` 示例：

```json
{
  "access": {
    "type": "USER_WHITELIST",
    "values": ["user:zhangsan", "user:lisi"]
  }
}
```

可通过 `credential get` 返回的 `ownerSubjectId` 核对 subject ID 格式。裸用户名不会匹配。
