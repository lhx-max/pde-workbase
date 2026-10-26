# 故障排查与已知限制

CLI 错误通常包含稳定 `code` 和 `requestId`：

- `AUTHENTICATION_REQUIRED` / `INVALID_ACCESS_TOKEN`：执行 `appwrite-cf whoami`，必要时重新登录
- `PROJECT_ACCESS_DENIED`：检查当前用户和 `projectId`
- `CREDENTIAL_INVALID`：执行 `credential verify`，必要时安全轮换 Secret
- `CREDENTIAL_ACCESS_DENIED`：新建或换绑 Query 时不拥有目标 Credential
- `RESOURCE_CONFLICT`：删除 Credential 前检查是否仍有 Query 引用
- `QUERY_VALIDATION_FAILED`：根据 `issues[].path/reason/hint` 修正定义
- `QUERY_ACCESS_DENIED`：检查该 Query 自己的 `access`，尤其是白名单值是否带 `user:` 前缀
- `RAW_QUERY_NOT_ALLOWED`：检查 Credential 的 `providerConfig.rawAccess*`
- `QUERY_REQUEST_INVALID`：检查 typed JSON、request schema 和分页参数
- `QUERY_TIMEOUT`：缩小查询范围或改用异步提交
- `ONESQL_AUTHORIZATION_FAILED`：检查 OneSQL principal 和目标表权限
- `ONESQL_UNAVAILABLE`：保留 `requestId`，稍后重试或报障
- `KWAIBI_DATASET_NOT_FOUND`：检查数据集 ID/URL 是否正确
- `KWAIBI_AUTHENTICATION_FAILED`：检查 Credential principal/Secret 和统一数据集权限登记
- `KWAIBI_AUTHORIZATION_FAILED`：当前真实用户或 Credential 没有数据集读取权限
- `KWAIBI_QUERY_FAILED`：检查字段引用、聚合表达式；删除空 `contextWhere/where/having`
- `KWAIBI_UNAVAILABLE`：保留 `requestId`，检查 OpenAPI 或稍后重试

已知限制：

- `validate-batch` 的实际 API 路径是 `/queries/:validate-batch`
- Credential 没有公开 enable/disable 命令
- `BUSINESS_LINE` 当前身份链路可能无法命中
- 当前没有匿名公开访问策略
- KwaiBI 当前只支持数据集详情和同步五元组查询，不支持 KwaiBISQL/异步查询
- 不同发布版本能力可能不同，应使用 `--help` 核对

排障输出不得包含完整请求头、Token、Cookie 或 Secret。
