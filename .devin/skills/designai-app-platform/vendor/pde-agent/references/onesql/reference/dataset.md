# KwaiBI 数据集

## 获取字段

数据集引用可以是纯数字 ID，也可以是包含 `datasetId=` 的 KwaiBI URL。查询需要 ACTIVE OneSQL
Credential，数据权限使用该 Credential 的 principal/secret 和当前真实用户。

```bash
website-builder onesql dataset inspect \
  --credential-id <credentialId> \
  --dataset 'https://kwaibi.corp.kuaishou.com/...?datasetId=1663' \
  --json
```

Agent 必须先读取 `dataset.fields`，按以下优先级引用字段：

1. `urn` 非空时使用 URN
2. 否则使用 `name`
3. 不要使用 `displayName` 作为查询字段

`kind` 为 `TIME|DIMENSION|METRIC|UNKNOWN`。旧数据集的时间列可能是 `DIMENSION`，应结合
`valueType/functionExpression` 判断，不要臆造 `__time`。

## 执行五元组

把查询写入 JSON 文件。文件可以是完整文档请求，也可以直接是 `uniformQuery`。CLI 只发送
`uniformQuery/queryConfig`，会丢弃 `queryInvoker/queryPrincipal/queryTenant`；认证和 flow 参数由服务端生成。

```json
{
  "uniformQuery": {
    "select": [
      {"field": "excel_column_0", "as": "query_date"},
      {"field": "SUM(excel_column_4)", "as": "active_users"}
    ],
    "from": {"datasetUrn": "1663"},
    "groupBy": ["query_date"],
    "orderBy": [{"field": "query_date", "direction": "ASC"}],
    "limit": {"offset": 0, "limit": 20}
  }
}
```

```bash
website-builder onesql dataset query \
  --credential-id <credentialId> \
  --dataset 1663 \
  --input @query.json \
  --json
```

规则：

- 顶层 `dataset` 是事实源，服务端会覆盖 `uniformQuery.from.datasetUrn`
- 普通查询省略空的 `where/contextWhere/having`；服务端也会自动清理空过滤器
- `contextWhere` 只在动态粒度表达式等明确场景使用
- 指标通常需要聚合函数；维度放入 `groupBy` 时使用 select alias
- 单次 `limit` 不得超过 5000
- 失败时保留 `requestId`，不要输出 Credential Secret

## Browser SDK

```ts
const metadata = await sdk.onesql.dataset.inspect('cred_xxx', '1663');

const result = await sdk.onesql.dataset.query({
  credentialId: 'cred_xxx',
  dataset: '1663',
  uniformQuery: {
    select: [{ field: 'SUM(excel_column_4)', as: 'active_users' }],
    from: { datasetUrn: '1663' },
    limit: { offset: 0, limit: 20 },
  },
});
```
