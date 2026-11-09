# 表元数据查询

表元数据用于在生成或校验 SQL 前获取真实字段、类型、注释、分区键、主键、排序键和引擎属性。
该接口是只读查询，无需 Credential、Project ID 或表级业务授权，也不需要执行 Raw Query。CLI 的
`/_cli` 网关入口仍复用 `appwrite-cf` 登录态。该命令只返回表信息，不生成 SQL；后续由 Agent
基于返回结果生成或校验 SQL。

## CLI

```bash
website-builder onesql metadata resolve \
  --engine BLEEM \
  --table analytics.events \
  --json
```

批量查询时重复传入 `--table`，或使用逗号分隔，单次最多 20 张表：

```bash
website-builder onesql metadata resolve \
  --engine HIVE \
  --table warehouse.orders \
  --table warehouse.users \
  --json
```

支持 `CLICKHOUSE`、`BLEEM`、`HIVE`。BLEEM 的 Catalog 默认是 `internal`，通常不要显式传
`--catalog`；只有用户明确给出其他 Catalog 时才覆盖。

## Agent 自动识别规则

1. 用户询问表字段、表结构、列类型、分区键、主键、排序键，或后续需要基于真实表结构生成 SQL 时，
   自动调用 `onesql metadata resolve`。
2. 表标识通常为 `a.b`，直接解释为 `database=a`、`table=b`，不要再向用户确认或拆开询问。
3. BLEEM 未提供 Catalog 时直接使用 `internal`，不要向用户确认 Catalog。
4. 从用户上下文、现有 Query 定义或 SQL 方言中确定 engine。只有 engine 确实无法判断时才询问；
   不要根据 `a.b` 猜测 engine。
5. 多张同引擎表合并成一次请求，最多 20 张；不同引擎分别请求。
6. Agent 调用时始终使用 `--json`，按稳定字段读取结果，不解析人类可读输出。
7. `FOUND` 后使用 `columns` 和 `properties`；`NOT_FOUND` 不要臆造字段；`FAILED` 保留错误码并报告。

示例：用户说“根据 BLEEM 表 `analytics.events` 生成统计 SQL”，应先执行：

```bash
website-builder onesql metadata resolve \
  --engine BLEEM \
  --table analytics.events \
  --json
```

此时请求中的 Catalog 自动为 `internal`，无需额外确认。
