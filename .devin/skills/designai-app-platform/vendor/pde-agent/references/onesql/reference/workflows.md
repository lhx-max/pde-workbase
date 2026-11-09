# 推荐工作流

## SQL 生成前获取表结构

1. 从用户输入或 SQL 中提取 `database.table`
2. `a.b` 自动解析为 `database=a`、`table=b`，无需用户确认
3. 确定 HIVE、BLEEM 或 CLICKHOUSE engine
4. BLEEM 未给 Catalog 时直接使用 `internal`
5. 执行 `metadata resolve --json`
6. 仅基于返回的真实字段和类型生成 SQL

## KwaiBI 五元组生成

1. 从用户输入提取数据集 ID 或含 `datasetId=` 的 URL
2. 确认 Credential ID
3. 执行 `dataset inspect --json`
4. 仅使用返回的 `name/urn/kind/valueType` 构造五元组
5. 普通查询不创建空 `contextWhere`
6. 执行 `dataset query --input @query.json --json`
7. 根据 `requestId` 和上游错误修正表达式

## 首次接入

1. 执行 `appwrite-cf whoami`
2. 确认生产或 Staging 环境
3. 创建 Credential 并设置 Raw SQL 权限
4. 执行 `credential verify`
5. 经确认后，用小范围 Raw Query 验证真实表权限
6. 准备包含 `credentialId` 的 Query JSON
7. 执行 `query validate-batch`
8. 执行 `query upsert`
9. 用 `execute` 或 `submit` 验证

## 多人协作

1. Credential owner 创建 Query，首次绑定自己的 Credential
2. 在 Query `access` 中配置实际调用者
3. Project 管理者后续可编辑同一个 Query，无需拥有 Credential
4. 若要换绑 Credential，目标 Credential owner 执行换绑

## HIVE 或长任务

1. 使用 `query submit` 或 `raw-query submit`
2. 若直接返回查询结果，读取结果并结束
3. 若返回 Job，保存 Job ID
4. 使用 `job wait` 等待终态
5. 成功后执行 `job results`，必要时执行 `job cancel`

## Secret 轮换

1. 使用环境变量、文件或 stdin 提供新 Secret
2. 执行 `credential rotate-secret`
3. 执行 `credential verify`
4. 经确认后执行小范围 Query 验证
5. 全程不得回显 Secret

## 安全删除

1. disable 或 delete 引用 Credential 的 Query
2. 确认不再有 Query 引用
3. 删除 Credential
4. 遇到 `RESOURCE_CONFLICT` 时保留资源 ID 和 `requestId`
