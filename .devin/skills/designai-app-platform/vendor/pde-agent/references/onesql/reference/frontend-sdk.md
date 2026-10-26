# 前端接入 SDK 最佳规范

`@codeflicker/website-builder-sdk` 是面向前端的浏览器 SDK（`FrontendCloudSdk`），走 `/extension/v1` Access Proxy 身份透传。注册 Query 可直接使用 SDK；Raw Query 服务端也支持 Browser/HTTP，当前 SDK 版本没有 helper 时使用同域 HTTP 请求。浏览器不接受任意 Bearer Token 或 Extension origin。

## 安装

```bash
npm install @codeflicker/website-builder-sdk --registry https://npm.corp.kuaishou.com
```

## 初始化

**必须全局单例：`FrontendCloudSdk` 只创建一次并复用，禁止在组件渲染、hook、事件回调或每次调用时 `new`。** 重复实例化会重复解析 origin、重建请求上下文，导致多余开销和潜在竞态。

在独立模块中创建并导出单例，全应用共享：

```ts
// lib/sdk.ts —— 全应用唯一实例
import { FrontendCloudSdk } from '@codeflicker/website-builder-sdk';

export const sdk = new FrontendCloudSdk({
  projectId: 'my-appwrite-project-id',
});
```

```ts
// 业务处调用，直接 import 复用，不要再 new
import { sdk } from '@/lib/sdk';

const result = await sdk.onesql.query.execute('getUserStats', {
  parameters: { accountId: 'user-123' },
});
```

- **优先省略 `origin`（默认 `'auto'`）**：部署在 frontend-cloud 项目子域名时自动用 `location.origin`，与当前部署同域，AccessProxy 的 SSO cookie 直接生效，无需任何配置。
- 本地开发需打 staging 时才显式传 `origin: 'inner_staging'`。
- **禁止硬编码任意 URL**：`origin` 只接受 `'auto'` 或 `'inner_staging'`，传其它字符串会被拒绝。
- `projectId` 可在构造时设默认值，也可在单次调用时覆盖；单例 + 单次覆盖即可满足多 Project 场景，无需为每个 Project 各建实例。
- `headers` 仅用于附加 Appwrite Session / JWT，**不要传 Bearer Token 或 Extension API Token**。

| `origin` | 行为 |
|----------|------|
| 省略 / `'auto'`（默认） | 浏览器非 localhost → `location.origin`；否则 → production |
| `'inner_staging'` | `https://frontend-cloud.staging.kuaishou.com` |
| 其它字符串 | 拒绝（安全约束） |

## 执行 Query — `sdk.onesql.query`

| 方法 | 说明 |
|------|------|
| `list(projectId?)` | 列出已注册 Query |
| `get(queryKey, projectId?)` | Query 详情 |
| `execute(queryKey, opts?, projectId?)` | 同步执行，返回 `QueryResult` |
| `submit(queryKey, opts?, projectId?)` | 自适应提交，返回 `QueryResult \| OneSqlJob` |

`opts`：`parameters`（值仅 string / number）、`filters`、`orderBy`、`page`（`limit` 默认 1000）。

```ts
const result = await sdk.onesql.query.execute('getUserStats', {
  parameters: { accountId: 'user-123' },
  page: { limit: 20, offset: 0 },
});
```

- **HIVE 使用 `submit`**；先判断返回值，只有拿到 `OneSqlJob` 才调用 `jobs.wait`。
- 只传业务所需的最小 `parameters` / `page`，避免拉取超量数据。
- 数值参数用 JS number，不要用字符串表达 INTEGER。

## 异步 Job — `sdk.onesql.jobs`

| 方法 | 说明 |
|------|------|
| `get(jobId)` / `list(options?)` | 查询状态 |
| `results(jobId)` | 拉取结果 |
| `cancel(jobId)` | 取消 |
| `wait(jobId, options?)` | 轮询至终态 |

