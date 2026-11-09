# Credential 管理与 Query 绑定

## 创建 Credential

`--credential-type` 和 `--auth-type` 必须一致，可选 `USER` 或 `PROJECT`：

- `PROJECT` 必须提供 `--group-id`
- `USER` 禁止提供 `--group-id`，且必须提供 `--risk-acknowledged`
- 环境可选 `STAGING`、`TEST`、`PROD`、`SGP_PROD`
- `rawAccess` 只控制 Raw SQL，不控制注册 Query

Secret 输入推荐顺序：`--secret-key-file`、`--secret-key-stdin`、`ONESQL_SECRET_KEY`。`--secret-key` 会进入
shell history 和进程参数，只用于兼容。

```bash
ONESQL_SECRET_KEY='<secret>' \
website-builder onesql credential create \
  --credential-type PROJECT \
  --name <name> \
  --environment PROD \
  --auth-type PROJECT \
  --principal '<principal>' \
  --group-id <groupId> \
  --raw-access-type OWNER_ONLY \
  --json
```

```bash
website-builder onesql credential verify --id <credentialId> --json
```

`verify` 只验证配置和 Secret，并申请一次 Token，不执行 SQL，也不能证明目标表权限。只有 PROJECT Credential
可以移交，移交有效期为 24 小时。

## 绑定 Query

不需要创建 Connection。Query 直接保存 `credentialId`：

```bash
website-builder onesql query upsert \
  --project-id <projectId> \
  --query-key <queryKey> \
  --credential-id <credentialId> \
  --name <name> \
  --engine BLEEM \
  --sql '<select-sql>' \
  --access-type OWNER_ONLY \
  --json
```

新建或换绑 Query 时必须拥有目标 Credential。更新已有 Query 时可省略 `credentialId`，服务端会沿用当前值。

删除 Credential 前必须先删除所有引用它的 Query，否则返回 `RESOURCE_CONFLICT`。
