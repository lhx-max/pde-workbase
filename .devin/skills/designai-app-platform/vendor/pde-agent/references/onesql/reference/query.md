# 注册 Query、Raw Query 与异步 Job

## 注册 Query

Query 直接绑定 Credential，不需要 Connection：

```json
{
  "name": "Daily usage",
  "description": "Usage by account",
  "credentialId": "cred_xxx",
  "engine": "BLEEM",
  "sql": "SELECT usage_date, amount FROM billing.usage WHERE account_id = :accountId",
  "requestSchema": {
    "parameters": {
      "accountId": {"type": "STRING", "required": true}
    },
    "filters": {},
    "orderBy": null,
    "pagination": null
  },
  "access": {"type": "OWNER_ONLY", "values": []},
  "maxRows": 1000,
  "timeoutMillis": 30000,
  "cacheTtlSeconds": 0
}
```

校验文件是包含 `queryKey` 和 `query` 的数组。新建 Query 时每项必须提供 `credentialId`；更新时省略会沿用原值。

```bash
website-builder onesql query validate-batch \
  --project-id <projectId> \
  --file <items.json> \
  --json

website-builder onesql query upsert \
  --project-id <projectId> \
  --query-key <queryKey> \
  --file <query.json> \
  --json
```

内联模式必须提供 `--credential-id`、`--name`、`--engine`、`--sql` 和 `--access-type`。

```bash
website-builder onesql query execute \
  --project-id <projectId> \
  --query-key <queryKey> \
  --parameters '{"accountId":"user-123"}' \
  --json
```

HIVE 使用自适应 `query submit`。服务端在动态短等待阈值内取得完整结果时直接返回并由 CLI 输出；
否则返回 Job。只有返回 Job 后，`--wait` 才会继续轮询：

```bash
website-builder onesql query submit \
  --project-id <projectId> \
  --query-key <queryKey> \
  --parameters '{"accountId":"user-123"}' \
  --wait \
  --json
```

## Raw Query

Raw Query 直接使用 `credentialId + engine + sql`，不需要 Project、Connection 或 Query 模板。Credential 必须
ACTIVE，当前调用者必须满足 Credential 的 `rawAccess`。

CLI 同步查询：

```bash
website-builder onesql raw-query execute \
  --credential-id <credentialId> \
  --engine BLEEM \
  --file <query.sql> \
  --param-defs '{"limit":{"type":"INTEGER","required":true}}' \
  --parameters '{"limit":5}' \
  --json
```

Browser/HTTP 同样支持：

```http
POST /extension/v1/onesql/queries/raw
Content-Type: application/json

{
  "credentialId": "cred_xxx",
  "engine": "BLEEM",
  "sql": "SELECT id FROM database.table LIMIT :limit",
  "parameterDefinitions": {
    "limit": {"type": "INTEGER", "required": true}
  },
  "parameterValues": {"limit": 10}
}
```

Browser 使用当前同域 Access Proxy 身份；CLI 使用 `/_cli/extension/v1/onesql/queries/raw` 和 Bearer Token。两者
执行相同的服务端 `rawAccess` 校验。自适应提交路径为 `raw:submit`：快速完成返回 `QueryResult`，
否则返回 `OneSqlJob`。

Raw Query 只允许受服务端 SQL policy 支持的单条只读查询。生产 Raw Query 执行前仍需明确授权。

## 异步 Job

`query submit` 和 `raw-query submit` 都可能直接得到查询结果，也可能得到 Job。直接得到结果时命令立即
结束；得到 Job 且指定 `--wait` 时，CLI 使用下面的 Job 流程继续等待。

终态包括 `SUCCEEDED`、`FAILED`、`CANCELLED`、`NOT_ACCELERABLE`。只有 `SUCCEEDED` 后读取结果：

```bash
website-builder onesql job wait \
  --job-id <jobId> \
  --poll-interval 1000 \
  --wait-timeout 300000 \
  --json

website-builder onesql job results --job-id <jobId> --json
```