`wait` 选项：`intervalMillis`（≥100，默认 1000）、`timeoutMillis`（>0，默认 300000）、`signal`（`AbortSignal`）。终态为 `SUCCEEDED`、`FAILED`、`CANCELLED`、`NOT_ACCELERABLE`；**仅 `SUCCEEDED` 后才读 `results`**。

```ts
const submission = await sdk.onesql.query.submit('bigHiveReport', {
  parameters: { day: '20260724' },
});
if ('rows' in submission) {
  renderRows(submission.rows);
} else {
  const done = await sdk.onesql.jobs.wait(submission.id, { timeoutMillis: 120000 });
  if (done.status === 'SUCCEEDED') {
    const data = await sdk.onesql.jobs.results(done.id);
    renderRows(data.rows);
  }
}
```

组件卸载或用户取消时，传入 `signal` 及时中止等待，避免悬挂轮询。

## Credential — `sdk.onesql.credential`

只读/有限管理：`list(provider?)`、`get(id)`、`update(id, body)`、`verify(id)`。创建、删除和轮换 Secret 使用 CLI；Credential Secret 永远不能进入浏览器。

## KwaiBI 数据集 — `sdk.onesql.dataset`

```ts
const metadata = await sdk.onesql.dataset.inspect(
  'cred_xxx',
  'https://kwaibi.corp.kuaishou.com/...?datasetId=1663',
);

const result = await sdk.onesql.dataset.query({
  credentialId: 'cred_xxx',
  dataset: '1663',
  uniformQuery: {
    select: [
      { field: 'excel_column_0', as: 'query_date' },
      { field: 'SUM(excel_column_4)', as: 'active_users' },
    ],
    from: { datasetUrn: '1663' },
    groupBy: ['query_date'],
    limit: { offset: 0, limit: 20 },
  },
});
```

SDK 不接受 `queryInvoker/queryPrincipal/queryTenant`；服务端使用当前 AP 用户和 Credential 注入认证字段。

## Raw Query HTTP

Raw Query 不需要 Project、Connection 或 Query 模板。浏览器使用同域 Access Proxy 身份调用：

```ts
const response = await fetch('/extension/v1/onesql/queries/raw', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    credentialId: 'cred_xxx',
    engine: 'BLEEM',
    sql: 'SELECT id FROM database.table LIMIT 10',
  }),
});

if (!response.ok) throw await response.json();
const result = await response.json();
```

服务端要求 Credential ACTIVE，并检查 `providerConfig.rawAccess*`。浏览器只提交 Credential ID，不能获取 Secret、
OneSQL Token 或自定义上游 URL。Raw SQL 应只暴露给明确白名单用户；面向广泛用户的数据应注册成固定 Query。

## 错误处理

失败会抛出 `ExtensionApiError`，其字段为：`code`（稳定错误码）、`requestId`、`httpStatus`、`issues`（校验类错误明细）。**没有 `status` 字段**。

```ts
import { ExtensionApiError } from '@codeflicker/website-builder-sdk';

try {
  await sdk.onesql.query.execute('getUserStats');
} catch (err) {
  if (err instanceof ExtensionApiError) {
    console.error(err.code, err.httpStatus, err.requestId);
    if (err.code === 'QUERY_VALIDATION_FAILED') {
      err.issues.forEach((i) => console.warn(i.path, i.reason, i.hint));
    }
  }
  throw err;
}
```

按稳定错误 `code` 分支（如 `QUERY_DISABLED`、`QUERY_ACCESS_DENIED`、`AUTHENTICATION_REQUIRED`），不要解析 `message` 文案；`httpStatus`/`requestId` 仅用于日志和报障。

## 安全约束

- 不接受用户传入任意 Extension origin / URL / Bearer Token
- Raw Query 只能调用可信同域 API，并依赖服务端 `rawAccess`，不得在浏览器保存 Credential Secret
- 不记录、缓存或上报 `secretKey`、Secret Bundle 或参数中的敏感值
- 依赖同域 SSO cookie 完成鉴权，不要在前端保存长期凭据
